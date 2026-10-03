/**
 * Profile — SPEC §6.2, with the stats from §6.8.
 *
 * One component behind two routes, the way `FollowListScreen` is. The Profile
 * tab is the viewer's own and `/profile/[username]` is anybody's; they differ by
 * whose handle they are given and by whether there is a stack to go back to.
 * Writing the screen twice is how the two drift apart.
 *
 * `GET /users/{username}` carries the shell, the follower counts, the favorites,
 * the stats and the viewer's own standing with the account, already gated by the
 * API. The reviews grid, the backlog lists and the platform showcases are
 * separate requests, made only once that first response says the viewer may see
 * them — all three are gated the same way, so asking before knowing would just
 * be three 403s. When `can_view_content` is false the account is private and the
 * viewer has not been approved, so the screen shows the shell and says so rather
 * than rendering empty sections that look like an inactive user.
 *
 * The masthead's one control is whichever of two this is: `FollowButton` on
 * somebody else's profile, "Edit profile" on your own. A follow updates the
 * follower count in place from the response rather than re-reading the profile —
 * the API returns the resulting count for exactly this reason, and a refetch
 * here would blank a screen the reader is still looking at.
 *
 * The three failing side-requests all fail *quietly*, which is the web's rule
 * and worth restating: the header has already rendered by then, and an empty
 * grid is a better outcome than replacing somebody's whole profile with an error
 * about their Steam library.
 */
import { Lock, UserPen } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import {
  ApiError,
  BACKLOG_ORDER,
  distributionHeights,
  emptyListMessage,
  entriesOn,
  followListPath,
  formatCount,
  listName,
  statTiles,
  useAuth,
} from "@sidequestd/core";
import type {
  BacklogLists,
  FollowState,
  PlatformShowcase as PlatformShowcaseEntry,
  ProfileStats,
  ReviewPage,
  ReviewSummary,
  UserProfile,
} from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { rounded, useStyles, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { FavoriteGames } from "./favorite-games";
import { FollowButton, RemoveFollowerButton } from "./follow-button";
import { CoverTile, GameShelf } from "./game-shelf";
import { PlatformShowcase } from "./platform-showcase";
import { ReviewGrid } from "./review-tile";
import { Screen } from "./screen";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { Eyebrow } from "./ui/eyebrow";
import { ProfileSkeleton } from "./ui/skeleton";
import { Stat } from "./ui/stat";
import { EyebrowText, Text } from "./ui/text";

/** One screen of the grid. Paging beyond this is not a control the web has either. */
const GRID_SIZE = 12;

/** The tallest a distribution bar gets. The web's `h-28`. */
const BAR_HEIGHT = 112;

function Stats({ stats }: { stats: ProfileStats }) {
  const styles = useStyles(make);
  const heights = distributionHeights(stats);

  return (
    <View style={styles.section}>
      <Eyebrow heading rule>
        Stats
      </Eyebrow>

      <View style={styles.tiles}>
        {statTiles(stats).map((tile) => (
          <Stat key={tile.label} label={tile.label} value={tile.value} style={styles.tile} />
        ))}
      </View>

      <View style={styles.distribution}>
        <EyebrowText tone="faint">Rating distribution</EyebrowText>

        {stats.review_count > 0 ? (
          <View style={styles.bars} accessibilityLabel="Rating distribution">
            {stats.rating_distribution.map((entry, index) => (
              <View
                key={entry.rating}
                style={styles.barColumn}
                accessible
                accessibilityLabel={`${entry.count} review${entry.count === 1 ? "" : "s"} rated ${entry.rating}`}
              >
                {/* The fixed height is on the track rather than on the row: a
                    percentage only resolves against a parent whose height is
                    definite, and a flex child that is not stretched has none. */}
                <View style={styles.track}>
                  <View style={[styles.bar, { height: `${heights[index]}%` }]} />
                </View>
                <EyebrowText tone="faint">{entry.rating}</EyebrowText>
              </View>
            ))}
          </View>
        ) : (
          <Text size={14} tone="dim" relaxed>
            Nothing rated yet — the chart fills in once reviews land.
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * The four lists from SPEC §6.9.
 *
 * All four are drawn, empty ones included — they are *system* lists that exist
 * whether or not anything is on them, and hiding the empty ones would make a
 * profile with only a Completed list look like it had no backlog feature.
 */
function BacklogSection({ lists, isViewer }: { lists: BacklogLists; isViewer: boolean }) {
  const styles = useStyles(make);

  return (
    <View style={styles.section}>
      <Eyebrow heading rule>
        Lists
      </Eyebrow>

      <View style={styles.lists}>
        {BACKLOG_ORDER.map((status) => {
          const entries = entriesOn(lists, status);
          const name = listName(status);

          return (
            <View key={status} style={styles.list}>
              <View style={styles.listHeading}>
                <EyebrowText tone="dim">{name}</EyebrowText>
                {entries.length > 0 ? (
                  <EyebrowText tone="faint" style={styles.tabular}>
                    {entries.length}
                  </EyebrowText>
                ) : null}
              </View>

              {entries.length > 0 ? (
                <GameShelf label={name}>
                  {entries.map((entry) => (
                    <CoverTile
                      key={entry.id}
                      title={entry.game.title}
                      coverUrl={entry.game.cover_url}
                      onPress={() => open(`/games/${entry.game.id}`)}
                      caption={
                        <Text size={12} tone="dim" numberOfLines={2}>
                          {entry.game.title}
                        </Text>
                      }
                    />
                  ))}
                </GameShelf>
              ) : (
                <View style={styles.emptyList}>
                  <Text size={13} tone="dim" relaxed>
                    {emptyListMessage(status, isViewer)}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** One of the two follower counts, as the link the web made them. */
function CountLink({
  username,
  direction,
  count,
}: {
  username: string;
  direction: "followers" | "following";
  count: number;
}) {
  const styles = useStyles(make);

  return (
    <Pressable
      accessibilityRole="button"
      // The number and the word are separate nodes, and a screen reader would
      // otherwise run them into whatever follows.
      accessibilityLabel={`${count} ${direction}`}
      onPress={() => open(followListPath(username, direction))}
      hitSlop={6}
      style={styles.countLink}
    >
      <Text size={14} weight="medium" style={styles.tabular}>
        {formatCount(count)}
      </Text>
      <EyebrowText tone="faint">{direction}</EyebrowText>
    </Pressable>
  );
}

export function ProfileScreen({
  username,
  back = false,
  action,
}: {
  username: string;
  back?: boolean;
  /** The screen's one control. Sign out on the tab; nothing on anyone else's. */
  action?: ReactNode;
}) {
  const styles = useStyles(make);
  const { authedRequest, isLoading, user: viewer } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [lists, setLists] = useState<BacklogLists | null>(null);
  const [showcases, setShowcases] = useState<PlatformShowcaseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a follow changes what this viewer is allowed to see, which is
  // the one case where the answer to "what is on this profile" changes without
  // the handle changing.
  const [revision, setRevision] = useState(0);

  /**
   * Take the follow response as the truth, in place.
   *
   * `FollowResult` carries the resulting count, so nothing here is derived and
   * the header does not have to be re-read to stay honest. A private account is
   * the exception: approving is instant when it is a public account and a
   * *request* when it is not, and a request that turns into a follow changes
   * `can_view_content` — which only a fresh profile can report.
   */
  function applyFollow(result: { state: FollowState; followerCount: number }) {
    setProfile((current) =>
      current === null
        ? current
        : { ...current, viewer_follow_state: result.state, follower_count: result.followerCount },
    );
    if (profile?.is_private) setRevision((value) => value + 1);
  }

  useEffect(() => {
    // Wait for the session to settle. This endpoint answers signed-out callers
    // with 200, so a request sent before the initial /auth/refresh lands would
    // come back as the anonymous view — no `is_viewer`, no gated content — and
    // there is no 401 for `authedRequest`'s retry to hook into.
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
  }, [authedRequest, username, isLoading, revision]);

  // Keyed on the id the first response returned: the grid is paged (SPEC §6.2)
  // while the profile is not, and a private account the viewer cannot see would
  // answer all three of these with a 403 the header has no business showing.
  const ownerId = profile?.can_view_content ? profile.id : null;
  useEffect(() => {
    if (ownerId === null) {
      setReviews(null);
      setLists(null);
      setShowcases([]);
      return;
    }

    let cancelled = false;

    authedRequest<ReviewPage>(`/users/${ownerId}/reviews?limit=${GRID_SIZE}`)
      .then((page) => {
        if (!cancelled) setReviews(page.items);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });

    authedRequest<BacklogLists>(`/users/${ownerId}/backlog`)
      .then((body) => {
        if (!cancelled) setLists(body);
      })
      .catch(() => {
        if (!cancelled) setLists(null);
      });

    // Returns an empty list rather than a 404 when nothing is linked or the
    // owner has hidden it, so the failure path here is only ever a real error —
    // and an absent showcase renders nothing either way.
    authedRequest<PlatformShowcaseEntry[]>(`/users/${ownerId}/connections`)
      .then((body) => {
        if (!cancelled) setShowcases(body);
      })
      .catch(() => {
        if (!cancelled) setShowcases([]);
      });

    return () => {
      cancelled = true;
    };
  }, [authedRequest, ownerId]);

  if (error) {
    return (
      <Screen back={back} action={action}>
        <Alert>{error}</Alert>
        <Button onPress={() => open("/search")} style={styles.away}>
          Find someone else
        </Button>
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen back={back} action={action}>
        <ProfileSkeleton />
      </Screen>
    );
  }

  return (
    <Screen back={back} action={action}>
      <View style={styles.header}>
        <Avatar user={profile} size={96} />

        <View style={styles.identity}>
          {/* The handle in the display serif at the largest size on the screen.
              A profile is a masthead — the name is the headline, and every other
              screen's title is set the same way. */}
          <Text variant="display" size={32} accessibilityRole="header">
            {profile.username}
          </Text>
          {/* No lock glyph inside it, unlike the web's. A `Badge` is a `<Text>`
              in a box, and an icon nested in native running text is sized and
              baselined by the platform rather than by us — it lands a pixel
              high on iOS and unpredictably on Android. Mono caps in an outline
              box already reads as a label rather than a control, which is the
              work the icon was helping with. */}
          {profile.is_private ? <Badge tone="outline">Private</Badge> : null}
        </View>

        {profile.display_name ? (
          <Text size={15} tone="dim">
            {profile.display_name}
          </Text>
        ) : null}
        {profile.bio ? (
          <Text size={14} tone="dim" relaxed>
            {profile.bio}
          </Text>
        ) : null}

        <View style={styles.counts}>
          <CountLink
            username={profile.username}
            direction="followers"
            count={profile.follower_count}
          />
          <CountLink
            username={profile.username}
            direction="following"
            count={profile.following_count}
          />
        </View>

        {/* One control, and which one depends on whose profile this is. The
            count above it moves with the response rather than with a refetch —
            `FollowResult` carries the resulting follower count precisely so a
            screen can stay put. */}
        {profile.is_viewer ? (
          <Button size="sm" icon={UserPen} onPress={() => open("/settings/profile")}>
            Edit profile
          </Button>
        ) : viewer ? (
          // Signed out there is nothing to press: following is an action by
          // somebody, and the gated screens are how a reader becomes one.
          <View style={styles.follow}>
            <FollowButton
              user={profile}
              state={profile.viewer_follow_state}
              size="sm"
              onChange={applyFollow}
            />
            {/* Only on the profile of somebody who follows *you*, which is the
                one place the relationship this revokes is known without asking
                for it. */}
            {profile.follows_viewer ? (
              <RemoveFollowerButton
                user={profile}
                onRemoved={() => setRevision((value) => value + 1)}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {profile.can_view_content ? (
        <>
          <FavoriteGames entries={profile.favorite_games} isViewer={profile.is_viewer} />

          {profile.stats ? <Stats stats={profile.stats} /> : null}

          <PlatformShowcase showcases={showcases} />

          {lists ? <BacklogSection lists={lists} isViewer={profile.is_viewer} /> : null}

          <View style={styles.section}>
            <Eyebrow heading rule>
              Reviews
            </Eyebrow>

            {reviews === null ? (
              <EyebrowText tone="faint">Loading reviews…</EyebrowText>
            ) : reviews.length > 0 ? (
              <ReviewGrid reviews={reviews} onOpen={open} />
            ) : (
              <EmptyState
                description={
                  profile.is_viewer
                    ? "You haven't written a review yet."
                    : `${profile.username} hasn't written a review yet.`
                }
              />
            )}
          </View>
        </>
      ) : (
        <EmptyState
          icon={Lock}
          title="This account is private"
          description={
            profile.viewer_follow_state === "REQUESTED"
              ? `${profile.username} has your follow request. You'll see their reviews, favorites and stats once they approve it.`
              : `Follow ${profile.username} to see their reviews, favorites and stats.`
          }
        />
      )}
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    // Centred, unlike the web's left-aligned masthead. At 390px an avatar beside
    // a handle leaves the handle about eleven characters before it wraps, and
    // the serif at 32pt is the thing this screen is built around.
    header: { alignItems: "center", gap: 12 },
    identity: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
    counts: { flexDirection: "row", gap: 28, marginTop: 4 },
    // The masthead is centred, and a `FollowButton` is a column with an error
    // line under it — left to itself it would align its button to the left edge
    // of that column rather than to the middle of the screen.
    follow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 8 },
    countLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },

    section: { gap: 16 },

    tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    // Two per row rather than the web's three: a `Stat`'s figure is 28pt of
    // display serif, and three of those across 350pt sets "Average rating" over
    // two lines under a number with nowhere to go.
    tile: { flexBasis: "47%", flexGrow: 1 },

    distribution: { gap: 14, marginTop: 8 },
    bars: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
    barColumn: { flex: 1, alignItems: "center", gap: 8 },
    track: {
      height: BAR_HEIGHT,
      width: "100%",
      justifyContent: "flex-end",
      ...rounded(t.radius.sm),
      backgroundColor: t.color.surface,
    },
    // The accent as a fill, which is the one thing the palette rule says it is
    // for. Ten of these are the only saturated marks on the screen that are not
    // cover art.
    bar: { width: "100%", ...rounded(t.radius.sm), backgroundColor: t.color.accent },

    lists: { gap: 24 },
    list: { gap: 12 },
    listHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
    emptyList: {
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: t.color.line,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },

    tabular: { fontVariant: ["tabular-nums"] },
    away: { alignSelf: "flex-start" },
  });
