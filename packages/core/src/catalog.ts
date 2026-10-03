/**
 * Query building for the games catalog endpoints.
 *
 * Kept out of the components so the URL shape — which is the actual contract
 * with the API — is testable without rendering anything.
 */
import { formatStars } from "./reviews";
import type { GameSort, StoreLink } from "@sidequestd/api-types";

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
 * Keeping it matters: the API sends facets widest-coverage-first, so the chips
 * a reader would plausibly filter by are the ones a collapsed group shows. Any
 * re-sort here would undo that and put the catalog's 1970s chip sets back in
 * the first row.
 *
 * Pinning is the other half of what makes collapsing safe (see
 * `visibleFacetOptions`): whichever chips are doing the filtering sort to the
 * front, so a collapsed group can never hide the reason the results look the
 * way they do.
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

/** A store link the client can actually send somebody to. */
export interface LinkableStore {
  source: string;
  label: string;
  url: string;
}

/**
 * The store links worth rendering — the ones with an address.
 *
 * The API deliberately hands over ids it has no URL template for rather than
 * dropping them, because `source` is a free string so that a new store appearing
 * upstream widens the catalog instead of failing an import. That leaves the
 * filtering here, and it has to happen: a label with nowhere to go is a link
 * that looks broken.
 *
 * Also tolerates the field being absent altogether, which is what an older cached
 * response or a summary shape would give us.
 */
export function linkableStores(links: StoreLink[] | null | undefined): LinkableStore[] {
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) =>
    link.url ? [{ source: link.source, label: link.label, url: link.url }] : [],
  );
}

/**
 * The accessible name for a store link.
 *
 * Not optional. The visible text is the single word "Steam", which tells a
 * screen-reader user nothing about which game it opens or that it leaves the
 * site — and a page listing several links would announce the same word for each.
 */
export function storeLinkLabel(store: LinkableStore, gameTitle: string): string {
  return `View ${gameTitle} on ${store.label} (opens in a new tab)`;
}

/**
 * A store's mark, as a path. Viewbox is 24×24, like `STAR_PATH`.
 *
 * Drawn rather than fetched: an inline path costs no request and no CSP
 * exception on the web, has no asset to bundle on native, and — being filled
 * with a colour the caller chooses rather than baked into a PNG — follows the
 * theme instead of disappearing against paper.
 *
 * Here rather than in either client for the reason `STAR_PATH` is: three
 * surfaces now draw Steam — the connect card on both settings screens and the
 * store link in a game's metadata line — and a hand-copied path string is how
 * two clients quietly start disagreeing about what a logo looks like.
 *
 * Keyed by `StoreLink.source`, which is a free string precisely so that a store
 * appearing upstream widens the catalog rather than failing an import. So most
 * sources have no mark, and that is the normal case rather than an omission:
 * `storeMarkPath` returns null and every caller draws the label alone. A generic
 * box in its place would read as a broken image rather than as "we have no mark
 * for this one".
 */
export const STORE_MARK_PATHS: Record<string, string> = {
  steam:
    "M11.98 2a10 10 0 0 0-9.96 9.19l5.34 2.2a2.82 2.82 0 0 1 1.6-.49h.14l2.38-3.44v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.39 2.42v.12a2.83 2.83 0 0 1-5.61.5l-3.82-1.58A10 10 0 1 0 11.98 2Zm-3.6 15.17a2.18 2.18 0 0 0 2.83-1.18 2.17 2.17 0 0 0-1.18-2.83l-.9-.37a2.5 2.5 0 0 1 1.9 4.62l-1.56-.64a2.2 2.2 0 0 0 .9.4Zm8.87-6.9a2.51 2.51 0 1 0-5.02 0 2.51 2.51 0 0 0 5.02 0Zm-4.39 0a1.89 1.89 0 1 1 1.88 1.87 1.88 1.88 0 0 1-1.88-1.88Z",
};

/** The mark for a store source, or null when we have none. */
export function storeMarkPath(source: string): string | null {
  return STORE_MARK_PATHS[source] ?? null;
}
