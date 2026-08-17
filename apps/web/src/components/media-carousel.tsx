"use client";

/**
 * The media carousel from SPEC §6.3.
 *
 * A horizontal scroll-snap strip rather than a JS slideshow: it works with a
 * trackpad, a touch swipe and the keyboard without any of them being
 * reimplemented, and it degrades to a plain scrollable list.
 *
 * Items that are still processing show their original — the upload succeeded and
 * the file is there; what is missing is the thumbnail. Hiding it would look like
 * the upload was lost.
 */
import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { isProcessing, isVideo } from "@/lib/reviews";
import type { ReviewMediaItem } from "@sidequestd/api-types";

function Item({ item, title }: { item: ReviewMediaItem; title: string }) {
  if (isVideo(item)) {
    return (
      <video
        controls
        preload="metadata"
        src={item.url}
        // Letterboxing, so it stays black in both themes: bars that match the
        // page rather than the video make a 4:3 clip look like a broken layout.
        className="h-full w-full bg-black object-contain"
        aria-label={item.alt_text ?? `Clip attached to the review of ${title}`}
      />
    );
  }

  return (
    <Image
      src={item.url}
      alt={item.alt_text ?? `Photo attached to the review of ${title}`}
      fill
      sizes="(max-width: 768px) 100vw, 640px"
      className="object-contain"
    />
  );
}

export function MediaCarousel({ items, title }: { items: ReviewMediaItem[]; title: string }) {
  if (items.length === 0) return null;

  return (
    <ul
      aria-label="Media carousel"
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-xl"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="relative aspect-video w-full shrink-0 snap-center overflow-hidden rounded-lg border border-line bg-surface-2"
        >
          <Item item={item} title={title} />

          {isProcessing(item) ? (
            <Badge tone="overlay" className="absolute left-3 top-3">
              Processing
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
