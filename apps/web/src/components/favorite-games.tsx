"use client";

/**
 * Pinned games — SPEC §6.2's "short pinned/curated list", made editable.
 *
 * The API has had the whole surface since the profile slice — add, unpin,
 * reorder — and nothing called it. This is the surface.
 *
 * **Six slots, always six.** `MAX_FAVORITE_GAMES` is 6, and the cap is the
 * design rather than an error to discover: in edit mode all six are drawn,
 * filled or not, so "full" is something you can see before you press anything.
 * A list that silently accepts five and answers the sixth with a 409 teaches
 * people that the app is broken.
 *
 * **Order is the point.** These are ranked, not collected — so each slot wears
 * its numeral, and the reorder controls are arrows rather than drag. Drag would
 * need a keyboard path built beside it to be usable at all; two buttons per slot
 * *are* that path, and they work identically for a mouse.
 *
 * Every mutation returns the entire list, so nothing here has to derive the
 * resulting order — the moves are optimistic for feel and then overwritten by
 * what the server says the list actually is.
 */
import { ChevronLeft, ChevronRight, ImageOff, Pin, Plus, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { GameCard } from "@/components/game-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { inputStyles } from "@/components/ui/field";
import { releaseYearLabel, searchQuery } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { MAX_FAVORITE_GAMES, moveFavorite, slotLabel } from "@/lib/profile";
import type { FavoriteGameEntry, GamePage, GameSummary } from "@sidequestd/api-types";

const DEBOUNCE_MS = 250;

/**
 * The game picker.
 *
 * A search rather than a browse: the catalog runs to tens of thousands of rows,
 * and someone pinning a favourite already knows its name. Games that are
 * already pinned stay in the results but cannot be pressed — hiding them would
 * leave the reader hunting for a game they would swear they own, and pressing
 * one is the 409 this component exists to avoid.
 */
function GamePicker({
  open,
  onClose,
  pinnedIds,
  onPick,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  pinnedIds: Set<string>;
  onPick: (game: GameSummary) => void;
  pending: boolean;
}) {
  const { authedRequest } = useAuth();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<GameSummary[]>([]);
  const [searching, setSearching] = useState(false);

  // Cleared on close so reopening does not show the last person's search.
  useEffect(() => {
    if (!open) {
      setTerm("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const query = term.trim();
    if (!query) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      authedRequest<GamePage>(searchQuery("games", query))
        .then((page) => {
          if (!cancelled) setResults(page.items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authedRequest, term]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pin a game"
      description={`Search the catalog. You can pin ${MAX_FAVORITE_GAMES} in total.`}
    >
      <div className="border-b border-line p-4">
        <label htmlFor="pin-search" className="sr-only">
          Search games to pin
        </label>
        <input
          id="pin-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Hollow Knight"
          autoComplete="off"
          className={inputStyles()}
        />
      </div>

      {term.trim() === "" ? (
        <p className="px-4 py-8 text-center text-sm text-fg-dim">
          Start typing to find a game to pin.
        </p>
      ) : results.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-dim">
          {searching ? "Searching…" : `Nothing in the catalog matches “${term.trim()}”.`}
        </p>
      ) : (
        <ul aria-label="Search results">
          {results.map((game) => {
            const alreadyPinned = pinnedIds.has(game.id);
            return (
              <li key={game.id}>
                <button
                  type="button"
                  disabled={alreadyPinned || pending}
                  onClick={() => onPick(game)}
                  className="flex w-full items-center gap-3.5 border-b border-line px-4 py-3 text-left transition-colors duration-150 last:border-b-0 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                >
                  <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                    {game.cover_url ? (
                      <Image
                        src={game.cover_url}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <ImageOff
                        aria-hidden
                        strokeWidth={1.25}
                        className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-fg-faint"
                      />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="type-display block truncate text-lg text-fg">
                      {game.title}
                    </span>
                    <span className="type-eyebrow mt-1 block text-fg-faint">
                      {releaseYearLabel(game.release_year)}
                    </span>
                  </span>

                  {alreadyPinned ? (
                    <span className="type-eyebrow shrink-0 text-fg-faint">Pinned</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

export function FavoriteGames({
  entries,
  isViewer,
  username,
}: {
  entries: FavoriteGameEntry[];
  isViewer: boolean;
  username: string;
}) {
  const { authedRequest } = useAuth();
  const [games, setGames] = useState<GameSummary[]>(() => entries.map((entry) => entry.game));
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded when the profile hands down a different list — navigating between
  // two profiles, or a re-read after a follow. Keyed on the ids rather than the
  // array, which the parent rebuilds every render.
  const signature = entries.map((entry) => entry.game.id).join(",");
  useEffect(() => {
    setGames(entries.map((entry) => entry.game));
    // `entries` is deliberately not a dependency: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Leaving edit mode when the section stops being the viewer's own — otherwise
  // navigating from your profile to someone else's would carry the controls.
  useEffect(() => {
    if (!isViewer) {
      setEditing(false);
      setPickerOpen(false);
    }
  }, [isViewer]);

  /**
   * Run a mutation and take the server's list as the truth.
   *
   * `optimistic` is what the grid should show while the request is in flight;
   * on failure the previous list goes back, because leaving a reorder on screen
   * that the server rejected is the one outcome worse than a slow reorder.
   *
   * The snapshot to restore comes off a ref rather than the closure. Reading
   * `games` directly here made this callback's identity depend on the list, and
   * a handler that was even one render stale would restore a *previous* list on
   * failure — pinning a game and then hitting a 409 emptied a grid that had a
   * game in it. The ref is whatever is on screen at the moment of the call,
   * which is the only thing "put it back" can honestly mean.
   */
  const gamesRef = useRef(games);
  gamesRef.current = games;

  const mutate = useCallback(
    async (request: () => Promise<FavoriteGameEntry[]>, optimistic?: GameSummary[]) => {
      const before = gamesRef.current;
      if (optimistic) setGames(optimistic);
      setPending(true);
      setError(null);

      try {
        const result = await request();
        setGames(result.map((entry) => entry.game));
      } catch (cause) {
        setGames(before);
        setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const pin = useCallback(
    (game: GameSummary) => {
      setPickerOpen(false);
      void mutate(() =>
        // `authedRequest` serialises `body` itself and sets the Content-Type
        // (see `lib/api.ts`), so this is the object, not a JSON string.
        authedRequest<FavoriteGameEntry[]>("/users/me/favorites", {
          method: "POST",
          body: { game_id: game.id },
        }),
      );
    },
    [authedRequest, mutate],
  );

  const unpin = useCallback(
    (game: GameSummary) => {
      void mutate(
        () =>
          authedRequest<FavoriteGameEntry[]>(`/users/me/favorites/${game.id}`, {
            method: "DELETE",
          }),
        // Off the ref for the same reason `mutate` restores from it: the
        // optimistic list has to be built from what is on screen right now.
        gamesRef.current.filter((candidate) => candidate.id !== game.id),
      );
    },
    [authedRequest, mutate],
  );

  const move = useCallback(
    (from: number, to: number) => {
      const current = gamesRef.current;
      const reordered = moveFavorite(current, from, to);
      if (reordered === current) return;

      void mutate(
        () =>
          authedRequest<FavoriteGameEntry[]>("/users/me/favorites", {
            method: "PUT",
            body: { game_ids: reordered.map((game) => game.id) },
          }),
        reordered,
      );
    },
    [authedRequest, mutate],
  );

  const pinnedIds = new Set(games.map((game) => game.id));
  const full = games.length >= MAX_FAVORITE_GAMES;
  // Only the viewer sees the empty tail; everyone else sees the games and stops.
  const slots = editing ? MAX_FAVORITE_GAMES : games.length;

  return (
    <section className="mt-14">
      <div className="mb-5 flex items-center justify-between gap-4">
        <Eyebrow as="h2" className="flex-1">
          Favorite games
        </Eyebrow>

        {isViewer && games.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>
            {editing ? "Done" : "Edit"}
          </Button>
        ) : null}
      </div>

      {games.length === 0 ? (
        <EmptyState
          icon={Pin}
          description={
            isViewer
              ? "Nothing pinned yet. Pick up to six games to sit at the top of your profile."
              : `@${username} hasn't pinned any games yet.`
          }
          action={
            isViewer ? (
              <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
                <Plus aria-hidden strokeWidth={2} className="size-4" />
                Pin a game
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: slots }, (_, index) => {
            const game = games[index];

            return (
              <li key={game?.id ?? `empty-${index}`} className="border-t border-line pt-3">
                {/* The numeral is the whole reason these read as ranked rather
                    than merely collected — the same device the landing page
                    uses for its numbered columns. */}
                <span className="type-eyebrow mb-2.5 block text-fg-faint">{slotLabel(index)}</span>

                {game ? (
                  <GameCard
                    game={game}
                    action={
                      editing ? (
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5"
                              disabled={pending || index === 0}
                              onClick={() => move(index, index - 1)}
                              aria-label={`Move ${game.title} earlier`}
                            >
                              <ChevronLeft aria-hidden strokeWidth={2} className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-1.5"
                              disabled={pending || index === games.length - 1}
                              onClick={() => move(index, index + 1)}
                              aria-label={`Move ${game.title} later`}
                            >
                              <ChevronRight aria-hidden strokeWidth={2} className="size-4" />
                            </Button>
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5"
                            disabled={pending}
                            onClick={() => unpin(game)}
                            aria-label={`Unpin ${game.title}`}
                          >
                            <X aria-hidden strokeWidth={2} className="size-4" />
                          </Button>
                        </div>
                      ) : undefined
                    }
                  />
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setPickerOpen(true)}
                    aria-label={`Pin a game to slot ${slotLabel(index)}`}
                    className="flex aspect-3/4 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-fg-faint transition-colors duration-200 hover:border-line-strong hover:text-fg-dim disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus aria-hidden strokeWidth={1.5} className="size-6" />
                    <span className="type-eyebrow">Add</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && full ? (
        <p className="type-eyebrow mt-4 text-fg-faint">
          All {MAX_FAVORITE_GAMES} slots are full — unpin one to make room.
        </p>
      ) : null}

      <Alert tone="error" className="mt-4">
        {error}
      </Alert>

      {isViewer ? (
        <GamePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          pinnedIds={pinnedIds}
          onPick={pin}
          pending={pending}
        />
      ) : null}
    </section>
  );
}
