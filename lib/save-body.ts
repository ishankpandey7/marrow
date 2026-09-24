/**
 * The size ceiling for one POST /api/save body, shared with the extension.
 *
 * Since Slice 10 a save can carry the page the reader is looking at, so the
 * body is no longer a URL's worth of JSON. Three million bytes holds any
 * article page we would extract anyway (the fetcher's own cap is 5 MB of
 * HTML, most of which is scripts the sanitiser throws away) and stays under
 * Vercel's 4.5 MB request limit with room for the JSON around it. The
 * extension checks this before sending and drops the page, keeping the save.
 */
export const SAVE_BODY_MAX_BYTES = 3_000_000;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the save size cap.");
  }
}

/**
 * Read a request body as text, stopping at `maxBytes`.
 *
 * Count bytes as they are read: Content-Length is supplied by the party we
 * are defending against. On this app the stream has usually been buffered
 * already by Next's proxy body clone, so this bounds what we decode and
 * parse; the platform's request limit bounds what is received.
 */
export async function readCappedText(
  request: Request,
  maxBytes: number = SAVE_BODY_MAX_BYTES,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
