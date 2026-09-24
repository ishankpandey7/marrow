import { describe, expect, it } from "vitest";

import { BodyTooLargeError, readCappedText } from "@/lib/save-body";

function streamed(chunks: string[], contentLength?: string) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("https://marrow.invalid/api/save", {
    method: "POST",
    body,
    headers: contentLength ? { "content-length": contentLength } : {},
    duplex: "half",
  } as RequestInit);
}

describe("readCappedText", () => {
  it("returns the body when it fits, multi-byte characters included", async () => {
    await expect(readCappedText(streamed(['{"a":', '"é"}']), 20)).resolves.toBe(
      '{"a":"é"}',
    );
  });

  it("counts bytes as they arrive and ignores a Content-Length that lies", async () => {
    await expect(
      readCappedText(streamed(["12345", "67890", "x"], "3"), 10),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("counts bytes, not characters", async () => {
    // Four characters, eight bytes.
    await expect(readCappedText(streamed(["éééé"]), 7)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });
});
