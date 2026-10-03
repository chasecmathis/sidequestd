/**
 * Presentation rules for likes and comments (SPEC §6.10).
 *
 * Same reason as `social.ts`: what a like button says, and what a comment box
 * will refuse to send, is the interesting part and is worth testing without
 * rendering a tree to reach it.
 *
 * The length limits mirror the API's so a comment that cannot be accepted is
 * caught before the round trip. The server checks again — these are for the
 * person typing, not for the API.
 */
import type { CommentItem, ReviewInteractions } from "@sidequestd/api-types";

export const COMMENT_MAX_LENGTH = 500;

/** One screenful of threads. There is no paging control on the screen yet. */
export const COMMENTS_PAGE_SIZE = 20;

/** How close to the cap the counter starts warning. */
const COUNTER_VISIBLE_FROM = 400;

/** The request a press should send, given what the button currently shows. */
export function likeRequest(liked: boolean, reviewId: string): { path: string; method: string } {
  return { path: `/reviews/${reviewId}/like`, method: liked ? "DELETE" : "POST" };
}

/**
 * What pressing it would do, for a screen reader.
 *
 * The visible control is a heart and a number, which says nothing out loud; the
 * accessible name has to describe the action rather than the state.
 */
export function likeActionLabel(liked: boolean): string {
  return liked ? "Unlike this review" : "Like this review";
}

/** Where the button lands before the server answers. */
export function optimisticLike(current: ReviewInteractions): ReviewInteractions {
  const liked = !current.viewer_has_liked;
  return {
    ...current,
    viewer_has_liked: liked,
    // Never below zero: a count and a like state that arrived in separate
    // responses can disagree for a frame, and "-1 likes" is a worse way to show
    // it than a number that simply does not move.
    like_count: Math.max(current.like_count + (liked ? 1 : -1), 0),
  };
}

/** "1 like" / "2 likes" — the count is always shown, including zero. */
export function likeCountLabel(count: number): string {
  return `${count} ${count === 1 ? "like" : "likes"}`;
}

export function commentCountLabel(count: number): string {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

/** Why a comment cannot be sent, or null if it can. */
export function rejectComment(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "Write something first.";
  if (trimmed.length > COMMENT_MAX_LENGTH) {
    return `Comments are limited to ${COMMENT_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * "412 / 500", or null while the length is not worth mentioning.
 *
 * Hidden until the cap is close: a counter on an empty box is noise, and one
 * that appears as you approach the limit is a warning.
 */
export function commentCounter(text: string): string | null {
  const length = text.trim().length;
  if (length < COUNTER_VISIBLE_FROM) return null;
  return `${length} / ${COMMENT_MAX_LENGTH}`;
}

/** Whether the signed-in user may edit or delete this comment (SPEC §6.10). */
export function ownsComment(comment: Pick<CommentItem, "author">, viewerId?: string): boolean {
  return viewerId !== undefined && comment.author.id === viewerId;
}

/**
 * "just now", "4h", "12 Mar" — how a comment is timestamped.
 *
 * Relative while it is recent enough for "when" to mean something to the reader,
 * absolute once it stops being. Same shape as every social product, and the
 * reason it is here rather than inline is that the boundaries are worth testing.
 */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max((now.getTime() - then.getTime()) / 1000, 0);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;

  return then.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
