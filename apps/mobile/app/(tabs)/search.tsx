/**
 * Search — SPEC §6.6. Games by title, people by handle or display name.
 *
 * The user tab renders private accounts as shells: the API withholds their stats
 * unless the viewer is approved (SPEC §6.7), and the row says so rather than
 * showing a zero that would read as "no reviews".
 *
 * Debounced by `useSearch`, as on the web — one request per pause rather than one
 * per keystroke, because search is rate limited server-side (SPEC §9). That matters
 * more from a phone than from a desktop: a thumb typing "elden ring" on a
 * flaky connection is ten requests the reader is paying for.
 *
 * A signed-out surface, like Discover. Finding a game to review is the thing
 * somebody does before they have an account.
 */
import { Search as SearchIcon } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { noSearchMatches, SEARCH_PROMPTS, useSearch } from "@sidequestd/core";
import type { UserSearchResult } from "@sidequestd/api-types";

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
  const [tab, setTab] = useState<Tab>("games");
  const [term, setTerm] = useState("");
  // One search per tab with only the open one enabled, so each keeps its exact
  // result type, and switching tabs fetches page one of the other kind.
  const games = useSearch("games", term, { enabled: tab === "games" });
  const users = useSearch("users", term, { enabled: tab === "users" });
  const active = tab === "games" ? games : users;

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

      {active.error ? <Alert>{active.error}</Alert> : null}

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
        <GameGrid
          games={games.items}
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
          {users.items.map((user, index) => (
            <UserRow
              key={user.id}
              user={user}
              meta={resultMeta(user)}
              last={index === users.items.length - 1}
            />
          ))}
        </UserList>
      )}

      {/* Only when there is genuinely another page. Results come back ranked by
          relevance, so the honest thing to say is that narrowing the
          term beats paging through a tail that is already less relevant than
          what is on screen — the button is there for the reader who wants it
          anyway. Same control as Discover's Browse, so the two behave alike. */}
      {active.hasMore ? (
        <View style={styles.more}>
          <EyebrowText tone="faint" style={styles.hint}>
            Ranked by relevance — keep typing to narrow
          </EyebrowText>
          <Button disabled={active.loadingMore} onPress={() => void active.loadMore()}>
            {active.loadingMore ? "Loading…" : "Load more"}
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
