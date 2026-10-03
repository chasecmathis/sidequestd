"use client";

/**
 * The two sides of the follow graph — SPEC §6.7.
 *
 * One component behind two routes. `/profile/x/followers` and
 * `/profile/x/following` differ by which endpoint they call, what the empty
 * state says, and which control a row may offer; everything else — the header,
 * the switch, the paging, the privacy gate — is the same screen twice, and
 * writing it twice is how the two drift apart.
 *
 * Two requests, in order, for the same reason the profile makes two: the list
 * endpoints take a user *id* while the URL carries a handle, so the profile has
 * to answer first. That first response also carries `can_view_content`, which
 * decides whether asking for the list at all would just be a 403.
 *
 * **Which actions appear, and why only these.** `UserPublic` — what the list
 * endpoints return — says nothing about the viewer's standing with each person
 * in it. So an action is only drawn where *membership in this particular list*
 * already proves the relationship:
 *
 *   - your own Following: everyone here is someone you follow, so Unfollow is
 *     certain to be correct;
 *   - your own Followers: everyone here follows you, so Remove is correct.
 *
 * On anyone else's lists, and for "do you also follow this person", the honest
 * answer is that this payload does not know — so nothing is drawn rather than a
 * Follow button that might be lying. Each row still links to the profile, where
 * the real state is known.
 */
import { Lock, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { FollowButton, RemoveFollowerButton } from "@/components/follow-button";
import { UserList, UserRow } from "@/components/user-row";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/skeleton";
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

import { cn } from "@/lib/cn";

import type { UserPage, UserProfile, UserPublic } from "@sidequestd/api-types";

/**
 * Followers | Following, as navigation rather than as tabs.
 *
 * They are two URLs, so they are two links — `role="tablist"` would promise a
 * screen reader that pressing one swaps a panel in place, which is not what
 * happens. `aria-current="page"` is the honest way to say which one you are on.
 */
function DirectionSwitch({ profile, active }: { profile: UserProfile; active: FollowDirection }) {
  const sides: { direction: FollowDirection; count: number }[] = [
    { direction: "followers", count: profile.follower_count },
    { direction: "following", count: profile.following_count },
  ];

  return (
    <nav aria-label="Follow lists" className="mt-8 flex gap-1 border-b border-line">
      {sides.map(({ direction, count }) => {
        const current = direction === active;
        return (
          <Link
            key={direction}
            href={followListPath(profile.username, direction)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "type-eyebrow relative flex items-center gap-2 px-3.5 py-3 transition-colors duration-150",
              current ? "text-fg" : "text-fg-faint hover:text-fg-dim",
            )}
          >
            {followListLabel(direction)}
            <span className="text-sm tabular-nums">{formatCount(count)}</span>
            {current ? (
              // Sits on the container's border rather than beside it, so the
              // rule reads as one line with a lit segment.
              <span aria-hidden className="absolute inset-x-0 -bottom-px h-px bg-accent" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function FollowListScreen({ direction }: { direction: FollowDirection }) {
  const { username } = useParams<{ username: string }>();
  const { authedRequest, isLoading } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [people, setPeople] = useState<UserPublic[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Same wait as the profile: this endpoint answers signed-out callers with 200,
  // so asking before /auth/refresh lands returns the anonymous view and the
  // screen would decide there are no actions to offer.
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
    if (!nextCursor || ownerId === null) return;

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
  }, [authedRequest, ownerId, direction, nextCursor]);

  /** Drop someone the viewer just removed. See `rowAction` for why only here. */
  const dropPerson = useCallback((userId: string) => {
    setPeople((current) => current?.filter((person) => person.id !== userId) ?? current);
  }, []);

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
        <ListSkeleton label={`Loading ${followListLabel(direction).toLowerCase()}`} />
      </AppShell>
    );
  }

  const isViewer = profile.is_viewer;

  /**
   * The control this row may offer, if any.
   *
   * Unfollow leaves the row in place: it is undoable, the button turns straight
   * back into Follow, and a row that vanishes on a mis-click sends the reader to
   * search to find that person again. Remove-follower takes the row out,
   * because it is *not* undoable from here — the edge is gone and only that
   * person can recreate it, so leaving them listed would be a lie.
   */
  function rowAction(person: UserPublic) {
    if (!isViewer) return undefined;

    if (direction === "following") {
      return <FollowButton user={person} state="FOLLOWING" />;
    }
    return <RemoveFollowerButton user={person} onRemoved={() => dropPerson(person.id)} />;
  }

  return (
    <AppShell>
      <Link
        href={profilePath(profile.username)}
        className="group flex items-center gap-3.5 text-fg-dim"
      >
        <Avatar user={profile} size={44} />
        <span>
          <span className="type-eyebrow block text-fg-faint">Back to profile</span>
          <span className="link-quiet mt-1 block text-lg text-fg">@{profile.username}</span>
        </span>
      </Link>

      <DirectionSwitch profile={profile} active={direction} />

      {/* The heading a screen reader lands on, and the thing the tests find this
          screen by. Visually the switch above already says which side this is,
          so repeating it in a display serif would be the same word twice. */}
      <h1 className="sr-only">
        {followListLabel(direction)} of @{profile.username}
      </h1>

      <div className="mt-8">
        {!profile.can_view_content ? (
          <EmptyState
            icon={Lock}
            title="This account is private"
            description={
              profile.viewer_follow_state === "REQUESTED"
                ? `@${profile.username} has your follow request. You'll see who they follow once they approve it.`
                : `Follow @${profile.username} to see this list.`
            }
          />
        ) : people === null ? (
          <ListSkeleton label={`Loading ${followListLabel(direction).toLowerCase()}`} />
        ) : people.length === 0 ? (
          <EmptyState
            icon={Users}
            description={emptyFollowMessage(direction, isViewer, profile.username)}
          />
        ) : (
          <UserList label={`${followListLabel(direction)} of @${profile.username}`}>
            {people.map((person) => (
              <UserRow key={person.id} user={person} action={rowAction(person)} />
            ))}
          </UserList>
        )}
      </div>

      {listError ? (
        <Alert tone="error" className="mt-5">
          {listError}
        </Alert>
      ) : null}

      {nextCursor ? (
        <Button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mx-auto mt-8 flex"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </AppShell>
  );
}
