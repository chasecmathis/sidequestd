"use client";

/**
 * Home — the feed from SPEC §6.4.
 *
 * Reviews from the accounts you follow with their backlog activity blended
 * inline (SPEC §6.11) and a few recommended reviews mixed in (SPEC §6.4),
 * newest first, fetched a page at a time and appended as
 * the reader approaches the bottom. The sentinel below the list is what triggers
 * the next page; the "Load more" button beside it is the same action for anyone
 * who never reaches an IntersectionObserver — a keyboard, a screen reader, or a
 * browser that does not have one.
 *
 * Items are rendered by kind rather than assumed to be reviews, which is what
 * made adding activity a branch in `FeedRow` rather than a rewrite of this page.
 */
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Rss } from "lucide-react";

import { ActivityRow } from "@/components/activity-row";
import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { FollowButton } from "@/components/follow-button";
import { GameGrid } from "@/components/game-card";
import { RecommendedRow } from "@/components/recommended-row";
import { ReviewCard } from "@/components/review-card";
import { Alert } from "@/components/ui/alert";
import { Button, buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/lib/auth";
import {
  FEED_PREFETCH_MARGIN,
  feedItemKey,
  feedQuery,
  isActivityItem,
  isRecommendedItem,
  isReviewItem,
} from "@/lib/feed";
import { profilePath } from "@/lib/profile";
import type { FeedItem, FeedPage, FeedSuggestions } from "@sidequestd/api-types";

/**
 * How many rows get the staggered entrance.
 *
 * Only the first screenful. Past that the delay would be dead time on a page the
 * reader has already been looking at, and appended pages should simply be there
 * — an animation on "load more" makes the wait feel longer, not shorter.
 */
const STAGGER_COUNT = 6;

/** Who to follow and what is hot, for a reader whose feed has nothing in it. */
function QuietFeed({ suggestions }: { suggestions: FeedSuggestions | null }) {
  return (
    <div className="mt-8">
      <EmptyState
        icon={Rss}
        title="Your feed is quiet"
        description={
          <>
            Home shows reviews from the people you follow. Follow a few accounts and they&apos;ll
            appear here — or write the first review yourself.
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/reviews/new" className={buttonStyles({ variant: "primary" })}>
              Write a review
            </Link>
            <Link href="/discover" className={buttonStyles({ variant: "secondary" })}>
              <Compass aria-hidden strokeWidth={1.75} className="size-4" />
              Browse games
            </Link>
          </div>
        }
      />

      {suggestions && suggestions.accounts.length > 0 ? (
        <section className="mt-12">
          <h2 className="type-display text-2xl text-fg">Suggested accounts</h2>
          <ul aria-label="Suggested accounts" className="mt-5 flex flex-col gap-2">
            {suggestions.accounts.map((account) => (
              <li
                key={account.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors duration-200 hover:border-line-strong"
              >
                <Link href={profilePath(account.username)} className="shrink-0">
                  <Avatar user={account} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={profilePath(account.username)}
                    className="link-quiet text-sm font-medium text-fg"
                  >
                    {account.display_name ?? account.username}
                  </Link>
                  <p className="type-eyebrow mt-1 truncate text-fg-faint">@{account.username}</p>
                </div>
                {/* Suggestions are public accounts only, so the follow lands
                    immediately — there is nothing to approve (SPEC §6.7). */}
                <FollowButton user={account} state="NONE" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {suggestions && suggestions.trending.length > 0 ? (
        <section className="mt-12">
          <Eyebrow as="h2" rule className="mb-5">
            Trending games
          </Eyebrow>
          <GameGrid games={suggestions.trending.map((entry) => entry.game)} />
        </section>
      ) : null}
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  if (isReviewItem(item)) return <ReviewCard review={item.review} />;
  if (isActivityItem(item)) return <ActivityRow item={item} />;
  if (isRecommendedItem(item)) return <RecommendedRow item={item} />;
  // Not reachable from today's API. It stays so that a kind this build has never
  // heard of is a gap on the screen rather than a crash in the middle of
  // somebody's feed — which is also why the key comes off the envelope.
  return null;
}

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading, authedRequest } = useAuth();

  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FeedSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // A ref rather than the state above, because the observer callback closes over
  // whatever was current when it was registered: two intersections in the same
  // frame would both see `loadingMore` false and fetch the same cursor twice.
  const fetching = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    authedRequest<FeedPage>(feedQuery({}))
      .then(async (page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.next_cursor);

        // Only asked for when there is nothing to show. The common case is a
        // feed with content, and that reader never pays for this request.
        if (page.items.length === 0) {
          const empty = await authedRequest<FeedSuggestions>("/feed/suggestions");
          if (!cancelled) setSuggestions(empty);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Request failed.");
      });

    return () => {
      cancelled = true;
    };
  }, [user, authedRequest]);

  const loadMore = useCallback(async () => {
    if (nextCursor === null || fetching.current) return;

    fetching.current = true;
    setLoadingMore(true);
    try {
      const page = await authedRequest<FeedPage>(feedQuery({ cursor: nextCursor }));
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      fetching.current = false;
      setLoadingMore(false);
    }
  }, [authedRequest, nextCursor]);

  useEffect(() => {
    const node = sentinel.current;
    // No observer in a test environment, and nothing to watch for on the last
    // page. The button below stays either way, so neither case strands anyone.
    if (node === null || nextCursor === null || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      // Start fetching before the sentinel is on screen, so the next page is
      // usually there by the time the reader would have noticed it was missing.
      { rootMargin: FEED_PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nextCursor, loadMore]);

  if (isLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="type-eyebrow text-fg-faint">Loading…</p>
      </main>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow="Your feed"
          title="Home"
          description="Reviews and lists from the people you follow, newest first."
        />

        {error ? (
          <Alert tone="error" className="mt-6">
            {error}
          </Alert>
        ) : null}

        {items === null ? (
          <div className="mt-8">
            <FeedSkeleton />
          </div>
        ) : items.length > 0 ? (
          <>
            <ul aria-label="Feed" className="mt-8 flex flex-col gap-6">
              {items.map((item, index) => (
                <motion.li
                  key={feedItemKey(item)}
                  initial={index < STAGGER_COUNT ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, STAGGER_COUNT) * 0.04 }}
                >
                  <FeedRow item={item} />
                </motion.li>
              ))}
            </ul>

            <div ref={sentinel} aria-hidden className="h-px" />

            {nextCursor ? (
              <Button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="mx-auto mt-8 flex"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <p className="type-eyebrow mt-10 text-center text-fg-faint">
                You&apos;re all caught up.
              </p>
            )}
          </>
        ) : (
          <QuietFeed suggestions={suggestions} />
        )}
      </div>
    </AppShell>
  );
}
