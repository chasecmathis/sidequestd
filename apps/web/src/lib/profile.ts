/**
 * Presentation helpers for profiles.
 *
 * Same reason as `catalog.ts`: the formatting rules are the interesting part and
 * they are worth testing without rendering a tree to get at them.
 */
import type { ProfileStats, UserPublic } from "@sidequestd/api-types";

import { formatPlaytime as formatReviewPlaytime } from "./reviews";

/** The letter shown in place of a missing avatar. */
export function avatarInitial(user: Pick<UserPublic, "username" | "display_name">): string {
  const source = user.display_name?.trim() || user.username;
  return source.slice(0, 1).toUpperCase();
}

export function profilePath(username: string): string {
  return `/profile/${username}`;
}

/**
 * How many games a profile may pin.
 *
 * Mirrors `MAX_FAVORITE_GAMES` in the API (`app/models/user.py`), which is the
 * authority — this copy exists so the editor can draw the empty slots and refuse
 * a seventh *before* the request, rather than surfacing the 409 as an error. If
 * the two ever disagree the server still wins; the cost is a stale-looking grid,
 * not a wrong write.
 */
export const MAX_FAVORITE_GAMES = 6;

/** The slot numerals, `01`–`06`, matching the mono numbering used elsewhere. */
export function slotLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * One step of a reorder, as the ids the API wants back.
 *
 * `PUT /users/me/favorites` takes the *whole* list as a permutation rather than
 * a (from, to) pair, so this returns the full array. Out-of-range moves return
 * the input untouched, which is what lets the first and last slots render their
 * arrows as ordinary disabled buttons instead of conditionally omitting them —
 * a control that vanishes at the end of a list is a moving target.
 */
export function moveFavorite<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** "1,204" — thousands separators, because follower counts get large. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Ratings are stored 1-10 (half-star stops), so a mean of 8 is four stars.
 * Null means nothing has been rated — not zero. See `ProfileStats`.
 */
export function formatAverageRating(average: number | null | undefined): string {
  if (average === null || average === undefined) return "—";
  return `${(average / 2).toFixed(1)} / 5`;
}

/**
 * "6d 22h", or "—" when nothing was tracked. SPEC §6.8 "if provided".
 *
 * Thin wrapper over the review formatter rather than a second implementation:
 * this is the same number a review shows, summed, and two copies of the rule
 * would eventually disagree about it. The profile renders a dash where a review
 * renders nothing, which is the only difference.
 */
export function formatPlaytime(minutes: number): string {
  return formatReviewPlaytime(minutes) ?? "—";
}

export interface StatTile {
  label: string;
  value: string;
}

/** The headline figures from SPEC §6.8, in the order the profile shows them. */
export function statTiles(stats: ProfileStats): StatTile[] {
  return [
    { label: "Reviews", value: formatCount(stats.review_count) },
    { label: "Games reviewed", value: formatCount(stats.games_reviewed) },
    { label: "Average rating", value: formatAverageRating(stats.average_rating) },
    { label: "Playtime", value: formatPlaytime(stats.total_playtime_minutes) },
    { label: "Completed", value: formatCount(stats.completed_count) },
    { label: "Backlog", value: formatCount(stats.backlog_count) },
  ];
}

/**
 * Bar heights as percentages of the tallest bucket.
 *
 * Scaled to the peak rather than to the total so a distribution with one
 * dominant rating still shows the shape of the rest. An all-zero distribution
 * gives every bar 0, which renders as a flat baseline instead of dividing by zero.
 */
export function distributionHeights(stats: ProfileStats): number[] {
  const counts = stats.rating_distribution.map((entry) => entry.count);
  const peak = Math.max(...counts, 0);
  return counts.map((count) => (peak === 0 ? 0 : Math.round((count / peak) * 100)));
}
