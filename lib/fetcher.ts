import { lookup as systemLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

import { APP_NAME } from "@/lib/constants";
import { publicEnv } from "@/lib/env";
import type { FailReason } from "@/lib/types";

/**
 * The SSRF boundary. This is the most dangerous file in the repository: a user
 * hands us a string and we make a server-side HTTP request to it, from inside
 * our hosting provider's network, with whatever ambient credentials that
 * network confers.
 *
 * This is the only place permitted to fetch a user-supplied URL. If a second
 * one appears, that is the bug. Every guard in ARCHITECTURE.md section 5 is
 * implemented here and tested in fetcher.test.ts; the tests were written first.
 *
 * DNS and the transport are parameters rather than imports-in-place so the
 * whole guard chain can be exercised offline. A test suite that needs the
 * internet is a test suite that fails in CI on a Sunday.
 */

/** Guard 9. Counted on the stream, never read off Content-Length. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** Guard 8. Hops we will follow before giving up, each fully re-validated. */
export const MAX_REDIRECTS = 3;

/** Guard 10. The whole operation, redirects and body included. */
export const TOTAL_TIMEOUT_MS = 10_000;

/** Guard 10. Handed to the transport; also acts as the socket idle timeout. */
export const CONNECT_TIMEOUT_MS = 5_000;

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["80", "443"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Guard 4. */
const DENIED_HOSTS = new Set(["localhost", "metadata.google.internal"]);
const DENIED_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".home.arpa",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LookupResult {
  readonly address: string;
  readonly family: number;
}

/** `dns.promises.lookup(host, { all: true })`, narrowed to what we judge. */
export type Lookup = (hostname: string) => Promise<readonly LookupResult[]>;

export interface TransportRequest {
  /** Absolute URL for this hop. Its hostname is what goes in Host and SNI. */
  readonly url: string;
  /** Guard 7: the address already judged safe. The socket connects here. */
  readonly address: string;
  readonly family: 4 | 6;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly connectTimeoutMs: number;
}

export interface TransportResponse {
  readonly status: number;
  /** Lowercased names. Repeated headers are joined. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
}

export type Transport = (
  request: TransportRequest,
) => Promise<TransportResponse>;

export interface FetchedPage {
  /** The URL of the hop that answered — not the one the user typed. */
  readonly url: string;
  readonly status: number;
  /** The media type alone, lowercased. Parameters are stripped. */
  readonly contentType: string;
  readonly html: string;
  readonly bytes: number;
}

/** The subset of the section 6 taxonomy a fetch can produce. */
export type FetchFailReason = Extract<
  FailReason,
  | "blocked_url"
  | "unreachable"
  | "not_found"
  | "forbidden"
  | "too_large"
  | "unsupported_type"
  | "server_error"
>;

/**
 * Guard 13. Which guard tripped, for our own logs and for Sentry.
 *
 * A closed union of literals, deliberately: nothing here is interpolated, so
 * no hostname, address, port, timing or upstream error message can reach a
 * caller through it. A differentiated error is a working port scanner with a
 * nice UI, and the type system is what keeps that true as this file changes.
 */
export type FetchNote =
  | "url did not parse"
  | "scheme not allowed"
  | "credentials in url"
  | "port not allowed"
  | "hostname denylisted"
  | "dns lookup failed"
  | "dns returned no addresses"
  | "address in a blocked range"
  | "redirect location missing"
  | "redirect location did not parse"
  | "redirect limit exceeded"
  | "connection failed"
  | "timed out"
  | "http status"
  | "content type not allowed"
  | "body exceeded the size cap"
  | "unexpected error";

export interface FetchSuccess {
  readonly ok: true;
  readonly page: FetchedPage;
}

export interface FetchFailure {
  readonly ok: false;
  readonly reason: FetchFailReason;
  readonly note: FetchNote;
}

export type FetchOutcome = FetchSuccess | FetchFailure;

export interface FetchPageOptions {
  lookup?: Lookup;
  transport?: Transport;
  userAgent?: string;
  totalTimeoutMs?: number;
  connectTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

function fail(reason: FetchFailReason, note: FetchNote): FetchFailure {
  return { ok: false, reason, note };
}

/**
 * Guard 12. Names the product and gives site operators somewhere to complain,
 * which is the difference between a polite fetcher and an anonymous scraper.
 */
export function buildUserAgent(siteUrl: string): string {
  return `${APP_NAME}/1.0 (read-it-later; +${siteUrl})`;
}

// ---------------------------------------------------------------------------
// Address judgement — guards 5 and 6
// ---------------------------------------------------------------------------

function parseIpv4(input: string): Uint8Array | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    if (!/^\d{1,3}$/.test(parts[index])) return null;
    const value = Number(parts[index]);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

function parseIpv6(input: string): Uint8Array | null {
  // A zone index ("fe80::1%eth0") says which interface to use, not which host.
  // It is not part of the address and must not stop us recognising fe80::/10.
  const text = input.split("%")[0];
  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const pieces = part.split(":");
    const groups: number[] = [];

    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];

      // A dotted-quad tail is legal only as the last piece: "::ffff:127.0.0.1".
      if (piece.includes(".")) {
        if (index !== pieces.length - 1) return null;
        const embedded = parseIpv4(piece);
        if (embedded === null) return null;
        groups.push(
          (embedded[0] << 8) | embedded[1],
          (embedded[2] << 8) | embedded[3],
        );
        continue;
      }

      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  if (head === null) return null;

  if (halves.length === 1) {
    return head.length === 8 ? toBytes(head) : null;
  }

  const tail = toGroups(halves[1]);
  if (tail === null) return null;
  // "::" stands for at least one group of zeros, so the two halves can supply
  // at most seven between them.
  if (head.length + tail.length > 7) return null;

  const middle = new Array<number>(8 - head.length - tail.length).fill(0);
  return toBytes([...head, ...middle, ...tail]);
}

function toBytes(groups: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function matchesPrefix(
  bytes: Uint8Array,
  prefix: Uint8Array,
  bits: number,
): boolean {
  const wholeBytes = bits >> 3;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }

  const remaining = bits & 7;
  if (remaining === 0) return true;

  const mask = (0xff << (8 - remaining)) & 0xff;
  return (bytes[wholeBytes] & mask) === (prefix[wholeBytes] & mask);
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/** Guard 6, IPv4. 169.254.0.0/16 is where the cloud metadata endpoint lives. */
const BLOCKED_IPV4 = (
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
    ["255.255.255.255", 32],
  ] as const
).map(([prefix, bits]) => ({ prefix: parseIpv4(prefix)!, bits }));

/** Guard 6, IPv6. */
const BLOCKED_IPV6 = (
  [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ] as const
).map(([prefix, bits]) => ({ prefix: parseIpv6(prefix)!, bits }));

function isBlockedIpv4(bytes: Uint8Array): boolean {
  return BLOCKED_IPV4.some(({ prefix, bits }) =>
    matchesPrefix(bytes, prefix, bits),
  );
}

function isBlockedIpv6(bytes: Uint8Array): boolean {
  return BLOCKED_IPV6.some(({ prefix, bits }) =>
    matchesPrefix(bytes, prefix, bits),
  );
}

/**
 * The IPv4 address hiding inside an IPv6 one, if there is one. Every form here
 * reaches an IPv4 destination, so every form has to be unwrapped and judged
 * against the IPv4 ranges — checking only the IPv6 ranges lets
 * `::ffff:169.254.169.254` walk straight through.
 */
function embeddedIpv4(bytes: Uint8Array): Uint8Array | null {
  // ::ffff:0:0/96, IPv4-mapped.
  if (startsWith(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])) {
    return bytes.slice(12, 16);
  }
  // ::/96, the deprecated IPv4-compatible form: the same trick, two bytes less.
  if (startsWith(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) {
    return bytes.slice(12, 16);
  }
  // 2002::/16, 6to4. The address is in the four bytes after the prefix.
  if (startsWith(bytes, [0x20, 0x02])) {
    return bytes.slice(2, 6);
  }
  // 64:ff9b::/96, NAT64.
  if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) {
    return bytes.slice(12, 16);
  }
  return null;
}

/** Guard 6. Exported so a future image proxy re-uses this judgement verbatim. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.split("%")[0];

  if (isIP(bare) === 4) {
    const bytes = parseIpv4(bare);
    return bytes === null || isBlockedIpv4(bytes);
  }

  if (isIP(bare) === 6) {
    const bytes = parseIpv6(bare);
    if (bytes === null) return true;

    const embedded = embeddedIpv4(bytes);
    if (embedded !== null && isBlockedIpv4(embedded)) return true;

    return isBlockedIpv6(bytes);
  }

  // Not something we can reason about. An address we cannot parse is an
  // address we have not checked, and unchecked is refused.
  return true;
}

// ---------------------------------------------------------------------------
// URL validation — guards 1 to 7
// ---------------------------------------------------------------------------

interface ValidTarget {
  readonly ok: true;
  readonly url: string;
  readonly address: string;
  readonly family: 4 | 6;
}

function normaliseHost(hostname: string): string {
  // The URL parser has already lowercased this; the trailing dot of a fully
  // qualified name has not been removed, and "localhost." reaches the same
  // resolver as "localhost".
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function ipLiteral(host: string): string | null {
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return isIP(bare) === 0 ? null : bare;
}

async function validateTarget(
  raw: string,
  lookup: Lookup,
): Promise<ValidTarget | FetchFailure> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("blocked_url", "url did not parse");
  }

  // Guard 1.
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return fail("blocked_url", "scheme not allowed");
  }

  // Guard 2. Credentials in a URL are either an attempt to authenticate to
  // something internal or an accident that would put a password in our logs.
  if (url.username !== "" || url.password !== "") {
    return fail("blocked_url", "credentials in url");
  }

  // Guard 3.
  const port = url.port === "" ? defaultPort(url.protocol) : url.port;
  if (!ALLOWED_PORTS.has(port)) {
    return fail("blocked_url", "port not allowed");
  }

  // Guard 4, before DNS: a name we will never fetch never becomes a lookup.
  const host = normaliseHost(url.hostname);
  if (
    DENIED_HOSTS.has(host) ||
    DENIED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return fail("blocked_url", "hostname denylisted");
  }

  const literal = ipLiteral(host);
  if (literal !== null) {
    if (isBlockedAddress(literal)) {
      return fail("blocked_url", "address in a blocked range");
    }
    return {
      ok: true,
      url: url.toString(),
      address: literal,
      family: isIP(literal) === 6 ? 6 : 4,
    };
  }

  // Guard 5.
  let addresses: readonly LookupResult[];
  try {
    addresses = await lookup(host);
  } catch {
    return fail("unreachable", "dns lookup failed");
  }

  if (addresses.length === 0) {
    return fail("blocked_url", "dns returned no addresses");
  }

  // Every address, not just the first. A hostname with one public and one
  // private A record is an attack, not a coincidence: we do not get to choose
  // which one the socket would have used.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return fail("blocked_url", "address in a blocked range");
    }
  }

  const chosen = addresses[0];
  return {
    ok: true,
    url: url.toString(),
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

// ---------------------------------------------------------------------------
// Status and content type
// ---------------------------------------------------------------------------

function statusReason(status: number): FetchFailReason {
  if (status === 404 || status === 410) return "not_found";
  // 429 is a bot wall wearing a politer hat, and "that site blocked us" is what
  // it means to the person who saved the link.
  if (status >= 400 && status < 500) return "forbidden";
  // A 502 from someone else's origin is not our server erring, and it is worth
  // retrying — which is exactly what `unreachable` buys in section 10.
  return "unreachable";
}

/** The media type without its parameters, lowercased. */
function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Body handling — guard 9
// ---------------------------------------------------------------------------

/**
 * Close a body we are not going to read, without pulling a single chunk.
 * Draining a response we have already refused means paying to download the
 * 700 MB video we rejected, and paying to download a redirect body someone
 * made large on purpose.
 */
async function closeBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    await iterator.return?.(undefined);
  } catch {
    // Already closed, or a stream with no return(). Either way there is
    // nothing left to release.
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const HEADER_CHARSET = /charset\s*=\s*"?([^";,\s]+)/i;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([a-z0-9_:.+-]+)/i;

function decodeWith(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // An unknown or misspelled label. Fall through to the next signal rather
    // than failing a whole fetch over a typo in someone's Content-Type.
    return null;
  }
}

function decodeBody(bytes: Uint8Array, contentTypeHeader: string): string {
  const declared = HEADER_CHARSET.exec(contentTypeHeader)?.[1];
  const fromHeader = declared ? decodeWith(bytes, declared) : null;
  if (fromHeader !== null) return fromHeader;

  // Plenty of pages declare their encoding only in the markup. Ignoring that
  // turns every accented word in the article into a replacement glyph, so
  // sniff the head as latin-1, where every byte is a valid character.
  const head = decodeWith(bytes.subarray(0, 2048), "iso-8859-1") ?? "";
  const sniffed = META_CHARSET.exec(head)?.[1];
  const fromMeta = sniffed ? decodeWith(bytes, sniffed) : null;
  if (fromMeta !== null) return fromMeta;

  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// The default transport — guards 7, 10 and 12 at the socket
// ---------------------------------------------------------------------------

function flattenHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

/**
 * node:http rather than fetch(), for three reasons that are all guards:
 * a socket-level `lookup` hook exists here and does not exist on fetch;
 * redirects are ours to follow rather than the runtime's; and node:http never
 * consults HTTP_PROXY, so there is no ambient proxy to inherit.
 */
function nodeTransport(request: TransportRequest): Promise<TransportResponse> {
  const url = new URL(request.url);

  const options: https.RequestOptions = {
    method: "GET",
    headers: request.headers,
    signal: request.signal,
    // Guard 7. The socket connects to the address we already judged. The
    // hostname still supplies the Host header and the TLS server name, so a
    // record that changes a millisecond after our check cannot move the
    // connection. This is the whole defence against DNS rebinding.
    lookup: (_hostname, _options, callback) => {
      callback(null, request.address, request.family);
    },
    // No pooling. A kept-alive socket outlives the check that approved the
    // address at the other end of it.
    agent: false,
    // Applies before the socket connects and again as an idle timeout, which
    // is what stops a host that accepts the connection and then sends one byte
    // a minute.
    timeout: request.connectTimeoutMs,
  };

  return new Promise((resolve, reject) => {
    const outgoing =
      url.protocol === "https:"
        ? https.request(url, options)
        : http.request(url, options);

    outgoing.on("timeout", () => {
      outgoing.destroy(new Error("socket timeout"));
    });
    outgoing.on("error", reject);
    outgoing.on("response", (incoming) => {
      resolve({
        status: incoming.statusCode ?? 0,
        headers: flattenHeaders(incoming.headers),
        body: incoming,
      });
    });

    outgoing.end();
  });
}

async function systemLookupAll(
  hostname: string,
): Promise<readonly LookupResult[]> {
  const results = await systemLookup(hostname, { all: true });
  return results.map(({ address, family }) => ({ address, family }));
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Fetch one user-supplied URL, or say why we would not.
 *
 * Never throws for a bad URL, a hostile host or a dead one: every failure is a
 * value from the section 6 taxonomy. The caller stores the reason and shows
 * its copy; it must never show the note, and must never show anything else.
 */
export async function fetchPage(
  rawUrl: string,
  options: FetchPageOptions = {},
): Promise<FetchOutcome> {
  const lookup = options.lookup ?? systemLookupAll;
  const transport = options.transport ?? nodeTransport;
  const userAgent = options.userAgent ?? buildUserAgent(publicEnv.siteUrl);
  const totalTimeoutMs = options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  // Guard 12. No cookie jar, no Authorization, no client certificate, and
  // node:http reads no proxy variables. Guard 9 leans on identity encoding:
  // a gzip bomb is five megabytes on the wire and gigabytes in memory, so
  // counting wire bytes only means something if the wire carries what we parse.
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
    "accept-encoding": "identity",
    "accept-language": "en;q=0.9,*;q=0.5",
    "user-agent": userAgent,
  };

  // Guard 10. One budget for the whole operation. Per-hop timeouts let four
  // slow redirects add up to a function the platform kills mid-write.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), totalTimeoutMs);

  try {
    let target = rawUrl;
    const visited = new Set<string>();

    for (let hop = 0; ; hop += 1) {
      // Guard 8: the full chain, on every hop. Validating only what the user
      // typed means one Location header on someone else's server undoes
      // everything above.
      const validated = await validateTarget(target, lookup);
      if (!validated.ok) return validated;

      let response: TransportResponse;
      try {
        response = await transport({
          url: validated.url,
          address: validated.address,
          family: validated.family,
          headers,
          signal: controller.signal,
          connectTimeoutMs,
        });
      } catch {
        return fail(
          "unreachable",
          controller.signal.aborted ? "timed out" : "connection failed",
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        await closeBody(response.body);

        const location = response.headers.location;
        if (!location) return fail("blocked_url", "redirect location missing");
        if (hop >= maxRedirects) {
          return fail("blocked_url", "redirect limit exceeded");
        }

        let next: URL;
        try {
          next = new URL(location, validated.url);
        } catch {
          return fail("blocked_url", "redirect location did not parse");
        }

        // A loop would otherwise burn the whole hop budget going nowhere.
        if (visited.has(next.toString())) {
          return fail("blocked_url", "redirect limit exceeded");
        }
        visited.add(validated.url);
        target = next.toString();
        continue;
      }

      if (response.status < 200 || response.status > 299) {
        await closeBody(response.body);
        return fail(statusReason(response.status), "http status");
      }

      // Guard 11, after the headers and before the body.
      const contentType = mediaType(response.headers["content-type"]);
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        await closeBody(response.body);
        return fail("unsupported_type", "content type not allowed");
      }

      // Guard 9. Content-Length is a hint from the party we are defending
      // against, so it is not consulted at all: count what arrives and stop
      // the moment the running total passes the cap. Leaving this loop early
      // closes the stream, which is what makes the cap a cap rather than a
      // note in the log after we already paid for the bytes.
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            return fail("too_large", "body exceeded the size cap");
          }
          chunks.push(chunk);
        }
      } catch {
        return fail(
          "unreachable",
          controller.signal.aborted ? "timed out" : "connection failed",
        );
      }

      return {
        ok: true,
        page: {
          url: validated.url,
          status: response.status,
          contentType,
          html: decodeBody(
            concat(chunks, bytes),
            response.headers["content-type"] ?? "",
          ),
          bytes,
        },
      };
    }
  } catch {
    // Guard 13. Anything unforeseen still leaves through the taxonomy, never
    // as a thrown error carrying a stack trace and an internal address.
    return fail("server_error", "unexpected error");
  } finally {
    clearTimeout(deadline);
  }
}
