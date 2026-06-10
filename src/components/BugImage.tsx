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
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-500 text-xs uppercase tracking-widest ${className ?? ""}`}
      >
        {fallbackText ?? "pending"}
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
