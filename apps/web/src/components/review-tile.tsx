"use client";

/**
 * The Instagram-style grid from SPEC §6.2: a square tile per review.
 *
 * `thumbnail_url` is resolved server-side — the first media thumbnail, or the
 * game's cover art — so a tile never has to decide what to fall back to, and a
 * review with only a clip attached still shows something.
 *
 * The rating only appears on hover (and on focus, so it is reachable from the
 * keyboard). A grid of twelve tiles each wearing a permanent gradient and a row
 * of stars is a grid you cannot see the pictures in; the stars are the answer to
 * "what did they think", which is a question asked one tile at a time.
 */
import Image from "next/image";
import Link from "next/link";

import { StarRating } from "@/components/star-rating";
import { reviewPath } from "@/lib/reviews";
import type { ReviewSummary } from "@sidequestd/api-types";

export function ReviewTile({ review }: { review: ReviewSummary }) {
  return (
    <Link
      href={reviewPath(review.id)}
      className="group relative block aspect-square overflow-hidden rounded-sm bg-surface-2"
    >
      {review.thumbnail_url ? (
        <Image
          src={review.thumbnail_url}
          alt={`${review.game.title} — review by ${review.author.username}`}
          fill
          sizes="(max-width: 640px) 33vw, 220px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <span className="type-display flex h-full items-center justify-center px-2 text-center text-sm leading-tight text-fg-dim">
          {review.game.title}
        </span>
      )}

      {/* `over-media` pins the palette inside this scrim — the gradient is always
          dark, because what is under it is cover art rather than one of our
          surfaces. Without it the light theme hands `StarRating` its paper-tuned
          amber and paints the filled stars *darker* than the empty ones against
          the black, so the rating reads inverted. See globals.css. */}
      <span className="over-media absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/85 to-transparent px-2 pb-2 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <StarRating rating={review.rating} size={11} />
        {review.media_count > 1 ? (
          <span className="type-eyebrow text-fg-dim">{review.media_count}</span>
        ) : null}
      </span>
    </Link>
  );
}

export function ReviewGrid({ reviews }: { reviews: ReviewSummary[] }) {
  return (
    // The rules live on the tiles, not on the container. Painting the grid
    // `bg-line` and letting it show through a 1px gap is the shorter way to get
    // this look, but a container background fills *every* cell — including the
    // ones no tile occupies — so a profile with one review rendered two grey
    // rectangles beside it.
    //
    // `ring-1` is a box-shadow drawn outside the border box, so it costs no
    // layout space: two adjacent tiles each project their ring into the shared
    // 1px gap and land on the same pixel. One hairline between neighbours, one
    // around the outside, and nothing at all where there is no review.
    <ul aria-label="Reviews grid" className="grid grid-cols-3 gap-px overflow-hidden rounded-lg">
      {reviews.map((review) => (
        <li key={review.id} className="bg-surface ring-1 ring-line">
          <ReviewTile review={review} />
        </li>
      ))}
    </ul>
  );
}
