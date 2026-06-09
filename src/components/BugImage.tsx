"use client";

import { useState } from "react";

interface BugImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackText?: string;
}

export default function BugImage({ src, alt, className, fallbackText }: BugImageProps) {
  const [errored, setErrored] = useState(false);

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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
      draggable={false}
    />
  );
}
