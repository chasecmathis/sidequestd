"use client";

/**
 * Search as both clients run it (SPEC §6.6): debounced, newest term wins,
 * paged by cursor.
 *
 * Five components used to carry their own copy of this — both Search screens
 * and three game pickers — and only the Search screens had the guard that stops
 * a late page landing under results for a newer term. One hook is one place
 * for that guard to live, and one place for the debounce that keeps a typist
 * inside the server's rate limit (SPEC §9).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { GamePage, UserSearchPage } from "@sidequestd/api-types";

import { useAuth } from "./auth";
import { searchQuery } from "./catalog";

/** Long enough to skip a syllable, short enough not to feel typed-at. */
export const SEARCH_DEBOUNCE_MS = 250;

interface SearchPages {
  games: GamePage;
  users: UserSearchPage;
}

export type SearchKind = keyof SearchPages;
export type SearchResult<K extends SearchKind> = SearchPages[K]["items"][number];

export interface SearchOptions {
  /** Page size. The pickers ask for fewer than a full page. */
  limit?: number;
  debounceMs?: number;
  /** False behaves like a blank term: no request, no results. */
  enabled?: boolean;
}

export interface SearchState<T> {
  items: T[];
  /** Page one is on its way, debounce included. */
  searching: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}

/** What each kind of search says before anything has been typed. */
export const SEARCH_PROMPTS: Record<SearchKind, string> = {
  games: "Search the catalog by title.",
  users: "Search by handle or display name.",
};

/** The empty result, naming what was searched for. */
export function noSearchMatches(kind: SearchKind, term: string): string {
  return `No ${kind} match “${term.trim()}”.`;
}

function failure(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Search failed.";
}

export function useSearch<K extends SearchKind>(
  kind: K,
  term: string,
  { limit, debounceMs = SEARCH_DEBOUNCE_MS, enabled = true }: SearchOptions = {},
): SearchState<SearchResult<K>> {
  const { authedRequest } = useAuth();
  const query = enabled ? term.trim() : "";

  const [items, setItems] = useState<SearchResult<K>[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // What the caller is showing right now, readable after an await. See loadMore.
  const latest = useRef({ query, kind, limit });
  latest.current = { query, kind, limit };

  useEffect(() => {
    if (!query) {
      setItems([]);
      setNextCursor(null);
      setError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      authedRequest<SearchPages[K]>(searchQuery(kind, query, null, limit))
        .then((page) => {
          if (cancelled) return;
          setItems(page.items);
          setNextCursor(page.next_cursor);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          // Cleared rather than kept: what is on screen answered an older term.
          setItems([]);
          setNextCursor(null);
          setError(failure(cause));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authedRequest, kind, query, limit, debounceMs]);

  /**
   * The next page.
   *
   * The stale check is why this is not a bare append. A page can still be in
   * flight when the reader types another character, and the debounced effect
   * has no idea this request exists — without the guard, results for "ma" would
   * land underneath results for "mario". It reads the ref rather than the
   * closure: the closure captured its values when `loadMore` was built, so
   * comparing against those would be comparing a value to itself.
   */
  const loadMore = useCallback(async () => {
    if (!nextCursor || !query) return;

    const isStale = () =>
      latest.current.query !== query ||
      latest.current.kind !== kind ||
      latest.current.limit !== limit;

    setLoadingMore(true);
    try {
      const page = await authedRequest<SearchPages[K]>(searchQuery(kind, query, nextCursor, limit));
      if (isStale()) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (!isStale()) setError(failure(cause));
    } finally {
      setLoadingMore(false);
    }
  }, [authedRequest, kind, limit, nextCursor, query]);

  return { items, searching, error, hasMore: nextCursor !== null, loadingMore, loadMore };
}
