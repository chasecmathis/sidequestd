"use client";

/**
 * "Add to list", wherever SPEC §6.9 says a game can be added from — Search
 * results, Game Detail, and a review.
 *
 * A native `<select>` rather than a menu of buttons: the four lists are mutually
 * exclusive (a game holds one status), which is exactly what a select means, and
 * it arrives with keyboard support, a screen-reader announcement of the current
 * value and a touch-friendly picker on mobile that a hand-rolled popover would
 * each have to reimplement.
 *
 * The current value comes from the shared store rather than a prop, so a game
 * moved on Game Detail shows its new list when the reader goes back to Search.
 */
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { inputStyles } from "@/components/ui/field";
import { BACKLOG_ORDER, listName, useAuth, useBacklog } from "@sidequestd/core";

import type { BacklogStatus, GameSummary } from "@sidequestd/api-types";

/** The option that takes a game off the backlog. Not a status, so not a uuid-ish
 * value either — anything a `BacklogStatus` could never be. */
const REMOVE = "__remove";

export function BacklogControl({
  game,
  className = "",
}: {
  game: Pick<GameSummary, "id" | "title">;
  className?: string;
}) {
  const { user } = useAuth();
  const { statuses, ensureLoaded, setStatus, clearStatus } = useBacklog();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asking on mount is what makes the store lazy: a screen with no control on it
  // never fetches a backlog.
  useEffect(() => {
    if (user) ensureLoaded();
  }, [user, ensureLoaded]);

  // Lists belong to an account. Signed out there is nothing to add to, and the
  // sign-in link in the nav is the way to get one.
  if (!user) return null;

  const current = statuses.get(game.id) ?? "";

  async function choose(value: string) {
    setPending(true);
    setError(null);
    try {
      if (value === REMOVE) await clearStatus(game.id);
      else await setStatus(game.id, value as BacklogStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`flex w-full flex-col items-start gap-1.5 ${className}`}>
      <label htmlFor={`backlog-${game.id}`} className="sr-only">
        {`Backlog list for ${game.title}`}
      </label>
      <select
        id={`backlog-${game.id}`}
        value={current}
        disabled={pending}
        onChange={(event) => void choose(event.target.value)}
        // `h-10` rather than vertical padding: this control sits beside a
        // `Button` on Game Detail and inside a card footer under `GameCard`, and
        // a select whose height is derived from its font lines up with neither.
        className={inputStyles({ className: "h-10 py-0" })}
      >
        {/* Disabled rather than selectable: "Add to list" is a prompt, not a
            fifth list, and choosing it again should not mean anything. Removing
            is the option below. */}
        <option value="" disabled>
          Add to list
        </option>
        {BACKLOG_ORDER.map((status) => (
          <option key={status} value={status}>
            {listName(status)}
          </option>
        ))}
        {current ? <option value={REMOVE}>Remove from lists</option> : null}
      </select>
      <Alert tone="error" inline>
        {error}
      </Alert>
    </div>
  );
}
