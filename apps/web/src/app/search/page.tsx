"use client";

/**
 * Search — SPEC §6.6. Games by title, users by handle or display name.
 *
 * The user tab renders private accounts as shells: the API withholds their stats
 * unless the viewer is approved (SPEC §6.7), and the card says so rather than
 * showing a zero that would read as "no reviews".
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Search as SearchIcon } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { BacklogControl } from "@/components/backlog-control";
import { GameGrid } from "@/components/game-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inputStyles } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { GameGridSkeleton, ListSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { searchQuery } from "@/lib/catalog";
import { profilePath } from "@/lib/profile";
import type {
  GamePage,
  GameSummary,
  UserSearchPage,
  UserSearchResult,
} from "@sidequestd/api-types";

type Tab = "games" | "users";

const DEBOUNCE_MS = 250;

function UserRow({ user }: { user: UserSearchResult }) {
  return (
    <li>
      <Link
        href={profilePath(user.username)}
        className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors duration-200 hover:border-line-strong"
      >
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-2">
          {user.avatar_url ? (
            <Image src={user.avatar_url} alt="" fill sizes="40px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-sm text-fg-dim">
              {user.username.charAt(0).toUpperCase()}
            </span>
          )}
        </span>

        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">@{user.username}</span>
          <span className="type-eyebrow mt-1 block truncate text-fg-faint">
            {user.display_name ?? "No display name"}
          </span>
        </span>

        <span className="type-eyebrow ml-auto shrink-0 text-right text-fg-faint">
          {user.review_count === null ? (
            // Null means gated, not zero — saying "0 reviews" would be a lie.
            <span className="rounded-full border border-line px-2.5 py-1.5">
              {user.is_private ? "Private account" : "Hidden"}
            </span>
          ) : (
            `${user.review_count} review${user.review_count === 1 ? "" : "s"}`
          )}
        </span>
      </Link>
    </li>
  );
}

export default function SearchPage() {
  const { authedRequest } = useAuth();

  const [tab, setTab] = useState<Tab>("games");
  const [term, setTerm] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [users, setUsers] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One cursor rather than one per tab: this effect already re-runs when `tab`
  // changes, so switching tabs refetches page one and resets the cursor with it.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // What the reader is looking at right now, readable from inside an awaited
  // request. See `loadMore`.
  const latest = useRef({ term, tab });
  latest.current = { term, tab };

  useEffect(() => {
    const query = term.trim();
    if (!query) {
      setGames([]);
      setUsers([]);
      setNextCursor(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    // Debounced: one request per pause, not one per keystroke — search is rate
    // limited server-side (SPEC §9).
    const timer = setTimeout(() => {
      const request =
        tab === "games"
          ? authedRequest<GamePage>(searchQuery("games", query)).then((page) => {
              if (cancelled) return;
              setGames(page.items);
              setNextCursor(page.next_cursor);
            })
          : authedRequest<UserSearchPage>(searchQuery("users", query)).then((page) => {
              if (cancelled) return;
              setUsers(page.items);
              setNextCursor(page.next_cursor);
            });

      request
        .then(() => {
          if (!cancelled) setError(null);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Search failed.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authedRequest, term, tab]);

  /**
   * The next page of whichever tab is open.
   *
   * The stale check is the reason this is not a bare append. A page can still be
   * in flight when the reader types another character, and the debounced effect
   * above has no idea this request exists — without the guard, results for "ma"
   * would land underneath results for "mario".
   *
   * It reads the term and tab off a ref rather than off the closure: the closure
   * captured them when `loadMore` was built, so comparing against those would be
   * comparing a value to itself. The ref is what the component is showing *now*,
   * which is the thing the response has to still agree with.
   */
  const loadMore = useCallback(async () => {
    if (!nextCursor) return;

    const query = term.trim();
    const forTab = tab;
    const isStale = () => latest.current.term.trim() !== query || latest.current.tab !== forTab;

    setLoadingMore(true);
    try {
      if (forTab === "games") {
        const page = await authedRequest<GamePage>(searchQuery("games", query, nextCursor));
        if (isStale()) return;
        setGames((current) => [...current, ...page.items]);
        setNextCursor(page.next_cursor);
      } else {
        const page = await authedRequest<UserSearchPage>(searchQuery("users", query, nextCursor));
        if (isStale()) return;
        setUsers((current) => [...current, ...page.items]);
        setNextCursor(page.next_cursor);
      }
    } catch (cause) {
      if (!isStale()) setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setLoadingMore(false);
    }
  }, [authedRequest, latest, nextCursor, tab, term]);

  const results = tab === "games" ? games : users;
  const hasQuery = term.trim().length > 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Games and people"
        title="Search"
        description="Find a game to review or add to a list, or find someone to follow."
      />

      <div className="mt-8">
        <label htmlFor="search-term" className="sr-only">
          Search {tab}
        </label>
        <input
          id="search-term"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={tab === "games" ? "Elden Ring" : "ripley"}
          autoComplete="off"
          className={inputStyles({ className: "px-4 py-3 text-base" })}
        />
      </div>

      <div className="mt-4 flex gap-1" role="tablist" aria-label="Search type">
        {(["games", "users"] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`type-eyebrow rounded-md px-3.5 py-2.5 transition-colors duration-150 ${
              tab === value ? "bg-surface-2 text-fg" : "text-fg-faint hover:text-fg-dim"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error ? (
        <Alert tone="error" className="mt-6">
          {error}
        </Alert>
      ) : null}

      <div className="mt-8">
        {!hasQuery ? (
          <EmptyState
            icon={SearchIcon}
            description={
              tab === "games" ? "Search the catalog by title." : "Search by handle or display name."
            }
          />
        ) : results.length === 0 ? (
          searching ? (
            tab === "games" ? (
              <GameGridSkeleton label="Searching games" />
            ) : (
              <ListSkeleton label="Searching people" />
            )
          ) : (
            <EmptyState description={`No ${tab} match “${term.trim()}”.`} />
          )
        ) : tab === "games" ? (
          // SPEC §6.9 names Search as one of the three places a game joins a
          // list, which is the whole point of finding it here.
          <GameGrid games={games} action={(game) => <BacklogControl game={game} />} />
        ) : (
          <ul className="space-y-2">
            {users.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </ul>
        )}
      </div>

      {/* Only when there is genuinely another page. Results come back ranked by
          trigram similarity, so the honest thing to say is that narrowing the
          term beats paging through a tail that is already less relevant than
          what is on screen — the button is there for the reader who wants it
          anyway. Same control as Discover's Browse, so the two behave alike. */}
      {nextCursor ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="type-eyebrow text-center text-fg-faint">
            Ranked by relevance — keep typing to narrow
          </p>
          <Button onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}
