"use client";

import { useEffect, useRef, useState } from "react";
import type { BugPhoto } from "@/lib/types";

interface BugPhotosProps {
  photos: BugPhoto[];
  commonName: string;
}

interface PhotoFigureProps {
  photo: BugPhoto;
  commonName: string;
  index: number;
}

function PhotoFigure({ photo, commonName, index }: PhotoFigureProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Catch cached images that already fired onLoad before React subscribed.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <figure className="flex flex-col gap-2 overflow-hidden rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800/60">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-950">
        {!loaded && (
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-pulse bg-zinc-800/70"
          />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={photo.src}
          alt={
            photo.caption?.length
              ? photo.caption
              : `${commonName}, photo ${index + 1}`
          }
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      </div>
      <figcaption className="px-3 pb-3 text-[10px] leading-relaxed text-zinc-500">
        <span className="text-zinc-400">{photo.credit}</span>
        {photo.license ? <> · {photo.license}</> : null}
        {photo.sourceUrl ? (
          <>
            {" · "}
            <a
              href={photo.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-200/80 hover:text-amber-200"
            >
              source
            </a>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Real-photo gallery for a bug detail page.
 *
 * - Mobile-first: photos stack full-width.
 * - sm+: two-column grid (closeup / habitat side-by-side).
 * - Each photo carries inline attribution beneath it, since the credits
 *   are part of the CC license obligation.
 * - While a photo is decoding, a grey animate-pulse placeholder sits in
 *   its slot and the image fades in on load.
 */
export default function BugPhotos({ photos, commonName }: BugPhotosProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-widest text-zinc-500">
        Photographs
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {photos.map((photo, i) => (
          <PhotoFigure
            key={photo.src}
            photo={photo}
            commonName={commonName}
            index={i}
          />
        ))}
      </div>
    </section>
  );
}
