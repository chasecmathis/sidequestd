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
 * headings competing with four grids of cover art is a screen with no focus; the
 * artwork is the content, so the labels get out of its way. That holds harder at
 * 390px, where a serif heading is a third of the height of the grid under it.
 *
 * A signed-out surface, like the web's — no `useRequireAuth` here. Browsing the
 * catalog is the thing somebody does before they have an account, and
 * `authedRequest` sends the session when there is one and nothing when there is
 * not, which is all the difference the recommended section needs.
 */
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  browseQuery,
  orderFacetOptions,
  toggleFacet,
  useAuth,
  visibleFacetOptions,
} from "@sidequestd/core";
import type {
  DiscoverResponse,
  GamePage,
  GameSort,
  GameSummary,
  GenreRef,
  PlatformRef,
} from "@sidequestd/api-types";

import { GameGrid } from "@/components/game-card";
import { Screen } from "@/components/screen";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chip, TextButton } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { GameGridSkeleton } from "@/components/ui/skeleton";
import { EyebrowText, Text } from "@/components/ui/text";
import { open } from "@/lib/navigate";
import { text, useStyles, type Tokens } from "@/theme";

/**
 * Chips shown before "Show all".
 *
 * Six rather than the web's eight: a chip is wider relative to a 390pt row than
 * to a desktop column, and eight is three rows of them above the results. The
 * *number* is a layout decision either way — what makes collapsing safe is
 * `orderFacetOptions` pinning the selected ones to the front, which is shared.
 */
const COLLAPSED_FACET_COUNT = 6;

/** One page of browse results. Matches the web's, so the two page alike. */
const BROWSE_PAGE_SIZE = 10;

const SORTS: SegmentOption<GameSort>[] = [
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
  subtitle: string;
  games: GameSummary[];
  emptyNote: string;
  loading: boolean;
}) {
  const styles = useStyles(make);

  return (
    <View style={styles.section}>
      <Eyebrow heading rule>
        {title}
      </Eyebrow>
      <Text size={14} tone="dim" relaxed>
        {subtitle}
      </Text>

      {loading ? (
        <GameGridSkeleton label={`Loading ${title.toLowerCase()}`} />
      ) : games.length > 0 ? (
        <GameGrid games={games} onOpen={(game) => open(`/games/${game.id}`)} label={title} />
      ) : (
        <EmptyState description={emptyNote} />
      )}
    </View>
  );
}

/**
 * One facet, collapsed to a fixed height.
 *
 * `/games/discover` returns the whole catalog's genres and platforms with no
 * cap, which on a real import is a couple of hundred chips — enough to push the
 * results themselves off the screen entirely. So the group shows a couple of
 * rows and a count.
 *
 * Two things make collapsing safe. The API orders facets by how much of the
 * catalog each covers, so the visible ones are the ones worth filtering by
 * rather than whatever sorts first by name; and `orderFacetOptions` pins
 * whatever is selected to the front, so the chips explaining the current results
 * are always among them.
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
  const styles = useStyles(make);
  const [expanded, setExpanded] = useState(false);

  const ordered = orderFacetOptions(options, selected);
  const visible = visibleFacetOptions(ordered, selected, expanded, COLLAPSED_FACET_COUNT);
  const hidden = ordered.length - visible.length;

  return (
    <View style={styles.facet} accessibilityLabel={legend}>
      <EyebrowText tone="faint">{legend}</EyebrowText>

      <View style={styles.chips}>
        {visible.map((option) => (
          <Chip
            key={option.id}
            label={option.name}
            selected={selected.includes(option.slug)}
            onPress={() => onToggle(option.slug)}
          />
        ))}

        {hidden > 0 || expanded ? (
          <TextButton onPress={() => setExpanded((value) => !value)}>
            {expanded ? "Show fewer" : `Show all ${options.length}`}
          </TextButton>
        ) : null}

        {/* Only once something is selected: at two hundred platforms,
            un-toggling one chip at a time is not a real affordance. */}
        {selected.length > 0 ? (
          <TextButton onPress={onClear}>{`Clear ${legend.toLowerCase()}`}</TextButton>
        ) : null}
      </View>
    </View>
  );
}

export default function DiscoverScreen() {
  const styles = useStyles(make);
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
    authedRequest<GamePage>(browseQuery({ genres, platforms, sort, limit: BROWSE_PAGE_SIZE }))
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
        browseQuery({ genres, platforms, sort, cursor: nextCursor, limit: BROWSE_PAGE_SIZE }),
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
    <Screen>
      <PageHeader
        eyebrow="The catalog"
        title="Discover"
        description="What's hot, what's new, and everything in the catalog."
      />

      {error ? <Alert>{error}</Alert> : null}

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
        emptyNote="Nothing released in the catalog yet."
      />

      <View style={styles.browse}>
        <Text variant="display" size={text.size.section} accessibilityRole="header">
          Browse
        </Text>

        {/* Under the heading rather than beside it: three sort options and a
            serif heading do not share a 390pt row without the heading shrinking,
            and the heading is the thing that says a new section has started. */}
        <Segmented label="Sort" options={SORTS} value={sort} onChange={setSort} />

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

        {results.length > 0 ? (
          <GameGrid
            games={results}
            onOpen={(game) => open(`/games/${game.id}`)}
            label="Browse results"
          />
        ) : (
          <EmptyState description="No games match those filters." />
        )}

        {nextCursor ? (
          <Button disabled={loadingMore} onPress={() => void loadMore()} style={styles.more}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </View>
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 16, marginTop: 16 },

    browse: {
      gap: 20,
      marginTop: 32,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      paddingTop: 28,
    },

    facet: { gap: 12 },
    chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },

    more: { alignSelf: "center" },
  });
