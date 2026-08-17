"use client";

/**
 * Discover — SPEC §6.5.
 *
 * Two halves: the curated sections (`GET /games/discover`, one round trip) and a
 * faceted browse below them (`GET /games`, refetched as the chips change).
 *
 * "Recommended for you" is the one section that is personal to the reader, and
 * it is a plain grid of the same cards as the rest on purpose — the ranking is
 * the server's, and a score printed on a card is a number nobody can act on.
 *
 * Sections are headed by a ruled eyebrow rather than a big title. Four stacked
 * headings competing with four grids of cover art is a page with no focus; the
 * artwork is the content, so the labels get out of its way.
 */
import { useCallback, useEffect, useState } from "react";

import { X } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { GameGrid } from "@/components/game-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GameGridSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/lib/auth";
import { browseQuery, orderFacetOptions, toggleFacet, visibleFacetOptions } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import type {
  DiscoverResponse,
  GamePage,
  GameSort,
  GameSummary,
  GenreRef,
  PlatformRef,
} from "@sidequestd/api-types";

/** Chips shown before "Show all" — roughly two rows on desktop, and a collapsed
    height that does not move whether the catalog has twelve genres or two hundred. */
const COLLAPSED_FACET_COUNT = 8;

const SORTS: { value: GameSort; label: string }[] = [
  { value: "title", label: "A–Z" },
  { value: "release_date", label: "Newest" },
  { value: "trending", label: "Trending" },
];

function Section({
  title,
  subtitle,
  games,
  emptyNote,
  loading,
}: {
  title: string;
  subtitle?: string;
  games: GameSummary[];
  emptyNote: string;
  loading: boolean;
}) {
  return (
    <section className="mt-14">
      {/* The heading keeps its `h2` role and its exact text: the tests find each
          section by name, and so does anyone navigating by headings. */}
      <h2 className="type-eyebrow flex items-center gap-3 text-fg-faint">
        <span>{title}</span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </h2>
      {subtitle ? <p className="mt-2.5 text-sm text-fg-dim">{subtitle}</p> : null}
      <div className="mt-5">
        {loading ? (
          <GameGridSkeleton label={`Loading ${title.toLowerCase()}`} />
        ) : games.length > 0 ? (
          <GameGrid games={games} />
        ) : (
          <EmptyState description={emptyNote} />
        )}
      </div>
    </section>
  );
}

/**
 * One facet, collapsed to a fixed height.
 *
 * `/games/discover` returns the whole catalog's genres and platforms with no
 * cap, which on a real import is a couple of hundred chips — enough to push the
 * results themselves off the screen. So the group shows a couple of rows and a
 * count.
 *
 * Two things make collapsing safe. The API orders facets by how much of the
 * catalog each covers, so the visible ones are the ones worth filtering by
 * rather than whatever sorts first by name; and `orderFacetOptions` pins
 * whatever is selected to the front, so the chips explaining the current
 * results are always among them.
 */
function FacetChips({
  legend,
  options,
  selected,
  onToggle,
  onClear,
}: {
  legend: string;
  options: (GenreRef | PlatformRef)[];
  selected: string[];
  onToggle: (slug: string) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const ordered = orderFacetOptions(options, selected);
  const visible = visibleFacetOptions(ordered, selected, expanded, COLLAPSED_FACET_COUNT);
  const hidden = ordered.length - visible.length;

  return (
    <fieldset className="mt-5">
      {/* A direct child of the fieldset, and left as one: nesting it in a flex
          row for layout would stop it naming the group. The two meta-actions go
          at the end of the chip flow instead. */}
      <legend className="type-eyebrow text-fg-faint">{legend}</legend>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {visible.map((option) => {
          const active = selected.includes(option.slug);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(option.slug)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors duration-150",
                active
                  ? "border-accent bg-accent-wash text-fg"
                  : "border-line text-fg-dim hover:border-line-strong hover:text-fg",
              )}
            >
              {option.name}
              {/* Only on the selected ones. With the list collapsed there is no
                  neighbouring unselected chip to compare against, so "press it
                  again to remove it" has to be visible rather than inferred. */}
              {active ? <X aria-hidden strokeWidth={2} className="size-3" /> : null}
            </button>
          );
        })}

        {hidden > 0 || expanded ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="type-eyebrow px-1 text-fg-faint transition-colors duration-150 hover:text-fg"
          >
            {expanded ? "Show fewer" : `Show all ${options.length}`}
          </button>
        ) : null}

        {selected.length > 0 ? (
          // Only once something is selected: at two hundred platforms,
          // un-toggling one chip at a time is not a real affordance.
          <button
            type="button"
            onClick={onClear}
            className="type-eyebrow px-1 text-fg-faint transition-colors duration-150 hover:text-fg"
          >
            Clear {legend.toLowerCase()}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

export default function DiscoverPage() {
  const { authedRequest, user } = useAuth();

  const [discover, setDiscover] = useState<DiscoverResponse | null>(null);
  const [results, setResults] = useState<GameSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [sort, setSort] = useState<GameSort>("title");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authedRequest<DiscoverResponse>("/games/discover")
      .then((body) => {
        if (!cancelled) setDiscover(body);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Request failed.");
      });
    return () => {
      cancelled = true;
    };
    // Refetched when the session resolves: "Recommended for you" depends on who
    // is asking, and the first paint happens before that is known. Everything
    // else in the response is the same for everybody.
  }, [authedRequest, user?.id]);

  // Refetch page one whenever a facet or the sort changes.
  useEffect(() => {
    let cancelled = false;
    authedRequest<GamePage>(browseQuery({ genres, platforms, sort, limit: 10 }))
      .then((page) => {
        if (cancelled) return;
        setResults(page.items);
        setNextCursor(page.next_cursor);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Request failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, genres, platforms, sort]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await authedRequest<GamePage>(
        browseQuery({ genres, platforms, sort, cursor: nextCursor, limit: 10 }),
      );
      setResults((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setLoadingMore(false);
    }
  }, [authedRequest, genres, platforms, sort, nextCursor]);

  const loading = discover === null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="The catalog"
        title="Discover"
        description="What's hot, what's new, and everything in the catalog."
      />

      {error ? (
        <Alert tone="error" className="mt-6">
          {error}
        </Alert>
      ) : null}

      <Section
        title="Trending"
        subtitle="Most activity in the last 7 days."
        games={(discover?.trending ?? []).map((entry) => entry.game)}
        loading={loading}
        emptyNote="Nothing trending yet. Trending is built from reviews, backlog adds and likes, and refreshes once a day — log a game and it starts filling in."
      />

      <Section
        title="Recommended for you"
        subtitle={
          user
            ? "From the genres you rate highly and the people who rate like you."
            : "Sign in to see picks based on what you've rated. Until then, what's popular."
        }
        games={discover?.recommended ?? []}
        loading={loading}
        emptyNote="Nothing to recommend yet — rate a few games, or wait for the catalog to see some activity."
      />

      <Section
        title="New releases"
        subtitle="Recently out. Announced games show up once they've shipped."
        games={discover?.new_releases ?? []}
        loading={loading}
        emptyNote="Nothing released in the catalog yet. Load the seed data with `npm run api:seed`."
      />

      <section className="mt-16 border-t border-line pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="type-display text-3xl text-fg">Browse</h2>
          <div className="flex gap-1" role="group" aria-label="Sort">
            {SORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={sort === option.value}
                onClick={() => setSort(option.value)}
                className={cn(
                  "type-eyebrow rounded-md px-3 py-2 transition-colors duration-150",
                  sort === option.value
                    ? "bg-surface-2 text-fg"
                    : "text-fg-faint hover:text-fg-dim",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <FacetChips
          legend="Genre"
          options={discover?.genres ?? []}
          selected={genres}
          onToggle={(slug) => setGenres((current) => toggleFacet(current, slug))}
          onClear={() => setGenres([])}
        />
        <FacetChips
          legend="Platform"
          options={discover?.platforms ?? []}
          selected={platforms}
          onToggle={(slug) => setPlatforms((current) => toggleFacet(current, slug))}
          onClear={() => setPlatforms([])}
        />

        <div className="mt-8">
          {results.length > 0 ? (
            <GameGrid games={results} />
          ) : (
            <EmptyState description="No games match those filters." />
          )}
        </div>

        {nextCursor ? (
          <Button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mx-auto mt-8 flex"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </section>
    </AppShell>
  );
}
