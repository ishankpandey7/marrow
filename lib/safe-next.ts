/**
 * Where to send someone after they sign in.
 *
 * The `next` parameter travels through a URL the user can edit and through an
 * email, so it is attacker-controlled. Redirecting to it blindly is an open
 * redirect: a link to our own sign-in page that lands the visitor on someone
 * else's site, wearing our domain in the address bar the whole way. That is a
 * phishing primitive, and it is why this returns a same-site path or nothing.
 *
 * Pure, so it is testable without a request.
 */

export const DEFAULT_NEXT = "/inbox";

export function safeNext(value: string | null | undefined): string {
  if (!value) return DEFAULT_NEXT;

  // Must be a path on this site. "//evil.example" is protocol-relative and a
  // browser reads it as another origin, so a leading-slash check alone is not
  // enough. Backslashes are here because some browsers normalise them to
  // forward slashes, which turns "/\evil.example" into "//evil.example".
  if (!value.startsWith("/")) return DEFAULT_NEXT;
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_NEXT;

  return value;
}
