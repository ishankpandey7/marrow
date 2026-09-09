"use client";

import { useState } from "react";

export function ReaderImage({
  src,
  alt,
  width,
  height,
  local = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  local?: boolean;
}) {
  const [loaded, setLoaded] = useState(local);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="reader-image"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {loaded && !failed ? (
        // A fixed frame also covers missing publisher dimensions and failed requests.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="reader-image-message">
          <span>{alt || "Article image"}</span>
          {failed ? (
            <span>Image unavailable. The article is still here.</span>
          ) : (
            <>
              <button type="button" onClick={() => setLoaded(true)}>
                Load image ↗
              </button>
              <small>Connects to the source site.</small>
              <noscript>
                <span>Open the original to see this image.</span>
              </noscript>
            </>
          )}
        </span>
      )}
    </span>
  );
}
