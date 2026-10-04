/**
 * Finding a game to do something to.
 *
 * The web has two of these — one inline at the top of the compose screen, one
 * inside the favourites dialog — with different result limits and one extra
 * disabled state. Here they are one component. The searching itself is
 * `useSearch` everywhere, so the copies can differ in layout but no longer in
 * how they ask.
 *
 * A search rather than a browse, which is the web's reasoning and holds: the
 * catalog runs to tens of thousands of rows, and somebody pinning a favourite or
 * reviewing a game they just finished already knows its name.
 *
 * Rows for games that cannot be picked stay in the results and are dimmed rather
 * than filtered out. Hiding them would leave a reader hunting for a game they
 * would swear they own; pressing one is the 409 this component exists to avoid.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { releaseYearLabel, useSearch } from "@sidequestd/core";
import type { GameSummary } from "@sidequestd/api-types";

import { rounded, useStyles, type Tokens } from "@/theme";

import { Cover } from "./media";
import { SearchInput } from "./ui/field";
import { EyebrowText, Text } from "./ui/text";

/** A cover in a row: 3:4 at 36 wide, which is the smallest a box is recognisable at. */
const THUMB_WIDTH = 36;

export function GamePicker({
  onPick,
  limit,
  /** Games already spoken for — pinned, or the one being reviewed. */
  disabledIds,
  disabledNote = "Pinned",
  disabled = false,
  autoFocus = false,
  placeholder = "Search the catalog",
}: {
  onPick: (game: GameSummary) => void;
  limit?: number;
  disabledIds?: Set<string>;
  disabledNote?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const styles = useStyles(make);
  const [term, setTerm] = useState("");
  // Errors stay quiet: the field is still there and still the way forward, and
  // an error banner over a search box says nothing the empty result does not.
  const { items: results, searching } = useSearch("games", term, { limit });

  const typed = term.trim() !== "";

  return (
    <View style={styles.picker}>
      <SearchInput
        label="Search games"
        value={term}
        onChangeText={setTerm}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />

      {!typed ? null : results.length === 0 ? (
        <EyebrowText tone="faint" style={styles.status}>
          {searching ? "Searching…" : `Nothing in the catalog matches “${term.trim()}”.`}
        </EyebrowText>
      ) : (
        <View accessibilityRole="list" accessibilityLabel="Game results" style={styles.results}>
          {results.map((game) => {
            const taken = disabledIds?.has(game.id) ?? false;

            return (
              <Pressable
                key={game.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: taken || disabled }}
                accessibilityLabel={`${game.title}, ${releaseYearLabel(game.release_year)}`}
                disabled={taken || disabled}
                onPress={() => onPick(game)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                  (taken || disabled) && styles.rowDisabled,
                ]}
              >
                <View style={styles.thumb}>
                  <Cover uri={game.cover_url} title={game.title} compact />
                </View>

                <View style={styles.rowText}>
                  <Text variant="display" size={17} numberOfLines={2}>
                    {game.title}
                  </Text>
                  <EyebrowText tone="faint" style={styles.year}>
                    {releaseYearLabel(game.release_year)}
                  </EyebrowText>
                </View>

                {taken ? <EyebrowText tone="faint">{disabledNote}</EyebrowText> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    picker: { gap: 12 },
    status: { paddingVertical: 12 },

    results: { gap: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      padding: 10,
    },
    rowPressed: { borderColor: t.color.lineStrong, backgroundColor: t.color.surface2 },
    rowDisabled: { opacity: 0.55 },

    thumb: { width: THUMB_WIDTH, overflow: "hidden", ...rounded(t.radius.sm) },
    rowText: { flex: 1, minWidth: 0 },
    year: { marginTop: 4 },
  });
