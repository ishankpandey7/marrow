import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  isExtensionOrigin,
  isSaveOriginAllowed,
  isSavePreflightAllowed,
  saveCorsHeaders,
} from "./cors";

const siteOrigin = "https://marrow.invalid";
const chromeOrigin = `chrome-extension://${"a".repeat(32)}`;
const firefoxOrigin = `moz-extension://${randomUUID()}`;

describe("save CORS origin boundary", () => {
  it.each([chromeOrigin, firefoxOrigin])(
    "accepts a complete extension origin (%s)",
    (origin) => {
      expect(isExtensionOrigin(origin)).toBe(true);
      expect(isSaveOriginAllowed(origin, siteOrigin)).toBe(true);
    },
  );

  it.each([
    "null",
    "",
    "https://foreign.invalid",
    "http://marrow.invalid",
    "https://marrow.invalid.foreign.invalid",
    "https://marrow.invalid:444",
    `${siteOrigin}/path`,
    `${siteOrigin}@foreign.invalid`,
    `${chromeOrigin}/path`,
    `${chromeOrigin}/`,
    `${chromeOrigin}:443`,
    `${chromeOrigin}\n`,
    `${chromeOrigin}.foreign.invalid`,
    `chrome-extension://${"q".repeat(32)}`,
    `chrome-extension://${"a".repeat(31)}`,
    `chrome-extension://${"a".repeat(33)}`,
    `moz-extension://${"a".repeat(32)}`,
    `${firefoxOrigin}/popup.html`,
    `${firefoxOrigin}\n`,
    `https://${firefoxOrigin.slice("moz-extension://".length)}`,
  ])("rejects a foreign or malformed origin (%j)", (origin) => {
    expect(isExtensionOrigin(origin)).toBe(false);
    expect(isSaveOriginAllowed(origin, siteOrigin)).toBe(false);
  });

  it("allows same-origin web requests without classifying them as extensions", () => {
    expect(isExtensionOrigin(siteOrigin)).toBe(false);
    expect(isSaveOriginAllowed(siteOrigin, siteOrigin)).toBe(true);
  });

  it("allows requests without Origin for the separately authenticated POST handler", () => {
    expect(isSaveOriginAllowed(null, siteOrigin)).toBe(true);
  });
});

describe("save CORS response headers", () => {
  it.each([siteOrigin, chromeOrigin, firefoxOrigin])(
    "reflects only an allowed origin and exposes retry timing (%s)",
    (origin) => {
      const headers = saveCorsHeaders(origin, siteOrigin);
      expect(headers.get("access-control-allow-origin")).toBe(origin);
      expect(headers.get("access-control-expose-headers")).toBe("Retry-After");
      expect(headers.has("access-control-allow-credentials")).toBe(false);
      expect(headers.get("cache-control")).toBe("no-store");
      expect(headers.get("vary")).toBe(
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      );
    },
  );

  it.each([null, "null", "https://foreign.invalid", `${chromeOrigin}/path`])(
    "grants no cross-origin access to a denied or missing origin (%j)",
    (origin) => {
      const headers = saveCorsHeaders(origin, siteOrigin);
      expect(headers.has("access-control-allow-origin")).toBe(false);
      expect(headers.has("access-control-expose-headers")).toBe(false);
      expect(headers.has("access-control-allow-credentials")).toBe(false);
      expect(headers.get("cache-control")).toBe("no-store");
    },
  );
});

function preflight(origin: string = chromeOrigin): Headers {
  return new Headers({
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization, content-type",
  });
}

describe("save preflight", () => {
  it.each([siteOrigin, chromeOrigin, firefoxOrigin])(
    "accepts a save preflight (%s)",
    (origin) => {
      expect(isSavePreflightAllowed(preflight(origin), siteOrigin)).toBe(true);
    },
  );

  it("matches requested header names without case sensitivity", () => {
    const headers = preflight();
    headers.set(
      "Access-Control-Request-Headers",
      " Content-Type , Authorization ",
    );
    expect(isSavePreflightAllowed(headers, siteOrigin)).toBe(true);
  });

  it("accepts an allowed POST preflight without extra requested headers", () => {
    const headers = preflight();
    headers.delete("Access-Control-Request-Headers");
    expect(isSavePreflightAllowed(headers, siteOrigin)).toBe(true);
  });

  it.each(["GET", "DELETE", "PATCH", "PUT", "OPTIONS", "post"])(
    "does not authorize a different request method (%s)",
    (method) => {
      const headers = preflight();
      headers.set("Access-Control-Request-Method", method);
      expect(isSavePreflightAllowed(headers, siteOrigin)).toBe(false);
    },
  );

  it.each([
    "cookie",
    "x-user-id",
    "authorization, x-user-id",
    "content-type, cookie",
    "authorization,",
    "authorization,,content-type",
    "*",
  ])(
    "rejects unapproved or malformed requested headers (%s)",
    (requestedHeaders) => {
      const headers = preflight();
      headers.set("Access-Control-Request-Headers", requestedHeaders);
      expect(isSavePreflightAllowed(headers, siteOrigin)).toBe(false);
    },
  );

  it.each(["https://foreign.invalid", "null", `${chromeOrigin}/path`])(
    "does not authorize a preflight from another origin (%s)",
    (origin) => {
      expect(isSavePreflightAllowed(preflight(origin), siteOrigin)).toBe(false);
    },
  );

  it("requires both Origin and the intended request method", () => {
    const noOrigin = preflight();
    noOrigin.delete("Origin");
    expect(isSavePreflightAllowed(noOrigin, siteOrigin)).toBe(false);
    const noMethod = preflight();
    noMethod.delete("Access-Control-Request-Method");
    expect(isSavePreflightAllowed(noMethod, siteOrigin)).toBe(false);
  });
});
