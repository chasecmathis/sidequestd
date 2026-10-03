"use client";

/**
 * A review as a Home feed row (SPEC §6.4).
 *
 * Not a link. SPEC §6.4 wants the card to open the review *and* to carry a
 * working like button, and a button inside an anchor is invalid markup that
 * behaves differently in every browser. So the things that navigate are
 * explicit: the author, the game, the image and the comment shortcut. Everything
 * a reader might press is something they can name.
 *
 * The like button is the same component the detail page uses, given the same
 * counters — the API puts them on every review, so a row needs no request of its
 * own to render one, and pressing it moves this card only.
 *
 * The type does the work here. The game title is the display serif and the
 * loudest thing on the card, because the game is what a reader is scanning for;
 * the author, the year, the rating and the playtime are all one rank quieter in
 * mono, which is what lets six of these stack without any of them shouting.
 */
import { MessageSquare } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { LikeButton } from "@/components/like-button";
import { StarRating } from "@/components/star-rating";
import { VerifiedPlaytimeChip } from "@/components/verified-playtime";
import { Badge } from "@/components/ui/badge";
import { Card, CardFooter } from "@/components/ui/card";
import {
  commentCountLabel,
  commentsPath,
  excerpt,
  formatPlaytime,
  formatStars,
  profilePath,
  releaseYearLabel,
  reviewPath,
  timeAgo,
} from "@sidequestd/core";

import type { ReviewInteractions, ReviewSummary } from "@sidequestd/api-types";

export function ReviewCard({ review }: { review: ReviewSummary }) {
  // Held locally so a like on one card does not re-render the whole feed, and so
  // the count survives the next page being appended above it.
  const [interactions, setInteractions] = useState<ReviewInteractions>({
    review_id: review.id,
    like_count: review.like_count,
    comment_count: review.comment_count,
    viewer_has_liked: review.viewer_has_liked,
  });

  const text = excerpt(review.review_text);
  const playtime = formatPlaytime(review.playtime_minutes);
  const title = `${review.game.title} — reviewed by ${review.author.username}`;
  const hasMedia = review.media_count > 0;

  return (
    <Card as="article" interactive>
      <header className="flex items-center gap-3 px-4 pt-4">
        <Link href={profilePath(review.author.username)} className="shrink-0">
          <Avatar user={review.author} size={32} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={profilePath(review.author.username)}
            className="text-sm font-medium text-fg link-quiet"
          >
            {review.author.display_name ?? review.author.username}
          </Link>
        </div>
        <time dateTime={review.created_at} className="type-eyebrow shrink-0 text-fg-faint">
          {timeAgo(review.created_at)}
        </time>
      </header>

      {/* Only what the reviewer actually attached gets the wide panel. The API
          falls `thumbnail_url` back to the game's cover art, which is right for
          a square profile tile and wrong here: portrait box art cropped to
          landscape across the full card reads as the reviewer's own screenshot.
          A review with no media shows the cover small and upright below, as
          context for what is being reviewed. */}
      {hasMedia && review.thumbnail_url ? (
        <Link href={reviewPath(review.id)} className="group mt-4 block">
          <div className="relative aspect-4/3 w-full overflow-hidden border-y border-line bg-surface-2">
            <Image
              src={review.thumbnail_url}
              alt={title}
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
            {/* The count, not the media itself: a clip and a second photo look
                the same from here, and "3" is what tells a reader there is more
                inside than the frame they can see. */}
            {review.media_count > 1 ? (
              <Badge tone="overlay" className="absolute right-3 top-3">
                {review.media_count}
              </Badge>
            ) : null}
          </div>
        </Link>
      ) : null}

      <div className={hasMedia ? "px-4 py-4" : "px-4 pb-4 pt-4"}>
        <div className="flex gap-4">
          {!hasMedia && review.game.cover_url ? (
            <Link href={`/games/${review.game.id}`} className="group shrink-0">
              <div className="relative h-28 w-[74px] overflow-hidden rounded-md border border-line bg-surface-2">
                <Image
                  src={review.game.cover_url}
                  alt={`${review.game.title} cover art`}
                  fill
                  sizes="74px"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              </div>
            </Link>
          ) : null}

          <div className="min-w-0 flex-1">
            <h3 className="type-display text-2xl text-fg">
              <Link href={`/games/${review.game.id}`} className="link-quiet">
                {review.game.title}
              </Link>
            </h3>

            {/* One mono line for every fact about the review. Read as a strip
                rather than as sentences, which is what makes a rating
                comparable at a glance across a column of cards. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <StarRating rating={review.rating} size={14} />
              <span className="type-eyebrow tabular-nums text-fg-dim">
                {formatStars(review.rating)} / 5
              </span>
              <span aria-hidden className="h-3 w-px bg-line" />
              <span className="type-eyebrow text-fg-faint">
                {releaseYearLabel(review.game.release_year)}
              </span>
              {/* One playtime figure, never two. When the platform has published
                  one it supersedes the author's own: they are measuring the same
                  thing, and a card showing "Played 40h" beside "47h on Steam"
                  invites a reader to work out which one is lying. */}
              {review.verified_playtime ? (
                <>
                  <span aria-hidden className="h-3 w-px bg-line" />
                  <VerifiedPlaytimeChip verified={review.verified_playtime} />
                </>
              ) : playtime ? (
                <>
                  <span aria-hidden className="h-3 w-px bg-line" />
                  <span className="type-eyebrow text-fg-faint">Played {playtime}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {text ? (
          <p className="prose-review mt-4 whitespace-pre-line text-sm leading-relaxed text-fg-dim">
            {text}{" "}
            <Link href={reviewPath(review.id)} className="link font-medium text-fg">
              Read review
            </Link>
          </p>
        ) : (
          <Link href={reviewPath(review.id)} className="link mt-4 inline-block text-sm text-fg">
            Open review
          </Link>
        )}
      </div>

      <CardFooter>
        <LikeButton interactions={interactions} onChange={setInteractions} />
        {/* A shortcut, not a second comment box: SPEC §6.4 asks for a way in,
            and the thread already lives on the detail page. */}
        <Link
          href={commentsPath(review.id)}
          className="type-eyebrow flex items-center gap-2 rounded-md px-2.5 py-2 tabular-nums text-fg-faint transition-colors duration-150 hover:bg-surface hover:text-fg"
        >
          <MessageSquare aria-hidden strokeWidth={1.75} className="size-4" />
          {commentCountLabel(interactions.comment_count)}
        </Link>
      </CardFooter>
    </Card>
  );
}
