"use client";

import { useEffect, useRef, useState } from "react";

interface BugImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackText?: string;
  /**
   * Show a grey animate-pulse placeholder beneath the image while it loads,
   * fading the image in once it decodes. Defaults to true; pass false for
   * server-rendered hero images where we'd rather avoid the layout shift.
   */
  showSkeleton?: boolean;
}

export default function BugImage({
  src,
  alt,
  className,
  fallbackText,
  showSkeleton = true,
}: BugImageProps) {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // If the browser already had the image cached, `onLoad` may have fired
  // before React attached the listener. Check `.complete` once on mount.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    } else if (img.complete && img.naturalWidth === 0) {
      setErrored(true);
    }
  }, []);

  if (errored) {
    // Graceful image-failure fallback: let the parent's colorPalette
    // background show through (no opaque bg here), and render the bug's
    // commonName as a centered label with a soft text-shadow so it stays
    // readable on any palette color. This makes "illustration pending"
    // cells feel intentional, like a specimen card waiting on its plate.
    return (
      <div
        className={`flex h-full w-full items-center justify-center px-2 ${className ?? ""}`}
      >
        <span
          className="text-[10px] font-medium uppercase tracking-wider text-white text-center leading-tight"
          style={{
            textShadow:
              "0 0 6px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.45)",
            textWrap: "balance",
            maxWidth: "94%",
          }}
        >
          {fallbackText ?? "pending"}
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {showSkeleton && !loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-zinc-800/70"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`${className ?? ""} transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        draggable={false}
      />
    </div>
  );
}
