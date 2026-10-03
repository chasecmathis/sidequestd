"use client";

/**
 * Game Detail (SPEC §5).
 *
 * The catalog record, plus the two things SPEC §6.9 and §6.3 say a reader does
 * from here: put the game on a backlog list, or start reviewing it. The list of
 * *other people's* reviews of this game belongs to a later slice.
 *
 * The cover art is given real size and the title is set as a headline beside it.
 * This is the one page in the app about a single object, so it is the one page
 * that can afford the space — everywhere else the same artwork is a card in a
 * grid.
 */
import { ArrowUpRight, ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { BacklogControl } from "@/components/backlog-control";
import { GameScores } from "@/components/game-scores";
import { Alert } from "@/components/ui/alert";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { StoreMark } from "@/components/ui/store-mark";
import {
  ApiError,
  linkableStores,
  releaseYearLabel,
  storeLinkLabel,
  useAuth,
} from "@sidequestd/core";

import type { GameDetail } from "@sidequestd/api-types";

function Tags({ label, items }: { label: string; items: { id: string; name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <Eyebrow as="h2">{label}</Eyebrow>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-fg-dim"
          >
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Where to buy or launch the game, as one more entry in the line of facts.
 *
 * It belongs here rather than beside "Write a review" because a store listing is
 * something *about* the game, not something the reader does inside Sidequestd —
 * and the action row below is reserved for the two things that are.
 *
 * `link-quiet` rather than `link`: position already marks it as clickable, so the
 * accent arrives as an underline on hover and never as text colour. The one
 * chromatic step it does take is `text-fg-dim` against the line's `text-fg-faint`,
 * which is enough to find it and not enough to make the line about it.
 *
 * The arrow is doing real work. Nothing else on this page leaves the app, and a
 * reader who clicks a link in a metadata line has every reason to expect it to
 * stay put.
 */
function StoreLinks({ game }: { game: GameDetail }) {
  const stores = linkableStores(game.store_links);
  if (stores.length === 0) return null;

  return (
    <>
      {stores.map((store) => (
        // The separator lives inside the nowrap span so a narrow viewport can
        // break the line before " · Steam ↗" but never inside it.
        <span key={store.source} className="whitespace-nowrap">
          {" · "}
          <a
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={storeLinkLabel(store, game.title)}
            className="link-quiet inline-flex items-center gap-1 align-middle text-fg-dim transition-colors duration-150 hover:text-fg"
          >
            <StoreMark source={store.source} className="size-3.5" />
            {store.label}
            <ArrowUpRight aria-hidden strokeWidth={2} className="size-3" />
          </a>
        </span>
      ))}
    </>
  );
}

export default function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { authedRequest } = useAuth();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authedRequest<GameDetail>(`/games/${id}`)
      .then((body) => {
        if (!cancelled) setGame(body);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "That game isn't in the catalog."
            : cause instanceof Error
              ? cause.message
              : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, id]);

  if (error) {
    return (
      <AppShell>
        <Alert tone="error">{error}</Alert>
        <Link href="/discover" className="link mt-5 inline-block text-sm text-fg">
          Back to Discover
        </Link>
      </AppShell>
    );
  }

  if (!game) {
    return (
      <AppShell>
        <div role="status" aria-live="polite" aria-busy>
          <span className="sr-only">Loading game</span>
          <div className="flex flex-col gap-10 sm:flex-row">
            <Skeleton className="aspect-3/4 w-full max-w-[240px] shrink-0" />
            <div className="flex-1 space-y-4">
              <Skeleton className="h-12 w-3/4" />
              {/* Wide enough for "Released 2015 · via igdb · Steam ↗" rather
                  than for the shortest form of that line, so a game that has a
                  store link does not widen it on arrival. */}
              <Skeleton className="h-4 w-64" />
              {/* The score band, held open so the summary below it does not jump
                  ~90px when the game arrives. Two columns because both are
                  usually present, and the IGDB one collapsing shifts nothing
                  horizontally — the grid columns are fixed. */}
              <div className="flex gap-10 pt-3">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-28" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-28" />
                </div>
              </div>
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-10 sm:flex-row">
        {/* The one place a shadow earns its keep: box art is a physical object,
            and lifting it off the canvas is what makes the page read as a shelf
            rather than as a record. */}
        <div className="relative aspect-3/4 w-full max-w-[240px] shrink-0 self-start overflow-hidden rounded-lg border border-line bg-surface-2 shadow-panel">
          {game.cover_url ? (
            <Image
              src={game.cover_url}
              alt={`${game.title} cover art`}
              fill
              sizes="240px"
              className="object-cover"
              priority
            />
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-2">
              <ImageOff aria-hidden strokeWidth={1.25} className="size-6 text-fg-faint" />
              <span className="type-eyebrow text-fg-faint">No cover art</span>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="type-display text-5xl text-fg sm:text-6xl">{game.title}</h1>
          <p className="type-eyebrow mt-4 text-fg-faint">
            Released {releaseYearLabel(game.release_year)}
            {game.external_source ? ` · via ${game.external_source}` : ""}
            <StoreLinks game={game} />
          </p>

          {/* Above the summary: the summary is prose the eye skips, and how the
              game was received is the second thing a reader wants after its name. */}
          <GameScores game={game} />

          {game.summary ? <p className="prose-review mt-7 text-fg-dim">{game.summary}</p> : null}

          <div className="mt-9 space-y-7">
            <Tags label="Genres" items={game.genres} />
            <Tags label="Platforms" items={game.platforms} />
          </div>

          <div className="mt-10 flex flex-wrap items-start gap-3 border-t border-line pt-8">
            <Link
              href={`/reviews/new?game=${game.id}`}
              className={buttonStyles({ variant: "primary" })}
            >
              Write a review
            </Link>
            <BacklogControl game={game} className="max-w-[13rem]" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
