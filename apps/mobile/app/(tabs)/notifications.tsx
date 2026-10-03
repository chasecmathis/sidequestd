/**
 * Notifications — SPEC §6.12.
 *
 * One list, read and unread together, with the unread ones marked rather than
 * separated. SPEC §6.12 asks for read *state*, not two tabs, and a history you
 * can scroll back through is worth more than an inbox that empties itself.
 *
 * **Opening the tab does not mark anything read**, which is the web page's one
 * strongly-held position and it holds here: you glance at a badge, the list
 * clears, and whatever you meant to come back to is gone. Marking is something
 * the reader does — by opening a row, by pressing its check, or by "Mark all
 * read" — and the badge only ever moves when they moved it.
 *
 * Three things are this screen's rather than the web's, all of them forced by
 * having a bottom bar instead of a nav:
 *
 * - **Follow requests are a segment here, not a route.** Five tabs is the native
 *   ceiling; a conditional sixth would make the bar's layout depend on an
 *   account setting. `components/follow-requests.tsx` is the screen that was.
 * - **The inbox pages.** The web loads one screenful and stops, because it needs
 *   an observer or a button to do more; a `FlatList` already knows where its end
 *   is, so paging is `onEndReached` and the cursor the API has always returned.
 * - **It pulls to refresh.** A push may have arrived while this tab was open,
 *   and the badge poll only moves the number — the list underneath it is
 *   whatever was fetched when the screen mounted.
 */
import { BellOff } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import {
  NOTIFICATIONS_PAGE_SIZE,
  unreadIds,
  useAuth,
  useNotifications,
} from "@sidequestd/core";
import type { NotificationItem, NotificationPage } from "@sidequestd/api-types";

import { FollowRequests } from "@/components/follow-requests";
import { NotificationRow } from "@/components/notification-row";
import { Screen, screenContent, useContentBottom } from "@/components/screen";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EyebrowText } from "@/components/ui/text";
import { commitTap } from "@/lib/haptics";
import { SCREEN_GUTTER } from "@/lib/layout";
import { useRequireAuth } from "@/lib/require-auth";
import { useScrollToTop } from "@/lib/use-scroll-to-top";
import { useStyles, useTokens, type Tokens } from "@/theme";

/** How close to the end the next page loads, in screenfuls. As on Home. */
const END_THRESHOLD = 1;

type Pane = "all" | "requests";

const PANES: SegmentOption<Pane>[] = [
  { value: "all", label: "All" },
  { value: "requests", label: "Requests" },
];

function query(cursor?: string | null): string {
  const base = `/notifications?limit=${NOTIFICATIONS_PAGE_SIZE}`;
  return cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
}

export default function NotificationsScreen() {
  const styles = useStyles(make);
  const tokens = useTokens();

  const user = useRequireAuth();
  const { authedRequest } = useAuth();
  // A tab rather than a pushed route, so the bar below is still laid out under
  // it and is what accounts for the home indicator.
  const bottom = useContentBottom(false);
  // The badge's own state, shared with the tab bar. `markRead` moves it from the
  // same response that did the marking, so nothing here has to subtract.
  const { unreadCount, markRead } = useNotifications();

  const [pane, setPane] = useState<Pane>("all");
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false);

  // A ref rather than state, for the reason the feed's copy gives: `onEndReached`
  // closes over whatever was current when it was registered, so two triggers in
  // one frame would both fetch the same cursor.
  const fetching = useRef(false);

  const list = useRef<FlatList<NotificationItem>>(null);
  useScrollToTop(list);

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await authedRequest<NotificationPage>(query());
      setItems(page.items);
      setNextCursor(page.next_cursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your notifications.");
    }
  }, [authedRequest]);

  useEffect(() => {
    if (!user) return;
    void loadFirstPage();
    // Keyed on the id rather than the record: the session object is replaced
    // whenever anything about it changes, and refetching on each of those would
    // re-fetch a list somebody is part way through reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || fetching.current) return;

    fetching.current = true;
    try {
      const page = await authedRequest<NotificationPage>(query(nextCursor));
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      fetching.current = false;
    }
  }, [authedRequest, nextCursor]);

  const onRefresh = useCallback(async () => {
    // On the threshold, not on the response: the pull is a gesture that crosses
    // a line, and the tap is what tells the thumb it crossed it.
    commitTap();
    setRefreshing(true);
    await loadFirstPage();
    setRefreshing(false);
  }, [loadFirstPage]);

  const mark = useCallback(
    async (ids?: string[]) => {
      setPending(true);
      setError(null);
      try {
        await markRead(ids);
        // Marked in place rather than refetched: the rows have not changed, only
        // their state has, and re-reading the page would reorder nothing and
        // cost a request. `undefined` is "all", which is every row loaded.
        setItems((current) =>
          (current ?? []).map((item) =>
            ids === undefined || ids.includes(item.id) ? { ...item, is_read: true } : item,
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
      } finally {
        setPending(false);
      }
    },
    [markRead],
  );

  const onPage = unreadIds(items ?? []);

  const header = (
    <View style={styles.header}>
      <PageHeader
        eyebrow="Activity"
        title="Notifications"
        description={
          unreadCount > 0
            ? `${unreadCount} unread. Opening this tab doesn't clear them.`
            : "You're all caught up."
        }
        // Only when there is something on screen for it to act on, so the
        // control appears with a reason to exist rather than sitting there
        // disabled.
        action={
          pane === "all" && onPage.length > 0 ? (
            <Button size="sm" disabled={pending} onPress={() => void mark()}>
              Mark all read
            </Button>
          ) : null
        }
      />

      {/* Shown to a private account only. A public one accepts follows outright,
          so the pane would be empty by construction — and a segmented control
          with a permanently empty half is a control that teaches the reader to
          ignore it. */}
      {user?.is_private ? (
        <Segmented label="Notifications and requests" options={PANES} value={pane} onChange={setPane} />
      ) : null}

      {error ? <Alert>{error}</Alert> : null}
    </View>
  );

  // Everything that is not a list of notifications renders inside the ordinary
  // scrolling `Screen`: there is nothing to virtualise, and a `FlatList` whose
  // only content is its header is a list pretending to be a page.
  if (!user || pane === "requests" || items === null || items.length === 0) {
    return (
      <Screen>
        {header}
        {!user || items === null ? (
          <ListSkeleton label="Loading notifications" />
        ) : pane === "requests" ? (
          <FollowRequests viewer={user} />
        ) : (
          <EmptyState
            icon={BellOff}
            description="Nothing yet. Follows, likes and comments on your reviews show up here."
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <NotificationRow
            item={item}
            onMarkRead={(id) => void mark([id])}
            last={index === items.length - 1}
          />
        )}
        ListHeaderComponent={header}
        // No horizontal padding, unlike every other screen — the rows run edge
        // to edge, as the follow lists do. A rounded frame around the whole of a
        // 390pt screen is an inset for no reason, and the unread rule wants the
        // actual edge to sit on. The rows carry their own 16pt gutter, so the
        // sentences still line up with the header above them.
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        style={styles.flex}
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
          nextCursor ? (
            <EyebrowText tone="faint" style={styles.footer}>
              Loading more…
            </EyebrowText>
          ) : null
        }
        accessibilityLabel="Notifications"
      />
    </Screen>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { paddingTop: screenContent.paddingTop },

    // The gutter the rows do not have, so the title and the segments sit on the
    // same left edge as every other screen's content.
    header: { gap: 24, marginBottom: 24, paddingHorizontal: SCREEN_GUTTER },
    footer: { textAlign: "center", marginTop: 24 },
  });
