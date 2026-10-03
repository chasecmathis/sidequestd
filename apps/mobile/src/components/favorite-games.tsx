/**
 * Pinned games — SPEC §6.2's "short pinned/curated list", now editable.
 *
 * **Order is the point.** These are ranked, not collected, so each slot wears
 * its numeral — `slotLabel` gives the same `01`–`06` the web uses, and the mono
 * numeral is the whole reason a row of six covers reads as a ranking rather than
 * as a shelf. It is also what makes a sideways shelf legible here: the reader
 * can see they are at 03 of 06 without the row having to show all six at once.
 *
 * **Six slots, always six — in edit mode.** `MAX_FAVORITE_GAMES` is 6 and the
 * cap is the design rather than an error to discover: while editing, all six
 * appear, filled or not, so "full" is something you can see before you press
 * anything. At rest only the filled ones show, because a reader looking at
 * somebody else's profile has no use for three dashed rectangles.
 *
 * **The reorder controls are arrows, and on a phone that is not a fallback.**
 * The web chose them over drag so there would be a keyboard path; here the
 * argument is stronger, because the row this sits in is a horizontal
 * `ScrollView` and a long-press-drag inside one fights the scroll it lives in.
 * Two buttons per tile work with a thumb, with VoiceOver, and while the shelf is
 * mid-scroll. They point left and right rather than up and down, which is the
 * direction this list actually runs in.
 *
 * Every mutation returns the entire list, so nothing here has to derive the
 * resulting order — the moves are optimistic for feel and then overwritten by
 * what the server says the list actually is.
 */
import { ChevronLeft, ChevronRight, Pin, Plus, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { MAX_FAVORITE_GAMES, moveFavorite, slotLabel, useAuth } from "@sidequestd/core";
import type { FavoriteGameEntry, GameSummary } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { GamePicker } from "./game-picker";
import { CoverTile, GameShelf } from "./game-shelf";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { Eyebrow } from "./ui/eyebrow";
import { Sheet } from "./ui/sheet";
import { EyebrowText, Text } from "./ui/text";

/** The tile width `GameShelf` lays out, so an empty slot is the same size as a full one. */
const SLOT_WIDTH = 104;

export function FavoriteGames({
  entries,
  isViewer = false,
}: {
  entries: FavoriteGameEntry[];
  /**
   * Whether the profile being read is the reader's own — the only person who
   * gets the controls. The web also takes a `username`, for an empty state
   * saying "@ripley hasn't pinned any games yet"; there is none here, because
   * an empty section on somebody else's profile is not drawn at all.
   */
  isViewer?: boolean;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();
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
   * The snapshot to restore comes off a ref rather than the closure, which is a
   * bug the web hit and documented: reading `games` directly made this callback's
   * identity depend on the list, and a handler even one render stale would
   * restore a *previous* list on failure — pinning a game and then hitting a 409
   * emptied a grid that had a game in it. The ref is whatever is on screen at
   * the moment of the call, which is the only thing "put it back" can honestly
   * mean.
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
      // Straight into edit mode: pinning from the empty state should leave the
      // reader looking at the controls for what they just made.
      setEditing(true);
      void mutate(() =>
        // `authedRequest` serialises `body` itself and sets the Content-Type
        // (see core's `api.ts`), so this is the object, not a JSON string.
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
        () => authedRequest<FavoriteGameEntry[]>(`/users/me/favorites/${game.id}`, { method: "DELETE" }),
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

  // Nothing pinned and nobody who can pin anything: the section simply is not
  // there, which is what a reader on somebody else's quiet profile should see.
  if (games.length === 0 && !isViewer) return null;

  const pinnedIds = new Set(games.map((game) => game.id));
  const full = games.length >= MAX_FAVORITE_GAMES;
  // Only the viewer, and only while editing, sees the empty tail.
  const slots = editing ? MAX_FAVORITE_GAMES : games.length;

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Eyebrow heading rule style={styles.headingRule}>
          Favorite games
        </Eyebrow>

        {isViewer && games.length > 0 ? (
          <Button size="sm" variant="ghost" onPress={() => setEditing((value) => !value)}>
            {editing ? "Done" : "Edit"}
          </Button>
        ) : null}
      </View>

      {games.length === 0 ? (
        <EmptyState
          icon={Pin}
          description="Nothing pinned yet. Pick up to six games to sit at the top of your profile."
          action={
            <Button variant="primary" size="sm" icon={Plus} onPress={() => setPickerOpen(true)}>
              Pin a game
            </Button>
          }
        />
      ) : (
        <GameShelf label="Favorite games">
          {Array.from({ length: slots }, (_, index) => {
            const game = games[index];

            if (!game) {
              return (
                <Pressable
                  key={`empty-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Pin a game to slot ${slotLabel(index)}`}
                  disabled={pending}
                  onPress={() => setPickerOpen(true)}
                  style={({ pressed }) => [
                    styles.empty,
                    pressed && styles.emptyPressed,
                    pending && styles.dim,
                  ]}
                >
                  <Plus size={20} strokeWidth={1.5} color={tokens.color.fgFaint} />
                  <EyebrowText tone="faint">{slotLabel(index)}</EyebrowText>
                </Pressable>
              );
            }

            return (
              <View key={game.id}>
                <CoverTile
                  title={game.title}
                  coverUrl={game.cover_url}
                  onPress={() => open(`/games/${game.id}`)}
                  caption={
                    <>
                      <EyebrowText tone="faint">{slotLabel(index)}</EyebrowText>
                      <Text size={12} tone="dim" numberOfLines={2}>
                        {game.title}
                      </Text>
                    </>
                  }
                />

                {editing ? (
                  <View style={styles.controls}>
                    <SlotButton
                      label={`Move ${game.title} earlier`}
                      disabled={pending || index === 0}
                      onPress={() => move(index, index - 1)}
                    >
                      <ChevronLeft size={16} strokeWidth={2} color={tokens.color.fgDim} />
                    </SlotButton>

                    <SlotButton
                      label={`Move ${game.title} later`}
                      disabled={pending || index === games.length - 1}
                      onPress={() => move(index, index + 1)}
                    >
                      <ChevronRight size={16} strokeWidth={2} color={tokens.color.fgDim} />
                    </SlotButton>

                    <SlotButton
                      label={`Unpin ${game.title}`}
                      disabled={pending}
                      onPress={() => unpin(game)}
                    >
                      <X size={16} strokeWidth={2} color={tokens.color.fgDim} />
                    </SlotButton>
                  </View>
                ) : null}
              </View>
            );
          })}
        </GameShelf>
      )}

      {editing && full ? (
        <EyebrowText tone="faint">
          All {MAX_FAVORITE_GAMES} slots are full — unpin one to make room.
        </EyebrowText>
      ) : null}

      <Alert>{error}</Alert>

      {isViewer ? (
        <Sheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="Pin a game"
          description={`Search the catalog. You can pin ${MAX_FAVORITE_GAMES} in total.`}
        >
          {/* The sheet's own scroll, rather than one inside `GamePicker`: the
              picker is also used inline on a screen that already scrolls, and a
              component that brings its own `ScrollView` cannot be. */}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            <GamePicker
              onPick={pin}
              autoFocus
              disabledIds={pinnedIds}
              disabledNote="Pinned"
              disabled={pending || full}
              placeholder="Hollow Knight"
            />
            {full ? (
              <EyebrowText tone="faint">
                All {MAX_FAVORITE_GAMES} slots are full — unpin one to make room.
              </EyebrowText>
            ) : null}
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

/** One of the three controls under an editable tile. Square, so three fit the width. */
function SlotButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const styles = useStyles(make);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.slotButton,
        pressed && styles.slotButtonPressed,
        disabled && styles.dim,
      ]}
    >
      {children}
    </Pressable>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 14 },
    heading: { flexDirection: "row", alignItems: "center", gap: 12 },
    headingRule: { flex: 1 },

    empty: {
      width: SLOT_WIDTH,
      // The tile plus its caption, so an empty slot does not shorten the shelf.
      aspectRatio: 3 / 4,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: t.color.line,
    },
    emptyPressed: { borderColor: t.color.lineStrong, backgroundColor: t.color.surface2 },
    dim: { opacity: 0.45 },

    // Under the tile rather than over it: a control on top of a 104pt cover
    // covers the artwork it is about, and there are three of them.
    controls: { flexDirection: "row", justifyContent: "space-between", gap: 4, marginTop: 8 },
    slotButton: {
      flex: 1,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: t.color.line,
    },
    slotButtonPressed: { borderColor: t.color.lineStrong, backgroundColor: t.color.surface2 },

    sheetBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 12 },
  });
