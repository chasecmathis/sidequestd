/**
 * Presentation and client-side validation for reviews.
 *
 * Same reason as `catalog.ts` and `profile.ts`: the rules are the interesting
 * part and they are worth testing without rendering a tree to reach them.
 *
 * The limits here mirror SPEC §6.3 so a file that cannot possibly be accepted is
 * refused before it is uploaded. The server checks all of it again — these are
 * for the user's benefit, not the API's.
 */
import type { ReviewMediaItem, ReviewSummary } from "@sidequestd/api-types";

export const MIN_RATING = 1;
export const MAX_RATING = 10;
export const MAX_MEDIA_PER_REVIEW = 10;
export const REVIEW_TEXT_MAX_LENGTH = 5000;

const HOURS_PER_DAY = 24;

const MEGABYTE = 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * MEGABYTE;
export const MAX_VIDEO_BYTES = 100 * MEGABYTE;

/** What the file picker offers. The server sniffs the bytes regardless. */
export const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime";

/** The 0.5-5.0 value SPEC §6.3 displays, from the 1-10 integer it stores. */
export function toStars(rating: number): number {
  return rating / 2;
}

/** "4.5" — trailing zero kept, so a column of ratings lines up. */
export function formatStars(rating: number): string {
  return toStars(rating).toFixed(1);
}

/**
 * How full the nth star is, 0 to 1.
 *
 * Star 3 of a 7 (3.5 stars) is half full; every star before it is whole and
 * every star after it is empty.
 */
export function starFill(rating: number, index: number): number {
  return Math.min(Math.max(toStars(rating) - index, 0), 1);
}

/**
 * "15.5h", "6d 22h", or null when the author did not track it (SPEC §6.3).
 *
 * Playtime is counted in hours, so hours are the unit and days take over once a
 * figure stops being readable in them — "173.5h" is hard to picture, "7d 5h" is
 * not. Stored in minutes because that is what the API takes, but a bare minute
 * count is only shown below an hour, where rounding to "0h" would be worse than
 * useless.
 */
export function formatPlaytime(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;

  const hours = minutes / 60;
  if (hours < 1) return `${Math.round(minutes)}m`;
  // One decimal, and no trailing ".0": "15.5h" but "2h".
  if (hours < HOURS_PER_DAY) return `${Math.round(hours * 10) / 10}h`;

  let days = Math.floor(hours / HOURS_PER_DAY);
  let rest = Math.round(hours % HOURS_PER_DAY);
  if (rest === HOURS_PER_DAY) {
    // 47.9h rounds to 24 remaining hours, which is a day, not "1d 24h".
    days += 1;
    rest = 0;
  }
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

export function reviewPath(id: string): string {
  return `/reviews/${id}`;
}

export function isVideo(item: Pick<ReviewMediaItem, "type">): boolean {
  return item.type === "VIDEO";
}

/**
 * Whether a tile should show a "still processing" hint.
 *
 * READY and FAILED are both settled: a failed item still has its original to
 * show, so the carousel renders it rather than hiding what the user uploaded.
 */
export function isProcessing(item: Pick<ReviewMediaItem, "processing_status">): boolean {
  return item.processing_status === "PENDING" || item.processing_status === "PROCESSING";
}

/** What a grid tile renders. Already resolved by the API — see `ReviewSummary`. */
export function tileImage(review: Pick<ReviewSummary, "thumbnail_url">): string | null {
  return review.thumbnail_url;
}

/**
 * Why a file cannot be attached, or null if it can.
 *
 * `existing` is what is already on the review, so the count and the one-video
 * rule are judged against the whole carousel rather than against this batch.
 */
export function rejectMedia(
  file: File,
  existing: { images: number; videos: number },
): string | null {
  const video = file.type.startsWith("video/");

  if (existing.images + existing.videos >= MAX_MEDIA_PER_REVIEW) {
    return `A review can hold at most ${MAX_MEDIA_PER_REVIEW} photos or clips.`;
  }
  if (video && existing.videos >= 1) {
    return "A review can include one video clip.";
  }
  if (video && file.size > MAX_VIDEO_BYTES) {
    return "Clips must be 100 MB or smaller.";
  }
  if (!video && file.size > MAX_IMAGE_BYTES) {
    return "Photos must be 15 MB or smaller.";
  }
  return null;
}

/** Running tally of what a carousel holds, for `rejectMedia`. */
export function tally(items: { isVideo: boolean }[]): { images: number; videos: number } {
  return {
    images: items.filter((item) => !item.isVideo).length,
    videos: items.filter((item) => item.isVideo).length,
  };
}
