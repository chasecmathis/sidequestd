/**
 * One line of the inbox — SPEC §6.12.
 *
 * The web draws four separate targets on this row: the avatar and the name both
 * go to the person, the sentence goes to the thing that happened, and a "Mark
 * read" button sits at the end. That is four things to hit inside 56 points of
 * height, and three of them are inside a paragraph — which is a cursor's
 * arrangement, not a thumb's.
 *
 * So the row is **one target plus one control**. Pressing it goes wherever the
 * notification points *and* marks that row read; the check button beside it
 * marks it read without going anywhere. The avatar and the name lose their own
 * link, and lose nothing with it: every destination they had is one press away
 * from where the row lands.
 *
 * **Pressing a row marks it read, and opening the tab still does not.** The web
 * page's comment is about the second half of that and it survives intact — a
 * glance at the badge must not empty the list. But a row the reader actually
 * opened *has* been read, and every native inbox agrees; the principle was
 * always "the badge only moves when the reader moved it", and this is the
 * reader moving it.
 *
 * The timestamp joins the sentence rather than sitting in its own column. At
 * 390pt a right-aligned time steals width from the only thing on the row with
 * something to say, and "· 2h" at the end of the clause is how a phone has
 * written this since about 2012.
 */
import { Check } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { notificationHref, notificationText, timeAgo } from "@sidequestd/core";
import type { NotificationItem } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { Text } from "./ui/text";

export function NotificationRow({
  item,
  onMarkRead,
  last = false,
}: {
  item: NotificationItem;
  onMarkRead: (id: string) => void;
  /** Drops the rule under the last row. Native has no `last:` selector. */
  last?: boolean;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();

  const name = item.actor?.display_name ?? item.actor?.username ?? "Someone";
  const sentence = notificationText(item);
  const href = notificationHref(item);
  const unread = !item.is_read;

  return (
    <View style={[styles.row, unread && styles.unread, !last && styles.ruled]}>
      {/* The accent as a border and never as body text, which is the palette's
          standing rule — and the same gesture the tab bar's indicator makes.
          Absolutely positioned so it runs the full height of a row whose height
          is set by however many lines the sentence took. */}
      {unread ? <View style={styles.mark} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} ${sentence}`}
        accessibilityHint={href ? "Opens it, and marks this read" : undefined}
        onPress={() => {
          if (unread) onMarkRead(item.id);
          if (href) open(href);
        }}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        {item.actor ? <Avatar user={item.actor} size={44} /> : null}

        <View style={styles.text}>
          {/* One `<Text>` with nested spans, not a row of them: the sentence has
              to wrap as a sentence, and two sibling views would break it into
              two blocks with the name on a line of its own. */}
          <Text size={14} tone="dim" relaxed>
            <Text size={14} weight="medium">
              {name}
            </Text>{" "}
            {sentence}{" "}
            <Text size={13} tone="faint">
              · {timeAgo(item.created_at)}
            </Text>
          </Text>

          {item.comment ? (
            <Text size={13} tone="faint" numberOfLines={2} style={styles.quote}>
              “{item.comment.text}”
            </Text>
          ) : null}
        </View>
      </Pressable>

      {unread ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark as read: ${name} ${sentence}`}
          onPress={() => onMarkRead(item.id)}
          style={({ pressed }) => [styles.check, pressed && styles.checkPressed]}
        >
          <Check size={18} strokeWidth={1.75} color={tokens.color.fgFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", paddingRight: 8 },
    ruled: { borderBottomWidth: 1, borderBottomColor: t.color.line },

    // The whole row, not a dot in one corner: unread is the state of the
    // notification rather than a decoration attached to it.
    unread: { backgroundColor: t.color.surface },
    mark: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 2,
      backgroundColor: t.color.accent,
    },

    // The padding is on the press target rather than the row, so the tap area is
    // the full height instead of an inset rectangle inside it.
    body: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingLeft: 16,
      paddingVertical: 14,
    },
    pressed: { opacity: 0.6 },

    text: { flex: 1, minWidth: 0 },
    // Indented behind a hairline, as a quotation is on the web. The border is
    // the left edge rather than a glyph, so a two-line quote stays one block.
    quote: {
      marginTop: 6,
      paddingLeft: 10,
      borderLeftWidth: 1,
      borderLeftColor: t.color.line,
      fontStyle: "italic",
    },

    check: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      ...rounded(t.radius.sm),
    },
    checkPressed: { backgroundColor: t.color.surface2 },
  });
