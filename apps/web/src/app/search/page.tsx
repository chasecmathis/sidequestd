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
import { useState } from "react";

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
import { noSearchMatches, profilePath, SEARCH_PROMPTS, useSearch } from "@sidequestd/core";

import type { UserSearchResult } from "@sidequestd/api-types";

type Tab = "games" | "users";

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
  const [tab, setTab] = useState<Tab>("games");
  const [term, setTerm] = useState("");
  // One search per tab with only the open one enabled, so each keeps its exact
  // result type, and switching tabs fetches page one of the other kind.
  const games = useSearch("games", term, { enabled: tab === "games" });
  const users = useSearch("users", term, { enabled: tab === "users" });
  const active = tab === "games" ? games : users;

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

      {active.error ? (
        <Alert tone="error" className="mt-6">
          {active.error}
        </Alert>
      ) : null}

      <div className="mt-8">
        {!hasQuery ? (
          <EmptyState icon={SearchIcon} description={SEARCH_PROMPTS[tab]} />
        ) : active.items.length === 0 ? (
          active.searching ? (
            tab === "games" ? (
              <GameGridSkeleton label="Searching games" />
            ) : (
              <ListSkeleton label="Searching people" />
            )
          ) : active.error ? null : (
            <EmptyState description={noSearchMatches(tab, term)} />
          )
        ) : tab === "games" ? (
          // SPEC §6.9 names Search as one of the three places a game joins a
          // list, which is the whole point of finding it here.
          <GameGrid games={games.items} action={(game) => <BacklogControl game={game} />} />
        ) : (
          <ul className="space-y-2">
            {users.items.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </ul>
        )}
      </div>

      {/* Only when there is genuinely another page. Results come back ranked by
          relevance, so the honest thing to say is that narrowing the
          term beats paging through a tail that is already less relevant than
          what is on screen — the button is there for the reader who wants it
          anyway. Same control as Discover's Browse, so the two behave alike. */}
      {active.hasMore ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="type-eyebrow text-center text-fg-faint">
            Ranked by relevance — keep typing to narrow
          </p>
          <Button onClick={() => void active.loadMore()} disabled={active.loadingMore}>
            {active.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}
