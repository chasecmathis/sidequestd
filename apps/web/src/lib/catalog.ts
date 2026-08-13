/**
 * Query building for the games catalog endpoints.
 *
 * Kept out of the components so the URL shape — which is the actual contract
 * with the API — is testable without rendering anything.
 */
import { formatStars } from "./reviews";
import type { GameSort } from "@sidequestd/api-types";

/**
 * IGDB publishes out of 100; we store out of 10 and show out of 5.
 *
 * The two are never converted into each other. They are different measurements
 * by different populations, and the game detail block shows them as two — see
 * `GameScores`.
 */
export const IGDB_MAX_RATING = 100;

export interface BrowseFilters {
  genres?: string[];
  platforms?: string[];
  sort?: GameSort;
  cursor?: string | null;
  limit?: number;
}

/** `?genre=indie&genre=puzzle&platform=…` — repeated keys, not comma-joined. */
export function browseQuery({ genres, platforms, sort, cursor, limit }: BrowseFilters): string {
  const params = new URLSearchParams();
  genres?.forEach((slug) => params.append("genre", slug));
  platforms?.forEach((slug) => params.append("platform", slug));
  if (sort) params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));

  const query = params.toString();
  return query ? `/games?${query}` : "/games";
}

export function searchQuery(kind: "games" | "users", term: string, cursor?: string | null): string {
  const params = new URLSearchParams({ q: term });
  if (cursor) params.set("cursor", cursor);
  return `/search/${kind}?${params.toString()}`;
}

/** Add or remove one slug from a facet, so filter chips can toggle. */
export function toggleFacet(selected: string[], slug: string): string[] {
  return selected.includes(slug) ? selected.filter((value) => value !== slug) : [...selected, slug];
}

/**
 * Selected options first, each group otherwise keeping the order the API sent.
 *
 * The catalog returns every genre and every platform, unbounded, so the browse
 * facets are shown a row at a time (see `visibleFacetOptions`). Pinning is what
 * makes that safe: whichever chips are doing the filtering sort to the front, so
 * collapsing the list can never hide the reason the results look the way they do.
 */
export function orderFacetOptions<T extends { slug: string }>(
  options: T[],
  selected: string[],
): T[] {
  const active = options.filter((option) => selected.includes(option.slug));
  const rest = options.filter((option) => !selected.includes(option.slug));
  return [...active, ...rest];
}

/**
 * What a collapsed facet group shows: every selected option, then unselected
 * ones up to `limit`.
 *
 * The limit is a floor rather than a cap when a lot is selected — eleven active
 * chips are all shown even though `limit` is eight. Truncating the filter itself
 * would be the one thing collapsing must not do.
 */
export function visibleFacetOptions<T extends { slug: string }>(
  ordered: T[],
  selected: string[],
  expanded: boolean,
  limit: number,
): T[] {
  if (expanded) return ordered;

  const selectedCount = ordered.filter((option) => selected.includes(option.slug)).length;
  return ordered.slice(0, Math.max(limit, selectedCount));
}

export function releaseYearLabel(releaseYear: number | null | undefined): string {
  return releaseYear ? String(releaseYear) : "TBA";
}

/**
 * Our average as a reader sees it — "3.7" — or null when nobody has rated it.
 *
 * Just the numeral: the detail block sets the "/ 5" a size down and a shade
 * quieter, which gluing them into one string would make impossible. Built on
 * `formatStars` so a game's average and a single review's score can never
 * disagree about what an 8 looks like.
 */
export function formatGameRating(average: number | null | undefined): string | null {
  return average === null || average === undefined ? null : formatStars(average);
}

/**
 * IGDB's score, rounded — "87" — or null when they have none.
 *
 * The null check is explicit rather than falsy on purpose: 0 is a score IGDB can
 * publish, and `!rating` would hide it as though the game were unrated.
 */
export function formatIgdbRating(rating: number | null | undefined): string | null {
  return rating === null || rating === undefined ? null : String(Math.round(rating));
}

/** How full the IGDB meter runs, 0-1. Clamped, so a bad value cannot overrun the track. */
export function igdbMeterFill(rating: number): number {
  return Math.min(Math.max(rating / IGDB_MAX_RATING, 0), 1);
}

/**
 * "1 rating" / "1,204 ratings", or null when there are none to name.
 *
 * Null rather than "0 ratings": the caller says "Not yet rated" in that case,
 * which is the same fact without making the reader do the inference.
 */
export function ratingCountLabel(count: number | null | undefined): string | null {
  if (!count) return null;
  return `${count.toLocaleString("en-US")} ${count === 1 ? "rating" : "ratings"}`;
}
