import { describe, expect, it } from "vitest";

import { InvalidUrlError, canonicalise, normaliseUrl } from "@/lib/canonical";

/**
 * Written before the implementation, because dedupe correctness is data
 * integrity: two spellings of the same article must produce the same hash, and
 * two different articles must never collide. Every rule here comes from
 * ARCHITECTURE.md section 6.
 */

describe("normaliseUrl", () => {
  it("lowercases the scheme and the host", () => {
    expect(normaliseUrl("HTTPS://Example.COM/Post")).toBe(
      "https://example.com/Post",
    );
  });

  it("leaves the path case alone", () => {
    // Hosts are case-insensitive; paths are not. Lowercasing the path would
    // merge two genuinely different articles on any case-sensitive server.
    expect(normaliseUrl("https://example.com/Post")).not.toBe(
      normaliseUrl("https://example.com/post"),
    );
  });

  it("strips the fragment", () => {
    expect(normaliseUrl("https://example.com/post#section-3")).toBe(
      "https://example.com/post",
    );
  });

  it("strips a default port but keeps a non-default one", () => {
    expect(normaliseUrl("https://example.com:443/post")).toBe(
      "https://example.com/post",
    );
    expect(normaliseUrl("http://example.com:80/post")).toBe(
      "http://example.com/post",
    );
    expect(normaliseUrl("https://example.com:8443/post")).toBe(
      "https://example.com:8443/post",
    );
  });

  it("strips a trailing slash from a non-empty path", () => {
    expect(normaliseUrl("https://example.com/post/")).toBe(
      "https://example.com/post",
    );
  });

  it("keeps the root slash", () => {
    // Without this the root becomes "https://example.com" and round-tripping
    // through URL puts the slash back, so the hash would depend on how many
    // times the value had been parsed.
    expect(normaliseUrl("https://example.com")).toBe("https://example.com/");
    expect(normaliseUrl("https://example.com/")).toBe("https://example.com/");
  });

  it.each([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_anything_at_all",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "igshid",
    "ref",
    "ref_src",
    "_hsenc",
    "_hsmi",
    "yclid",
    "msclkid",
  ])("drops the tracking parameter %s", (param) => {
    expect(normaliseUrl(`https://example.com/post?${param}=abc123`)).toBe(
      "https://example.com/post",
    );
  });

  it("keeps parameters that carry meaning", () => {
    // The failure this guards against is stripping too much: ?id=42 and ?page=2
    // identify different content, and merging them loses articles.
    expect(normaliseUrl("https://example.com/post?id=42&page=2")).toBe(
      "https://example.com/post?id=42&page=2",
    );
  });

  it("keeps meaningful parameters while dropping tracking ones", () => {
    expect(
      normaliseUrl("https://example.com/post?utm_source=twitter&id=42"),
    ).toBe("https://example.com/post?id=42");
  });

  it("sorts the remaining query parameters", () => {
    expect(normaliseUrl("https://example.com/post?b=2&a=1")).toBe(
      normaliseUrl("https://example.com/post?a=1&b=2"),
    );
  });

  it("orders repeated keys deterministically", () => {
    expect(normaliseUrl("https://example.com/p?t=b&t=a")).toBe(
      normaliseUrl("https://example.com/p?t=a&t=b"),
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseUrl("  https://example.com/post  ")).toBe(
      "https://example.com/post",
    );
  });

  it.each([
    ["not a url", "plainly not a url"],
    ["", "empty string"],
    ["example.com/post", "no scheme"],
  ])("rejects %s (%s)", (input) => {
    expect(() => normaliseUrl(input)).toThrow(InvalidUrlError);
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x"])(
    "rejects the scheme in %s",
    (input) => {
      // The fetcher in Slice 2 rejects these too, but rejecting them here means
      // they never reach the database in the first place.
      expect(() => normaliseUrl(input)).toThrow(InvalidUrlError);
    },
  );
});

describe("canonicalise", () => {
  it("produces a 64-character lowercase hex hash", () => {
    // The schema constrains url_hash to ^[0-9a-f]{64}$. A hash that fails this
    // is rejected by Postgres, not silently stored.
    const { urlHash } = canonicalise("https://example.com/post");
    expect(urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the normalised url alongside the hash", () => {
    const { canonicalUrl } = canonicalise("https://Example.com/post/#top");
    expect(canonicalUrl).toBe("https://example.com/post");
  });

  it("is deterministic", () => {
    expect(canonicalise("https://example.com/post").urlHash).toBe(
      canonicalise("https://example.com/post").urlHash,
    );
  });

  it("gives every spelling of one article the same hash", () => {
    // This is the Slice 1 gotcha in test form. Each of these is the same
    // article, and each must resolve to one row.
    const spellings = [
      "https://example.com/post",
      "https://example.com/post/",
      "https://example.com/post#intro",
      "https://EXAMPLE.com/post",
      "https://example.com:443/post",
      "https://example.com/post?utm_source=twitter&utm_medium=social",
      "  https://example.com/post?fbclid=xyz  ",
    ];

    const hashes = new Set(spellings.map((url) => canonicalise(url).urlHash));
    expect(hashes.size).toBe(1);
  });

  it("gives different articles different hashes", () => {
    const a = canonicalise("https://example.com/post-a").urlHash;
    const b = canonicalise("https://example.com/post-b").urlHash;
    expect(a).not.toBe(b);
  });

  it("treats http and https as different articles", () => {
    // Tempting to merge, but they are genuinely different origins and the
    // fetcher treats them differently. Merging would let a plaintext URL
    // overwrite the record of a secure one.
    expect(canonicalise("http://example.com/post").urlHash).not.toBe(
      canonicalise("https://example.com/post").urlHash,
    );
  });
});
