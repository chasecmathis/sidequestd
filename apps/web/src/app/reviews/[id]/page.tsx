"use client";

/**
 * Review Detail — SPEC §6.3.
 *
 * One request carries everything the screen lists: author, game, rating, text,
 * media carousel, playtime, like count, comment count and whether the viewer has
 * liked it. The comments are a second request, because they are paged and the
 * review is not.
 *
 * The two counters in the footer are held here rather than inside the controls
 * that change them: a like and a comment both move a number the other one is
 * sitting next to, and one owner for both is what keeps them in step without
 * re-reading the review after every press.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { BacklogControl } from "@/components/backlog-control";
import { CommentSection } from "@/components/comments";
import { LikeButton } from "@/components/like-button";
import { MediaCarousel } from "@/components/media-carousel";
import { StarRating } from "@/components/star-rating";
import { Alert } from "@/components/ui/alert";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ReviewSkeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  commentCountLabel,
  formatPlaytime,
  formatStars,
  isProcessing,
  profilePath,
  releaseYearLabel,
  useAuth,
} from "@sidequestd/core";

import type { ReviewDetail, ReviewInteractions } from "@sidequestd/api-types";

/** How long to wait before asking again whether the media has finished. */
const POLL_MS = 2000;

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { authedRequest, user, isLoading } = useAuth();

  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => authedRequest<ReviewDetail>(`/reviews/${id}`),
    [authedRequest, id],
  );

  useEffect(() => {
    // Same reason as the profile page: this endpoint answers signed-out callers
    // with 200, so a request sent before the initial /auth/refresh lands would
    // come back as the anonymous view with no 401 for authedRequest to retry on.
    if (isLoading) return;

    let cancelled = false;
    setReview(null);
    setError(null);
    load()
      .then((body) => {
        if (!cancelled) setReview(body);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "That review no longer exists."
            : cause instanceof ApiError && cause.status === 403
              ? "This account is private. Follow them to see their reviews."
              : cause instanceof Error
                ? cause.message
                : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [load, isLoading]);

  // Uploads are processed in the background (SPEC §6.3), so a review opened
  // straight after posting has thumbnails that do not exist yet. Poll only while
  // something is actually pending, then stop.
  const pending = review?.media.some(isProcessing) ?? false;
  useEffect(() => {
    if (!pending) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      load()
        .then((body) => {
          if (!cancelled) setReview(body);
        })
        .catch(() => {
          /* A failed poll is not worth reporting: the page already renders. */
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, review, load]);

  if (error) {
    return (
      <AppShell>
        <Alert tone="error">{error}</Alert>
        <Link href="/home" className="link mt-5 inline-block text-sm text-fg">
          Back to Home
        </Link>
      </AppShell>
    );
  }

  if (!review) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl">
          <ReviewSkeleton />
        </div>
      </AppShell>
    );
  }

  const playtime = formatPlaytime(review.playtime_minutes);
  const isOwner = user?.id === review.author.id;

  const interactions: ReviewInteractions = {
    review_id: review.id,
    like_count: review.like_count,
    comment_count: review.comment_count,
    viewer_has_liked: review.viewer_has_liked,
  };

  /** Fold what the like endpoint reported back into the review this page holds. */
  function applyInteractions(result: ReviewInteractions) {
    setReview((current) =>
      current === null
        ? current
        : {
            ...current,
            like_count: result.like_count,
            comment_count: result.comment_count,
            viewer_has_liked: result.viewer_has_liked,
          },
    );
  }

  /**
   * Move the comment count by what the thread just added or removed.
   *
   * A delta applied to the current value rather than a total computed from this
   * render's: two comments posted in quick succession would otherwise both be
   * counted against the same starting number, and the second would erase the
   * first.
   */
  function bumpCommentCount(delta: number) {
    setReview((current) =>
      current === null
        ? current
        : { ...current, comment_count: Math.max(current.comment_count + delta, 0) },
    );
  }

  return (
    <AppShell>
      <article className="mx-auto max-w-2xl">
        {/* The game is the headline and the reviewer is the byline, in that
            order — this is a review *of something*, and a page that leads with
            the author reads like a profile. */}
        <Eyebrow className="mb-4">
          <Link href={`/games/${review.game.id}`} className="link-quiet text-fg-dim">
            {releaseYearLabel(review.game.release_year)}
          </Link>
        </Eyebrow>

        <h1 className="type-display text-4xl text-fg sm:text-5xl">
          <Link href={`/games/${review.game.id}`} className="link-quiet">
            {review.game.title}
          </Link>
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <StarRating rating={review.rating} size={20} />
          <span className="type-eyebrow tabular-nums text-fg-dim">
            {formatStars(review.rating)} / 5
          </span>
          {playtime ? (
            <>
              <span aria-hidden className="h-3 w-px bg-line" />
              <span className="type-eyebrow text-fg-faint">Played {playtime}</span>
            </>
          ) : null}
        </div>

        <header className="mt-7 flex items-center gap-3 border-y border-line py-4">
          <Link href={profilePath(review.author.username)} className="shrink-0">
            <Avatar user={review.author} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={profilePath(review.author.username)}
              className="link-quiet text-sm font-medium text-fg"
            >
              {review.author.display_name ?? review.author.username}
            </Link>
            <p className="type-eyebrow mt-1 text-fg-faint">@{review.author.username}</p>
          </div>
          {isOwner ? (
            <Link
              href={`/reviews/${review.id}/edit`}
              className={buttonStyles({ variant: "secondary", size: "sm" })}
            >
              Edit
            </Link>
          ) : null}
        </header>

        {review.media.length > 0 ? (
          <div className="mt-7">
            <MediaCarousel items={review.media} title={review.game.title} />
          </div>
        ) : null}

        {review.review_text ? (
          <p className="prose-review mt-7 whitespace-pre-line text-fg-dim">{review.review_text}</p>
        ) : null}

        {/* SPEC §6.9's third entry point. Reading somebody's review is the
            moment a reader decides they want to play the thing, and making
            them go and find it again would waste that. */}
        <div className="mt-9 rounded-lg border border-line bg-surface p-4">
          <Eyebrow className="mb-3">Add {review.game.title} to a list</Eyebrow>
          <BacklogControl game={review.game} className="max-w-[14rem]" />
        </div>

        <footer className="mt-8 flex items-center gap-2 border-t border-line pt-3">
          <LikeButton interactions={interactions} onChange={applyInteractions} />
          <span className="type-eyebrow px-2.5 tabular-nums text-fg-faint">
            {commentCountLabel(review.comment_count)}
          </span>
        </footer>

        <CommentSection reviewId={review.id} onCountChange={bumpCommentCount} />
      </article>
    </AppShell>
  );
}
