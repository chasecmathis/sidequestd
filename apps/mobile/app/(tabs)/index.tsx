/**
 * Home — the following feed (SPEC §6.4).
 *
 * The first screen the app opens on, and therefore the one that decides where a
 * signed-out launch lands: `useRequireAuth` sends it to /login, which is the
 * native equivalent of the web's marketing page at `/`. A phone with the app
 * installed does not need to be pitched the product.
 *
 * **`onEndReached` replaces the `IntersectionObserver`, and nothing else moves.**
 * The web watches a sentinel below the list with a 600px root margin; a
 * `FlatList` already knows where its end is, so `onEndReachedThreshold` says the
 * same thing in screenfuls. The cursor logic, the page size and the `fetching`
 * ref that stops two triggers in one frame from fetching the same cursor twice
 * are the web's, unchanged — and the ref is needed here for exactly the reason
 * it is needed there: the callback closes over whatever `loadingMore` was when
 * it was registered.
 *
 * There is no "Load more" button beside it. On the web that button is the path
 * for a keyboard, a screen reader, or a browser with no observer — three cases
 * that are one case here, because a `FlatList` fires `onEndReached` when the
 * *list* reaches its end however the reader got it there, including VoiceOver
 * walking to the last row. What replaces it is the line at the foot of the list
 * saying whether there is more, which the web also has.
 *
 * **The entrance is one fade, not a six-row stagger.** The plan called for
 * `FadeInDown.delay()` per row, which is the web's `STAGGER_COUNT` translated
 * literally. It does not survive the viewport: a review card with media is most
 * of a 390pt-wide screen, so rows three to six of that stagger animate below the
 * fold and nobody ever sees them. The list arrives as one movement instead,
 * which is the same gesture at the size it is actually read at — and it is RN's
 * own `Animated` rather than Reanimated, because one opacity and one translate
 * on the native driver is all a single container needs.
 */
import { Compass, PenLine, Rss } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, FlatList, RefreshControl, StyleSheet, View } from "react-native";

import {
  feedItemKey,
  feedQuery,
  isActivityItem,
  isRecommendedItem,
  isReviewItem,
  useAuth,
} from "@sidequestd/core";
import type { FeedItem, FeedPage, FeedSuggestions } from "@sidequestd/api-types";

import { ActivityRow } from "@/components/activity-row";
import { FollowButton } from "@/components/follow-button";
import { GameGrid } from "@/components/game-card";
import { RecommendedRow } from "@/components/recommended-row";
import { ReviewCard } from "@/components/review-card";
import { Screen, screenContent } from "@/components/screen";
import { UserList, UserRow } from "@/components/user-row";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { FeedSkeleton } from "@/components/ui/skeleton";
import { EyebrowText } from "@/components/ui/text";
import { commitTap } from "@/lib/haptics";
import { open } from "@/lib/navigate";
import { useRequireAuth } from "@/lib/require-auth";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useScrollToTop } from "@/lib/use-scroll-to-top";
import { useStyles, useTokens, type Tokens } from "@/theme";

/**
 * How close to the end the next page starts loading, in screenfuls.
 *
 * The web's `FEED_PREFETCH_MARGIN` is 600px, which against a feed row of roughly
 * a screen's height is about one screenful — so 1 here is the same distance
 * expressed in the unit `FlatList` measures in. It is not imported from `core`
 * for that reason: the value is the same decision in a different unit, and a
 * pixel margin handed to `onEndReachedThreshold` would mean 600 screens.
 */
const END_THRESHOLD = 1;

function FeedRow({ item }: { item: FeedItem }) {
  if (isReviewItem(item)) return <ReviewCard review={item.review} />;
  if (isActivityItem(item)) return <ActivityRow item={item} />;
  if (isRecommendedItem(item)) return <RecommendedRow item={item} />;
  // Not reachable from today's API. It stays so that a kind this build has never
  // heard of is a gap on the screen rather than a crash in the middle of
  // somebody's feed — which is also why the key comes off the envelope.
  return null;
}

/** Who to follow and what is hot, for a reader whose feed has nothing in it. */
function QuietFeed({ suggestions }: { suggestions: FeedSuggestions | null }) {
  const styles = useStyles(make);

  return (
    <View style={styles.quiet}>
      <EmptyState
        icon={Rss}
        title="Your feed is quiet"
        description="Home shows reviews from the people you follow. Follow a few accounts and they'll appear here."
        action={
          <Button icon={Compass} onPress={() => open("/discover")}>
            Browse games
          </Button>
        }
      />

      {suggestions && suggestions.accounts.length > 0 ? (
        <View style={styles.section}>
          <Eyebrow heading rule>
            Suggested accounts
          </Eyebrow>
          <UserList label="Suggested accounts">
            {suggestions.accounts.map((account, index) => (
              <UserRow
                key={account.id}
                user={account}
                // The whole point of this block: a feed is quiet because the
                // reader follows nobody, so the row that suggests somebody has
                // to be the row that fixes it. `NONE` is safe as a starting
                // state — these are suggestions precisely because they are
                // accounts the viewer does not follow.
                action={<FollowButton user={account} state="NONE" size="sm" />}
                last={index === suggestions.accounts.length - 1}
              />
            ))}
          </UserList>
        </View>
      ) : null}

      {suggestions && suggestions.trending.length > 0 ? (
        <View style={styles.section}>
          <Eyebrow heading rule>
            Trending games
          </Eyebrow>
          <GameGrid
            games={suggestions.trending.map((entry) => entry.game)}
            onOpen={(game) => open(`/games/${game.id}`)}
            label="Trending games"
          />
        </View>
      ) : null}
    </View>
  );
}

export default function HomeScreen() {
  const styles = useStyles(make);
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();

  const user = useRequireAuth();
  const { authedRequest } = useAuth();

  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FeedSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // A ref rather than a piece of state, because `onEndReached` closes over
  // whatever was current when it was registered: two triggers in the same frame
  // would both see the old value and fetch the same cursor twice.
  const fetching = useRef(false);

  const entrance = useRef(new Animated.Value(0)).current;

  // Home is the deepest scroll in the app, so it is the one that most needs the
  // way back out. `Screen` does this for the branches below that scroll it
  // themselves; the feed owns its own list and has to ask.
  const list = useRef<FlatList<FeedItem>>(null);
  useScrollToTop(list);

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await authedRequest<FeedPage>(feedQuery({}));
      setItems(page.items);
      setNextCursor(page.next_cursor);
      setError(null);

      // Only asked for when there is nothing to show. The common case is a feed
      // with content, and that reader never pays for this request.
      if (page.items.length === 0) {
        setSuggestions(await authedRequest<FeedSuggestions>("/feed/suggestions"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    }
  }, [authedRequest]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    void loadFirstPage().then(() => {
      if (cancelled) return;
      Animated.timing(entrance, {
        toValue: 1,
        duration: reducedMotion ? 0 : tokens.motion.duration.base,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      cancelled = true;
    };
    // `reducedMotion` and the tokens are deliberately not dependencies: they
    // only pick the duration of an animation that has already run, and listing
    // them would refetch the whole feed when somebody flips the theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadFirstPage, entrance]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || fetching.current) return;

    fetching.current = true;
    try {
      const page = await authedRequest<FeedPage>(feedQuery({ cursor: nextCursor }));
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      fetching.current = false;
    }
  }, [authedRequest, nextCursor]);

  const onRefresh = useCallback(async () => {
    // On the commit, not on the result: the pull is a gesture that crosses a
    // threshold, and the tap is what tells the thumb it crossed it. Waiting for
    // the response would put the feedback a second after the finger left.
    commitTap();
    setRefreshing(true);
    await loadFirstPage();
    setRefreshing(false);
  }, [loadFirstPage]);

  const header = (
    <>
      <PageHeader
        eyebrow="Your feed"
        title="Home"
        description="Reviews and lists from the people you follow, newest first."
      />
      {error ? <Alert>{error}</Alert> : null}
    </>
  );

  /**
   * The same header, spaced for a list rather than for `Screen`.
   *
   * `Screen`'s scrolling branch puts a 24pt gap between its children; a
   * `FlatList` header is one node inside the scroll and gets none, so it carries
   * the gap itself. Two spellings of one measurement, and the alternative is a
   * feed whose title sits flush against the first card.
   */
  const listHeader = <View style={styles.listHeader}>{header}</View>;

  // Nothing to show and nothing to say yet: this is the frame between the
  // session settling and the redirect landing, and a skeleton is the honest
  // thing to put in it — the alternative is a bare canvas with a tab bar.
  if (!user || items === null) {
    return (
      <Screen action={<ComposeLink />}>
        {header}
        <FeedSkeleton />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen action={<ComposeLink />}>
        {header}
        <QuietFeed suggestions={suggestions} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} action={<ComposeLink />}>
      <Animated.View style={[styles.flex, { opacity: entrance }]}>
        <FlatList
          ref={list}
          data={items}
          keyExtractor={feedItemKey}
          renderItem={({ item }) => <FeedRow item={item} />}
          ListHeaderComponent={listHeader}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={screenContent}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={END_THRESHOLD}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={tokens.color.fgFaint}
            />
          }
          ListFooterComponent={
            <EyebrowText tone="faint" style={styles.footer}>
              {nextCursor ? "Loading more…" : "You're all caught up."}
            </EyebrowText>
          }
        />
      </Animated.View>
    </Screen>
  );
}

/**
 * The screen's one primary control, in the app bar's action slot.
 *
 * A header button exactly as on the web, rather than a centre floating action
 * button: five tabs is the native ceiling, and the design system already says at
 * most one primary per view. It is the only accent-filled control on Home, which
 * is the point — the feed is somebody else's writing, and this is the one thing
 * the reader can add to it.
 *
 * The specimen screen used to sit here while there was nothing else to put in
 * the slot. It moved to Settings, which is where a development-only surface
 * belongs once a real control wants the corner.
 */
function ComposeLink() {
  return (
    <Button
      variant="primary"
      size="sm"
      icon={PenLine}
      onPress={() => open("/reviews/new")}
      accessibilityLabel="Write a review"
    >
      Review
    </Button>
  );
}

function Separator() {
  const styles = useStyles(make);
  return <View style={styles.separator} />;
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    flex: { flex: 1 },
    listHeader: { gap: 24, marginBottom: 24 },
    separator: { height: 24 },
    footer: { textAlign: "center", marginTop: 32 },

    quiet: { gap: 40 },
    section: { gap: 16 },
  });
