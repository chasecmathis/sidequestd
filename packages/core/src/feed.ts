/**
 * Home feed rules (SPEC §6.4, §6.11).
 *
 * The narrowing helpers are the point of this file. Home is a union — reviews
 * and backlog activity, ordered together — so the client branches on `item.type`
 * rather than reaching into a payload that may not be there. That was true
 * before activity existed, which is why adding it cost one helper and one branch
 * instead of a rewrite.
 */
import type {
  FeedActivityItem,
  FeedItem,
  FeedRecommendedItem,
  FeedReviewItem,
  RecommendationReason,
} from "@sidequestd/api-types";

/**
 * Rows per request.
 *
 * Smaller than the 20 the API defaults to: a feed row is a whole card with an
 * image, so ten is already more than a screenful, and the next page is fetched
 * before the reader reaches the bottom anyway.
 */
export const FEED_PAGE_SIZE = 10;

/** How far ahead of the viewport the next page starts loading. */
export const FEED_PREFETCH_MARGIN = "600px";

export function feedQuery({ cursor, limit = FEED_PAGE_SIZE }: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `/feed?${params.toString()}`;
}

/** Whether this item is a review. See the module note on why it is a function. */
export function isReviewItem(item: FeedItem): item is FeedReviewItem {
  return item.type === "review";
}

/** Whether this item is a backlog status change (SPEC §6.11). */
export function isActivityItem(item: FeedItem): item is FeedActivityItem {
  return item.type === "backlog_activity";
}

/** Whether this item was blended in rather than followed for (SPEC §6.4). */
export function isRecommendedItem(item: FeedItem): item is FeedRecommendedItem {
  return item.type === "recommended_review";
}

/**
 * The label a recommended row wears.
 *
 * SPEC §6.4 asks for the blend to be "clearly distinguishable from pure follow
 * feed", and a reader who cannot tell why a stranger is in their Home has been
 * given an advert rather than a recommendation. The wording lives here and not
 * in the API for the same reason every other phrasing does: changing what it
 * says should not need a deploy of the server.
 */
export const RECOMMENDATION_LABELS: Record<RecommendationReason, string> = {
  recommended_game: "Because of games you rated",
  suggested_account: "From someone who rates like you",
};

export function recommendationLabel(reason: RecommendationReason): string {
  return RECOMMENDATION_LABELS[reason];
}

/**
 * A React key that stays unique once other item types arrive.
 *
 * Read off the envelope, never `item.review.id`: this runs for *every* item,
 * including a kind this build has never heard of, and reaching inside one of
 * those would crash the list before `isReviewItem` ever got the chance to skip
 * it. Keyed by kind and id together, because an activity event and a review are
 * different rows that may well carry the same underlying uuid.
 */
export function feedItemKey(item: FeedItem): string {
  return `${item.type}:${item.id}`;
}

/** Where the comment shortcut on a feed row goes (SPEC §6.4). */
export function commentsPath(reviewId: string): string {
  return `/reviews/${reviewId}#comments`;
}

/**
 * The one-line summary a card shows, or null when there is nothing to show.
 *
 * Truncated on a word boundary so a card never ends mid-word, and only when the
 * text is actually longer than the limit — an ellipsis on a review that fits
 * would promise more than the detail page has.
 */
export function excerpt(text: string | null, limit = 240): string | null {
  if (text === null) return null;

  const collapsed = text.trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length <= limit) return collapsed;

  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
