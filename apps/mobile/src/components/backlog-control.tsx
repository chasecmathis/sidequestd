/**
 * "Add to list", wherever SPEC §6.9 says a game can be added from — Search
 * results, Game Detail, and a review.
 *
 * The web is a native `<select>`, and the reasoning it gives is sound: the four
 * lists are mutually exclusive (a game holds one status), which is exactly what
 * a select means, and it arrives with keyboard support, a screen-reader
 * announcement of the current value and a touch-friendly picker for free.
 *
 * React Native has no `<select>`. What it has is `Picker`, which was removed
 * from core, and the platform's own wheel and dialog, which are two different
 * controls that look nothing alike and neither of which can be told what a
 * Sidequestd list should look like. So this is the same *decision* — one value
 * at a time, chosen from a short exclusive set, on a surface big enough for a
 * thumb — spelled as the button-and-sheet that a phone already understands.
 *
 * The button says the answer rather than the question once there is one: "Add to
 * list" becomes "Playing", which is the state a `<select>` shows without being
 * asked and the one thing a reader scanning a grid of covers wants from this
 * control.
 *
 * The current value comes from the shared store rather than a prop, so a game
 * moved on Game Detail shows its new list when the reader goes back to Search.
 */
import { ListPlus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { BACKLOG_ORDER, listName, useAuth, useBacklog } from "@sidequestd/core";
import type { BacklogStatus, GameSummary } from "@sidequestd/api-types";

import { selectionTick } from "@/lib/haptics";
import { useStyles, type Tokens } from "@/theme";

import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Sheet, SheetOption } from "./ui/sheet";

/** What each list means, for the one place there is room to say it. */
const HINTS: Record<BacklogStatus, string> = {
  TO_BE_PLAYED: "Games you mean to get to.",
  PLAYING: "What you're in the middle of.",
  COMPLETED: "Finished, credits and all.",
  DROPPED: "Started, and set down.",
};

export function BacklogControl({
  game,
  size = "md",
  style,
}: {
  game: Pick<GameSummary, "id" | "title">;
  /** `sm` under a card in a grid, `md` beside a headline. */
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);
  const { user } = useAuth();
  const { statuses, ensureLoaded, setStatus, clearStatus } = useBacklog();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asking on mount is what makes the store lazy: a screen with no control on
  // it never fetches a backlog.
  useEffect(() => {
    if (user) ensureLoaded();
  }, [user, ensureLoaded]);

  // Lists belong to an account. Signed out there is nothing to add to, and the
  // gated screens are how a reader gets one.
  if (!user) return null;

  const current = statuses.get(game.id);

  async function choose(next: BacklogStatus | null) {
    selectionTick();
    setOpen(false);
    setPending(true);
    setError(null);
    try {
      if (next === null) await clearStatus(game.id);
      else await setStatus(game.id, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={[styles.column, style]}>
      <Button
        icon={ListPlus}
        size={size}
        disabled={pending}
        onPress={() => setOpen(true)}
        // The visible label is the *state*; the accessible name has to carry
        // both the state and what pressing it would do, because "Playing" alone
        // announces as a word rather than as a control.
        accessibilityLabel={
          current
            ? `${game.title} is on your ${listName(current)} list. Change list.`
            : `Add ${game.title} to a list`
        }
        style={styles.button}
      >
        {pending ? "Saving…" : current ? listName(current) : "Add to list"}
      </Button>

      <Alert tone="error" inline>
        {error}
      </Alert>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={game.title}
        description="A game sits on one list at a time."
      >
        {BACKLOG_ORDER.map((status) => (
          <SheetOption
            key={status}
            label={listName(status)}
            hint={HINTS[status]}
            selected={current === status}
            onPress={() => void choose(status)}
          />
        ))}

        {/* Only once there is something to remove — the web's `<option>` appears
            on the same condition, for the same reason. */}
        {current ? (
          <SheetOption label="Remove from lists" destructive onPress={() => void choose(null)} />
        ) : null}
      </Sheet>
    </View>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    column: { alignItems: "stretch", gap: 8 },
    // Stretched rather than hugging: this sits under a card in a two-up grid as
    // often as beside a headline, and a control the width of its own label
    // leaves a ragged edge down a column of covers.
    button: { alignSelf: "stretch" },
  });
