/**
 * A linked platform on a profile.
 *
 * The counterpart to `FavoriteGames`, and deliberately its opposite in what it
 * claims: favourites are curated — six slots, ranked, chosen — and this is
 * measured. Nobody arranged it. So it gets no numerals, no edit controls and no
 * empty slots; the hours are the ordering and the hours are the point.
 *
 * That difference is why the playtime is set in the display serif here rather
 * than as another mono chip. On this block the number *is* the content, the same
 * way a `Stat` tile's figure is, and setting it as metadata would bury the one
 * thing the section exists to say. 17pt is the serif's floor and this is a tile
 * caption, so it sits exactly on it.
 *
 * Renders nothing at all when there is no visible link — a profile should not
 * grow an empty heading because somebody once considered connecting Steam.
 */
import { StyleSheet, View } from "react-native";

import {
  formatGameCount,
  formatLibraryPlaytime,
  formatTotalPlaytime,
  providerLabel,
} from "@sidequestd/core";
import type { PlatformShowcase as Showcase } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { useStyles, type Tokens } from "@/theme";

import { CoverTile, GameShelf } from "./game-shelf";
import { Eyebrow } from "./ui/eyebrow";
import { MetaRule } from "./ui/rule";
import { EyebrowText, Text } from "./ui/text";

export function PlatformShowcase({ showcases }: { showcases: Showcase[] }) {
  const styles = useStyles(make);

  // Guarded rather than trusted. This is one auxiliary block on a screen whose
  // stated rule is that a failed side-request beats replacing the whole profile
  // with an error — and a showcase that throws would do exactly that, taking the
  // header, the reviews and the backlog down with it.
  const visible = Array.isArray(showcases)
    ? showcases.filter((showcase) => showcase.most_played?.length > 0)
    : [];
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((showcase) => {
        const platform = providerLabel(showcase.provider);

        return (
          <View key={showcase.provider} style={styles.section}>
            <Eyebrow heading>Most played on {platform}</Eyebrow>

            {/* The library totals, set as one mono line so they read as a
                caption to the heading rather than as a second heading. */}
            <View style={styles.totals}>
              <EyebrowText tone="faint" style={styles.tabular}>
                {formatGameCount(showcase.total_games)}
              </EyebrowText>
              <MetaRule />
              <EyebrowText tone="faint" style={styles.tabular}>
                {formatTotalPlaytime(showcase.total_playtime_minutes)}
              </EyebrowText>
            </View>

            <GameShelf label={`Most played on ${platform}`}>
              {showcase.most_played.map((entry) => (
                <CoverTile
                  key={entry.game.id}
                  title={entry.game.title}
                  coverUrl={entry.game.cover_url}
                  onPress={() => open(`/games/${entry.game.id}`)}
                  caption={
                    <>
                      <Text variant="display" size={17} style={styles.tabular}>
                        {formatLibraryPlaytime(entry.playtime_minutes)}
                      </Text>
                      <Text size={12} tone="dim" numberOfLines={2}>
                        {entry.game.title}
                      </Text>
                    </>
                  }
                />
              ))}
            </GameShelf>
          </View>
        );
      })}
    </>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    section: { gap: 14 },
    totals: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: -4 },
    tabular: { fontVariant: ["tabular-nums"] },
  });
