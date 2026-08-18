"use client";

/**
 * Profile — SPEC §6.2, with the stats from §6.8.
 *
 * `GET /users/{username}` carries the shell, the follower counts, the favorites,
 * the stats and the viewer's own standing with the account, already gated by the
 * API. The reviews grid and the backlog lists are separate requests, made only
 * once that first response says the viewer may see them — both are gated the
 * same way, so asking for either before knowing would just be a 403.
 * When `can_view_content` is false
 * the account is private and the viewer has not been approved, so the page shows
 * the shell and says so rather than rendering empty sections that look like an
 * inactive user — but the Follow button is right there, which is the whole
 * reason SPEC §6.7 keeps a private account's shell public.
 */
import { Lock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { FavoriteGames } from "@/components/favorite-games";
import { PlatformShowcase } from "@/components/platform-showcase";
import { FollowButton, RemoveFollowerButton } from "@/components/follow-button";
import { GameCard } from "@/components/game-card";
import { ReviewGrid } from "@/components/review-tile";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BACKLOG_ORDER, emptyListMessage, entriesOn, listName } from "@/lib/backlog";
import { distributionHeights, formatCount, statTiles } from "@/lib/profile";
import { followListPath } from "@/lib/social";
import type {
  BacklogLists,
  FollowState,
  PlatformShowcase as PlatformShowcaseEntry,
  ProfileStats,
  ReviewPage,
  ReviewSummary,
  UserProfile,
} from "@sidequestd/api-types";

/** One screen of the grid. Paging beyond this arrives with the feed slice. */
const GRID_SIZE = 12;

function Stats({ stats }: { stats: ProfileStats }) {
  const heights = distributionHeights(stats);
  const rated = stats.review_count > 0;

  return (
    <section className="mt-14">
      <Eyebrow as="h2" rule className="mb-5">
        Stats
      </Eyebrow>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {statTiles(stats).map((tile) => (
          <Stat key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </dl>

      <div className="mt-8">
        <h3 className="type-eyebrow text-fg-faint">Rating distribution</h3>
        {rated ? (
          <ul className="mt-4 flex gap-1.5" aria-label="Rating distribution">
            {stats.rating_distribution.map((entry, index) => (
              <li key={entry.rating} className="flex flex-1 flex-col items-center gap-2">
                {/* The fixed height lives on the track, not on the list: a
                    percentage only resolves against a parent whose height is
                    definite, and a flex item that is not stretched has none. */}
                <div className="flex h-28 w-full items-end rounded-sm bg-surface">
                  <div
                    className="w-full rounded-sm bg-accent transition-[height] duration-500"
                    style={{ height: `${heights[index]}%` }}
                    title={`${entry.count} review${entry.count === 1 ? "" : "s"} rated ${entry.rating}`}
                  />
                </div>
                <span className="type-eyebrow text-fg-faint">{entry.rating}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-fg-dim">
            Nothing rated yet — the chart fills in once reviews land.
          </p>
        )}
      </div>
    </section>
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
  return (
    <section className="mt-14">
      <Eyebrow as="h2" rule className="mb-6">
        Lists
      </Eyebrow>

      <div className="flex flex-col gap-8">
        {BACKLOG_ORDER.map((status) => {
          const entries = entriesOn(lists, status);
          return (
            <div key={status}>
              <h3 className="type-eyebrow flex items-baseline gap-2 text-fg-dim">
                {listName(status)}
                {entries.length > 0 ? (
                  <span className="tabular-nums text-fg-faint">{entries.length}</span>
                ) : null}
              </h3>
              <div className="mt-3.5">
                {entries.length > 0 ? (
                  <ul
                    aria-label={listName(status)}
                    className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6"
                  >
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <GameCard game={entry.game} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-fg-dim">
                    {emptyListMessage(status, isViewer)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { authedRequest, isLoading, user: viewer } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [lists, setLists] = useState<BacklogLists | null>(null);
  const [showcases, setShowcases] = useState<PlatformShowcaseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a follow action changes what this viewer is allowed to see, to
  // re-read the profile. Only a private account needs it: unfollowing one closes
  // the gate again, and the reviews already on screen would otherwise stay there.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    // Wait for the session to settle. This endpoint answers signed-out callers
    // with 200, so a request sent before the initial /auth/refresh lands would
    // come back as the anonymous view — no `is_viewer`, no gated content — and
    // there is no 401 for authedRequest's retry to hook into.
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

  /** Apply what a follow action returned, without re-reading the whole profile. */
  function applyFollow(result: { state: FollowState; followerCount: number }) {
    setProfile((current) =>
      current === null
        ? current
        : {
            ...current,
            viewer_follow_state: result.state,
            follower_count: result.followerCount,
          },
    );
    // A public account shows the same things either way, so only a private one
    // has anything to re-read.
    if (profile?.is_private) setRevision((value) => value + 1);
  }

  // A second request, keyed on the id the first one returned: the grid is paged
  // (SPEC §6.2) while the profile is not, and a private account the viewer cannot
  // see would answer this one with a 403 the header has no business showing.
  const ownerId = profile?.can_view_content ? profile.id : null;
  useEffect(() => {
    if (ownerId === null) {
      setReviews(null);
      setLists(null);
      return;
    }

    let cancelled = false;
    authedRequest<ReviewPage>(`/users/${ownerId}/reviews?limit=${GRID_SIZE}`)
      .then((page) => {
        if (!cancelled) setReviews(page.items);
      })
      .catch(() => {
        // The header has already rendered; an empty grid is a better failure
        // than replacing the whole profile with an error.
        if (!cancelled) setReviews([]);
      });

    // Gated by the same `can_view_content` as the grid: SPEC §6.9 says lists
    // inherit the account's privacy, so a viewer who cannot see the reviews
    // would only get a 403 from this too.
    authedRequest<BacklogLists>(`/users/${ownerId}/backlog`)
      .then((body) => {
        if (!cancelled) setLists(body);
      })
      .catch(() => {
        if (!cancelled) setLists(null);
      });

    // Same gate again. Returns an empty list rather than a 404 when nothing is
    // linked or the owner has hidden it, so the failure path here is only ever a
    // real error — and an absent showcase renders nothing either way.
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
      <AppShell>
        <Alert tone="error">{error}</Alert>
        <Link href="/search" className="link mt-5 inline-block text-sm text-fg">
          Find someone else
        </Link>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell>
        <ProfileSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="flex flex-col gap-7 sm:flex-row sm:items-start">
        <Avatar user={profile} size={112} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {/* The handle in the display serif at the largest size on the page.
                A profile is a masthead — the name is the headline, and every
                other page's h1 is set the same way. */}
            <h1 className="type-display text-4xl text-fg sm:text-5xl">{profile.username}</h1>
            {profile.is_private ? (
              <Badge tone="outline" className="gap-1.5">
                <Lock aria-hidden strokeWidth={2} className="size-3" />
                Private
              </Badge>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {profile.is_viewer ? (
              <Link
                href="/settings/profile"
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                Edit profile
              </Link>
            ) : viewer ? (
              // Signed out there is nothing to press: following is an action by
              // somebody, and the sign-in link in the nav is the way to become one.
              <FollowButton
                user={profile}
                state={profile.viewer_follow_state}
                onChange={applyFollow}
              />
            ) : null}

            {profile.follows_viewer ? (
              <RemoveFollowerButton user={profile} onRemoved={() => setRevision((n) => n + 1)} />
            ) : null}
          </div>

          {profile.display_name ? <p className="mt-4 text-fg-dim">{profile.display_name}</p> : null}
          {profile.bio ? (
            <p className="prose-review mt-3 whitespace-pre-line text-sm text-fg-dim">
              {profile.bio}
            </p>
          ) : null}

          {/* Links, not text. The counts were the only place on the profile that
              named a set of people and then offered no way to see them. Each
              one carries its own accessible name rather than relying on the
              visible "1,204 followers" reading, because the number and the word
              are separate nodes and a screen reader would run them together
              with whatever follows. */}
          <ul className="mt-5 flex gap-7">
            {(
              [
                { direction: "followers", count: profile.follower_count },
                { direction: "following", count: profile.following_count },
              ] as const
            ).map(({ direction, count }) => (
              <li key={direction}>
                <Link
                  href={followListPath(profile.username, direction)}
                  aria-label={`${count} ${direction}`}
                  className="type-eyebrow group flex items-baseline gap-1.5 text-fg-faint transition-colors duration-150 hover:text-fg-dim"
                >
                  <span className="link-quiet text-sm tabular-nums text-fg">
                    {formatCount(count)}
                  </span>
                  {direction}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {profile.can_view_content ? (
        <>
          <FavoriteGames
            entries={profile.favorite_games}
            isViewer={profile.is_viewer}
            username={profile.username}
          />

          {profile.stats ? <Stats stats={profile.stats} /> : null}

          <PlatformShowcase showcases={showcases} />

          {lists ? <BacklogSection lists={lists} isViewer={profile.is_viewer} /> : null}

          <section className="mt-14">
            <div className="mb-5 flex items-center justify-between gap-4">
              <Eyebrow as="h2" className="flex-1">
                Reviews
              </Eyebrow>
              {profile.is_viewer ? (
                <Link href="/reviews/new" className="link type-eyebrow text-fg">
                  Write a review
                </Link>
              ) : null}
            </div>

            {reviews === null ? (
              <p className="type-eyebrow text-fg-faint">Loading reviews…</p>
            ) : reviews.length > 0 ? (
              <ReviewGrid reviews={reviews} />
            ) : (
              <EmptyState
                description={
                  profile.is_viewer
                    ? "You haven't written a review yet."
                    : `${profile.username} hasn't written a review yet.`
                }
              />
            )}
          </section>
        </>
      ) : (
        <section className="mt-14">
          <EmptyState
            icon={Lock}
            title="This account is private"
            description={
              profile.viewer_follow_state === "REQUESTED"
                ? `${profile.username} has your follow request. You'll see their reviews, favorites and stats once they approve it.`
                : `Follow ${profile.username} to see their reviews, favorites and stats.`
            }
          />
        </section>
      )}
    </AppShell>
  );
}
