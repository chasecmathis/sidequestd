/**
 * The two sides of the follow graph — SPEC §6.7.
 *
 * One component behind two routes. `/profile/x/followers` and
 * `/profile/x/following` differ by which endpoint they call and what the empty
 * state says; everything else — the header, the switch, the paging, the privacy
 * gate — is the same screen twice, and writing it twice is how the two drift.
 *
 * Two requests, in order, for the same reason the profile makes two: the list
 * endpoints take a user *id* while the route carries a handle, so the profile
 * has to answer first. That first response also carries `can_view_content`,
 * which decides whether asking for the list at all would just be a 403.
 *
 * Rows carry an action on your own lists only — Unfollow on Following, Remove on
 * Followers — because those are the two places where membership in *this
 * particular list* already proves the relationship, and nothing has to be
 * fetched to know what the button should say. Everyone else's rows are just a
 * way into a profile, where the real state is known.
 *
 * Built on a `FlatList` rather than the `ScrollView` most of these screens use.
 * A follow list is the one read surface with no upper bound on its length — a
 * popular account's followers run to thousands of rows with an avatar each — and
 * it is also the simplest to virtualise, being a flat list of one row type.
 */
import { Lock, Users } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View, FlatList } from "react-native";

import {
  ApiError,
  emptyFollowMessage,
  followListLabel,
  followListPath,
  followListQuery,
  formatCount,
  profilePath,
  useAuth,
  type FollowDirection,
} from "@sidequestd/core";
import type { UserPage, UserProfile, UserPublic } from "@sidequestd/api-types";

import { SCREEN_GUTTER } from "@/lib/layout";
import { open, openReplacing } from "@/lib/navigate";
import { useStyles, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { FollowButton, RemoveFollowerButton } from "./follow-button";
import { Screen, screenContent, useContentBottom } from "./screen";
import { UserRow } from "./user-row";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { ListSkeleton } from "./ui/skeleton";
import { EyebrowText, Text } from "./ui/text";

const DIRECTIONS: FollowDirection[] = ["followers", "following"];

/**
 * Followers | Following.
 *
 * They are two routes, so pressing one navigates rather than swapping a panel —
 * which is why these are not `Segmented`, whose `tab` role would promise a
 * screen reader that the content changes in place. `replace` rather than `push`:
 * flipping between the two sides five times should not build five screens for
 * the back gesture to walk out through.
 *
 * The lit segment of the rule is the one place the accent marks position rather
 * than filling something, and it is the same gesture the tab bar's indicator
 * makes at the other end of the screen.
 */
function DirectionSwitch({ profile, active }: { profile: UserProfile; active: FollowDirection }) {
  const styles = useStyles(make);

  return (
    <View style={styles.switch} accessibilityLabel="Follow lists">
      {DIRECTIONS.map((direction) => {
        const current = direction === active;
        const count = direction === "followers" ? profile.follower_count : profile.following_count;

        return (
          <Pressable
            key={direction}
            accessibilityRole="button"
            accessibilityState={{ selected: current }}
            onPress={() => openReplacing(followListPath(profile.username, direction))}
            style={styles.side}
          >
            <EyebrowText tone={current ? "fg" : "faint"}>{followListLabel(direction)}</EyebrowText>
            <Text size={14} tone={current ? "fg" : "faint"} style={styles.tabular}>
              {formatCount(count)}
            </Text>
            {/* Sits *on* the container's rule rather than beside it, so the two
                read as one line with a lit segment. */}
            {current ? <View style={styles.lit} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function FollowListScreen({
  username,
  direction,
}: {
  username: string;
  direction: FollowDirection;
}) {
  const styles = useStyles(make);
  const { authedRequest, isLoading } = useAuth();
  // A pushed route: it covers the tab bar, which is what was accounting for the
  // home indicator. Thousands of rows end under it otherwise.
  const bottom = useContentBottom(true);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [people, setPeople] = useState<UserPublic[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Same wait as the profile: this endpoint answers signed-out callers with 200,
  // so asking before /auth/refresh lands returns the anonymous view.
  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;
    setProfile(null);
    setError(null);
    authedRequest<UserProfile>(`/users/${username}`)
      .then((body) => {
        if (!cancelled) setProfile(body);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "There's nobody here by that name."
            : cause instanceof Error
              ? cause.message
              : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, username, isLoading]);

  const ownerId = profile?.can_view_content ? profile.id : null;
  useEffect(() => {
    if (ownerId === null) {
      setPeople(null);
      setNextCursor(null);
      return;
    }

    let cancelled = false;
    setPeople(null);
    setListError(null);
    authedRequest<UserPage>(followListQuery(ownerId, direction))
      .then((page) => {
        if (cancelled) return;
        setPeople(page.items);
        setNextCursor(page.next_cursor);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setPeople([]);
        setListError(cause instanceof Error ? cause.message : "Request failed.");
      });

    return () => {
      cancelled = true;
    };
  }, [authedRequest, ownerId, direction]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || ownerId === null || loadingMore) return;

    setLoadingMore(true);
    try {
      const page = await authedRequest<UserPage>(followListQuery(ownerId, direction, nextCursor));
      setPeople((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setLoadingMore(false);
    }
  }, [authedRequest, ownerId, direction, nextCursor, loadingMore]);

  if (error) {
    return (
      <Screen back>
        <Alert>{error}</Alert>
        <Button onPress={() => open("/search")} style={styles.away}>
          Find someone else
        </Button>
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen back>
        <ListSkeleton label={`Loading ${followListLabel(direction).toLowerCase()}`} />
      </Screen>
    );
  }

  /**
   * The control this row may offer, if any.
   *
   * Unfollow leaves the row in place: it is undoable, the button turns straight
   * back into Follow, and a row that vanishes on a mis-tap sends the reader to
   * search to find that person again. Remove-follower takes the row out,
   * because it is *not* undoable from here — the edge is gone and only that
   * person can recreate it, so leaving them listed would be a lie.
   */
  function rowAction(person: UserPublic) {
    if (!profile?.is_viewer) return undefined;

    if (direction === "following") {
      return <FollowButton user={person} state="FOLLOWING" size="sm" />;
    }
    return (
      <RemoveFollowerButton
        user={person}
        onRemoved={() =>
          setPeople((current) => (current ?? []).filter((entry) => entry.id !== person.id))
        }
      />
    );
  }

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to @${profile.username}'s profile`}
        onPress={() => open(profilePath(profile.username))}
        style={styles.owner}
      >
        <Avatar user={profile} size={44} />
        <View>
          <EyebrowText tone="faint">Back to profile</EyebrowText>
          <Text size={17} style={styles.ownerHandle}>
            @{profile.username}
          </Text>
        </View>
      </Pressable>

      <DirectionSwitch profile={profile} active={direction} />

      {listError ? <Alert>{listError}</Alert> : null}
    </View>
  );

  // Everything that is not a list of people renders inside the ordinary
  // scrolling `Screen`: there is nothing to virtualise, and a `FlatList` whose
  // only content is its header is a list pretending to be a page.
  if (!profile.can_view_content || people === null || people.length === 0) {
    return (
      <Screen back>
        {header}
        {!profile.can_view_content ? (
          <EmptyState
            icon={Lock}
            title="This account is private"
            description={
              profile.viewer_follow_state === "REQUESTED"
                ? `@${profile.username} has your follow request. You'll see this list once they approve it.`
                : `Follow @${profile.username} to see this list.`
            }
          />
        ) : people === null ? (
          <ListSkeleton label={`Loading ${followListLabel(direction).toLowerCase()}`} />
        ) : (
          <EmptyState
            icon={Users}
            description={emptyFollowMessage(direction, profile.is_viewer, profile.username)}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen back scroll={false}>
      <FlatList
        data={people}
        keyExtractor={(person) => person.id}
        renderItem={({ item, index }) => (
          <UserRow user={item} action={rowAction(item)} last={index === people.length - 1} />
        )}
        ListHeaderComponent={header}
        // No horizontal padding, unlike every other screen: the rows run edge to
        // edge. `UserList`'s rounded frame is right on the web, where the list
        // sits in a 1024px page and needs an edge to be a list *of* something;
        // at 390px it is the whole screen, and a card around the whole screen is
        // an inset for no reason. The rows carry their own 16pt gutter, so the
        // handles still line up with the header above them.
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        style={styles.flex}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={1}
        ListFooterComponent={
          nextCursor ? (
            <EyebrowText tone="faint" style={styles.footer}>
              Loading more…
            </EyebrowText>
          ) : null
        }
        accessibilityLabel={`${followListLabel(direction)} of @${profile.username}`}
      />
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { paddingTop: screenContent.paddingTop },

    // The gutter the rows do not have, so the owner and the switch still sit on
    // the same left edge as every other screen's content.
    header: { gap: 20, marginBottom: 20, paddingHorizontal: SCREEN_GUTTER },
    owner: { flexDirection: "row", alignItems: "center", gap: 14 },
    ownerHandle: { marginTop: 4 },

    switch: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.color.line },
    side: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 14 },
    lit: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: -1,
      height: 1,
      backgroundColor: t.color.accent,
    },

    tabular: { fontVariant: ["tabular-nums"] },
    footer: { textAlign: "center", marginTop: 24 },
    away: { alignSelf: "flex-start" },
  });
