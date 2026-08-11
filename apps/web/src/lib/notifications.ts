/**
 * How a notification reads and where it goes (SPEC §6.12).
 *
 * The API sends the *parts* of a sentence — who, what happened, what it happened
 * to — and never the sentence, so the wording lives here. That is what makes it
 * changeable without a deploy of the API, and what keeps the row component free
 * of a seven-way switch.
 *
 * Everything is a pure function of one item, so the phrasing and the link target
 * can both be tested without rendering anything.
 */
import type { NotificationItem, NotificationType } from "@sidequestd/api-types";

import { profilePath } from "./profile";

export const NOTIFICATIONS_PATH = "/notifications";

/** One screenful. There is no paging control on the tab yet. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * How often the badge re-asks for the unread count.
 *
 * Delivery is in-app only in this version — SPEC §6.12 names push as post-MVP —
 * so a poll is the whole of "realtime". A minute is slow enough to be free and
 * fast enough that a badge is never stale in a way anyone notices, and every
 * action that could change the count refreshes it directly anyway.
 */
export const UNREAD_POLL_MS = 60_000;

/** Badges stop counting here; past it the number is wider than the dot. */
const BADGE_CAP = 99;

/**
 * What the actor did, as it reads *after* their name.
 *
 * Written as whole clauses rather than assembled from a verb and an object,
 * because the two halves are not independent in every language and a template
 * that works for "liked your review of X" quietly breaks on "replied to your
 * comment", which has no object at all.
 */
const PHRASES: Record<NotificationType, (game: string | null) => string> = {
  NEW_FOLLOWER: () => "started following you",
  FOLLOW_REQUEST: () => "asked to follow you",
  FOLLOW_REQUEST_APPROVED: () => "approved your follow request",
  REVIEW_LIKED: (game) => (game ? `liked your review of ${game}` : "liked your review"),
  REVIEW_COMMENTED: (game) =>
    game ? `commented on your review of ${game}` : "commented on your review",
  COMMENT_REPLIED: () => "replied to your comment",
  BACKLOG_GAME_REVIEWED: (game) =>
    game ? `reviewed ${game}, which is on your list` : "reviewed a game on your list",
};

/**
 * The sentence a row shows, minus the actor's name.
 *
 * Every phrase survives a missing target: the review a notification pointed at
 * can be deleted, and the row it left behind should still say something true
 * rather than "liked your review of undefined".
 */
export function notificationText(item: NotificationItem): string {
  return PHRASES[item.type](item.review?.game.title ?? null);
}

/**
 * Where tapping the row goes, or null when there is nowhere to send them.
 *
 * The comment target wins over the review: a reply is only findable in the
 * thread, and landing on the review with the conversation collapsed below the
 * fold is landing in the wrong place. Everything with no target at all is about
 * a person, so it goes to their profile.
 */
export function notificationHref(item: NotificationItem): string | null {
  if (item.comment) return `/reviews/${item.comment.review_id}#comments`;
  if (item.review) return `/reviews/${item.review.id}`;
  if (item.actor) return profilePath(item.actor.username);
  return null;
}

/** "3", "99+", or null when there is nothing to show. */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/** What the tab is called out loud when it is carrying a number. */
export function badgeAriaLabel(count: number): string {
  if (count <= 0) return "Notifications";
  return `Notifications, ${count} unread`;
}

/** The ids on a page that are still unread — what "mark all" on it would send. */
export function unreadIds(items: NotificationItem[]): string[] {
  return items.filter((item) => !item.is_read).map((item) => item.id);
}
