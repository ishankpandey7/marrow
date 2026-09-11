const EXTENSION_ORIGIN =
  /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function isExtensionOrigin(origin: string): boolean {
  return EXTENSION_ORIGIN.exec(origin)?.[0] === origin;
}

export function isSaveOriginAllowed(
  origin: string | null,
  siteOrigin: string,
): boolean {
  return origin === null || origin === siteOrigin || isExtensionOrigin(origin);
}

export function saveCorsHeaders(
  origin: string | null,
  siteOrigin: string,
): Headers {
  const headers = new Headers({
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    "Cache-Control": "no-store",
  });
  if (origin && isSaveOriginAllowed(origin, siteOrigin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "Retry-After");
  }
  return headers;
}

export function isSavePreflightAllowed(
  headers: Headers,
  siteOrigin: string,
): boolean {
  const origin = headers.get("origin");
  const requestedHeaders = headers.get("access-control-request-headers");
  return Boolean(
    origin &&
    isSaveOriginAllowed(origin, siteOrigin) &&
    headers.get("access-control-request-method") === "POST" &&
    (!requestedHeaders ||
      requestedHeaders
        .split(",")
        .every((header) =>
          ["authorization", "content-type"].includes(
            header.trim().toLowerCase(),
          ),
        )),
  );
}
