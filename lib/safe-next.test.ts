import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT, safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it.each(["/inbox", "/read/abc", "/settings?tab=reader"])(
    "allows the same-site path %s",
    (path) => {
      expect(safeNext(path)).toBe(path);
    },
  );

  it.each([null, undefined, ""])("falls back when given %s", (value) => {
    expect(safeNext(value)).toBe(DEFAULT_NEXT);
  });

  it.each([
    ["https://evil.example", "absolute url"],
    ["//evil.example", "protocol-relative"],
    ["/\\evil.example", "backslash normalised to a second slash"],
    ["javascript:alert(1)", "script url"],
    ["inbox", "relative without a leading slash"],
  ])("refuses %s (%s)", (value) => {
    expect(safeNext(value)).toBe(DEFAULT_NEXT);
  });
});
