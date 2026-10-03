/**
 * A backlog status change, inline in Home (SPEC §6.4, §6.11).
 *
 * Deliberately a *line* and not a card. SPEC §6.11 says reviews are the hero
 * content and activity is "visually lighter-weight", and the difference has to
 * be legible at a glance or the feed reads as a wall of equally important
 * things. So: one row, small avatar, one sentence, a timestamp — and it never
 * grows a like button, because there is nothing here to like.
 *
 * With every review sitting on a bordered surface, the lighter weight is
 * expressed by having no surface at all: this is a ruled line on the canvas
 * itself, indented past the cards it sits between.
 *
 * The sentence is one `<Text>` with the two names nested inside it, rather than
 * three views in a row. Native will only wrap a line where it is one text run,
 * and "ripley started playing Outer Wilds" has to be able to break — which is
 * also why the names are weight and colour rather than pressables: a nested
 * `Pressable` inside running text gets the glyphs as its hit area, well under
 * the 44pt floor. The row as a whole opens the game, and the avatar beside it is
 * the target for the person.
 */
import { Pressable, StyleSheet, View } from "react-native";

import { activityVerb, profilePath, timeAgo } from "@sidequestd/core";
import type { FeedActivityItem } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { rounded, useStyles, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { Cover } from "./media";
import { EyebrowText, Text } from "./ui/text";

export function ActivityRow({ item }: { item: FeedActivityItem }) {
  const styles = useStyles(make);
  const name = item.actor.display_name ?? item.actor.username;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} ${activityVerb(item.status)} ${item.game.title}, ${timeAgo(item.occurred_at)}`}
      onPress={() => open(`/games/${item.game.id}`)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Pressable
        onPress={() => open(profilePath(item.actor.username))}
        accessibilityRole="button"
        accessibilityLabel={name}
        hitSlop={8}
      >
        <Avatar user={item.actor} size={24} />
      </Pressable>

      <Text size={14} tone="dim" style={styles.sentence}>
        <Text size={14} weight="medium">
          {name}
        </Text>{" "}
        {activityVerb(item.status)}{" "}
        <Text size={14} weight="medium">
          {item.game.title}
        </Text>
      </Text>

      {item.game.cover_url ? (
        <View style={styles.cover}>
          <Cover uri={item.game.cover_url} title={item.game.title} compact />
        </View>
      ) : null}

      <EyebrowText tone="faint">{timeAgo(item.occurred_at)}</EyebrowText>
    </Pressable>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.color.line,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    pressed: { backgroundColor: t.color.surface },

    sentence: { flex: 1, minWidth: 0 },

    // 32×43 on the web: the same 3:4 box, small enough to be a marker rather
    // than an illustration.
    cover: {
      width: 32,
      flexShrink: 0,
      overflow: "hidden",
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: t.color.line,
    },
  });
