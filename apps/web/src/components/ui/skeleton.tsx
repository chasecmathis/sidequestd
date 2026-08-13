/**
 * Loading placeholders, in the shape of the thing that is coming.
 *
 * These replace the bare `Loading…` strings the app used everywhere. A skeleton
 * is worth the code because it holds the layout still: the feed does not jump a
 * screen's height when the first page lands, which is the difference between a
 * page that feels fast and one that feels broken.
 *
 * Every set is `aria-hidden` with a `role="status"` wrapper carrying the real
 * announcement. A screen reader should hear "Loading your feed", not a
 * description of twelve grey rectangles.
 */
import { cn } from "@/lib/cn";

/** One shimmering block. Pulse rather than a sweeping gradient: at 3% grain a
    moving highlight reads as a rendering artefact. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

function Loading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** One review card's silhouette: author row, wide media panel, rating, text. */
export function ReviewSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="aspect-4/3 w-full rounded-none" />
      <div className="space-y-3 px-4 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    </div>
  );
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Loading label="Loading your feed">
      <div className="flex flex-col gap-6">
        {Array.from({ length: count }, (_, index) => (
          <ReviewSkeleton key={index} />
        ))}
      </div>
    </Loading>
  );
}

/** Matches `GameGrid`'s columns exactly, so nothing shifts when covers arrive. */
export function GameGridSkeleton({
  count = 5,
  label = "Loading games",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <Loading label={label}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-lg border border-line bg-surface">
            <Skeleton className="aspect-3/4 w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
              {/* Title, year, then the score strip — the third line a real card
                  gained, so the placeholder is still the same height as what
                  replaces it. */}
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function ProfileSkeleton() {
  return (
    <Loading label="Loading profile">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Skeleton className="size-28 rounded-full" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </Loading>
  );
}

/** A stack of rows: notifications, follow requests, search results. */
export function ListSkeleton({ count = 5, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <Loading label={label}>
      <div className="flex flex-col gap-2">
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
          >
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}
