/**
 * Search — SPEC §6.6. Games by title, people by handle or display name.
 *
 * The user tab renders private accounts as shells: the API withholds their stats
 * unless the viewer is approved (SPEC §6.7), and the row says so rather than
 * showing a zero that would read as "no reviews".
 *
 * Debounced at 250ms, as on the web — one request per pause rather than one per
 * keystroke, because search is rate limited server-side (SPEC §9). That matters
 * more from a phone than from a desktop: a thumb typing "elden ring" on a
 * flaky connection is ten requests the reader is paying for.
 *
 * A signed-out surface, like Discover. Finding a game to review is the thing
 * somebody does before they have an account.
 */
import { Search as SearchIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { searchQuery, useAuth } from "@sidequestd/core";
import type {
  GamePage,
  GameSummary,
  UserSearchPage,
  UserSearchResult,
} from "@sidequestd/api-types";

import { BacklogControl } from "@/components/backlog-control";
import { GameGrid } from "@/components/game-card";
import { Screen } from "@/components/screen";
import { UserList, UserRow } from "@/components/user-row";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { GameGridSkeleton, ListSkeleton } from "@/components/ui/skeleton";
import { EyebrowText } from "@/components/ui/text";
import { open } from "@/lib/navigate";
import { useStyles, type Tokens } from "@/theme";

type Tab = "games" | "users";

const DEBOUNCE_MS = 250;

const TABS: SegmentOption<Tab>[] = [
  { value: "games", label: "Games" },
  { value: "users", label: "People" },
];

/**
 * What a person's row says on the right.
 *
 * Null is *gated*, not zero — saying "0 reviews" about an account the API
 * declined to describe would be a lie, and the one it most invites is that
 * somebody who writes a lot has written nothing.
 */
function resultMeta(user: UserSearchResult) {
  if (user.review_count === null || user.review_count === undefined) {
    return <Badge tone="outline">{user.is_private ? "Private" : "Hidden"}</Badge>;
  }

  return (
    <EyebrowText tone="faint">
      {user.review_count} review{user.review_count === 1 ? "" : "s"}
    </EyebrowText>
  );
}

export default function SearchScreen() {
  const styles = useStyles(make);
  const { authedRequest } = useAuth();

  const [tab, setTab] = useState<Tab>("games");
  const [term, setTerm] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [users, setUsers] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One cursor rather than one per tab: the effect below already re-runs when
  // `tab` changes, so switching tabs refetches page one and resets it with them.
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
   * comparing a value to itself. The ref is what the screen is showing *now*,
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
  }, [authedRequest, nextCursor, tab, term]);

  const results = tab === "games" ? games : users;
  const hasQuery = term.trim().length > 0;

  return (
    <Screen>
      <PageHeader
        eyebrow="Games and people"
        title="Search"
        description="Find a game to review or add to a list, or find someone to follow."
      />

      <SearchInput
        label={`Search ${tab}`}
        value={term}
        onChangeText={setTerm}
        placeholder={tab === "games" ? "Elden Ring" : "ripley"}
      />

      <Segmented label="Search type" options={TABS} value={tab} onChange={setTab} />

      {error ? <Alert>{error}</Alert> : null}

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
        <GameGrid
          games={games}
          onOpen={(game) => open(`/games/${game.id}`)}
          // SPEC §6.9's first entry point: search is where somebody arrives
          // knowing what they want, and the list they want it on is the thing
          // they came to do. Renders nothing at all when signed out, which is
          // what keeps this a browsing surface for a reader without an account.
          action={(game) => <BacklogControl game={game} size="sm" />}
          label="Game results"
        />
      ) : (
        <UserList label="People results">
          {users.map((user, index) => (
            <UserRow
              key={user.id}
              user={user}
              meta={resultMeta(user)}
              last={index === users.length - 1}
            />
          ))}
        </UserList>
      )}

      {/* Only when there is genuinely another page. Results come back ranked by
          trigram similarity, so the honest thing to say is that narrowing the
          term beats paging through a tail that is already less relevant than
          what is on screen — the button is there for the reader who wants it
          anyway. Same control as Discover's Browse, so the two behave alike. */}
      {nextCursor ? (
        <View style={styles.more}>
          <EyebrowText tone="faint" style={styles.hint}>
            Ranked by relevance — keep typing to narrow
          </EyebrowText>
          <Button disabled={loadingMore} onPress={() => void loadMore()}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </View>
      ) : null}
    </Screen>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    more: { alignItems: "center", gap: 12 },
    hint: { textAlign: "center" },
  });
