/**
 * One person, in a list of people.
 *
 * Search results, followers and following all draw the same object — avatar,
 * handle, display name, something on the right — and were on their way to three
 * slightly different versions of it on the web. This is the one, ported.
 *
 * The press target is the identity block and *not* the whole row, which is the
 * part worth keeping across the platform boundary even though the reason
 * changes. On the web a row that is entirely an anchor cannot also hold an
 * Unfollow button; here a nested `Pressable` would work fine, but a row whose
 * every pixel navigates is a row where the action beside it is a mis-tap
 * waiting to happen. So the row is a container, the identity is the target, and
 * the action sits beside it as a sibling.
 */
import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { profilePath } from "@sidequestd/core";
import type { UserPublic } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { rounded, useStyles, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { Text } from "./ui/text";

type Subject = Pick<UserPublic, "username" | "display_name" | "avatar_url">;

export function UserRow({
  user,
  meta,
  action,
  last = false,
}: {
  user: Subject;
  /** Right-aligned detail — a review count, a "Private account" pill. */
  meta?: ReactNode;
  /** A control acting on this person. Rendered outside the press target. */
  action?: ReactNode;
  /**
   * Drops the rule under the last row.
   *
   * The web says this with `last:border-b-0`. Native has no sibling selectors,
   * so the list has to tell each row where it is — which is why `UserList` takes
   * the rows as data rather than as children.
   */
  last?: boolean;
}) {
  const styles = useStyles(make);

  return (
    <View style={[styles.row, !last && styles.ruled]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`@${user.username}`}
        onPress={() => open(profilePath(user.username))}
        style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
      >
        <Avatar user={user} size={44} />

        <View style={styles.names}>
          <Text size={14} weight="medium" numberOfLines={1}>
            @{user.username}
          </Text>
          {user.display_name ? (
            <Text size={14} tone="dim" numberOfLines={1} style={styles.displayName}>
              {user.display_name}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {meta ? <View style={styles.meta}>{meta}</View> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/**
 * The container the rows sit in.
 *
 * Hairline-ruled rather than a stack of cards: a list of forty people reads as a
 * directory, and forty separate bordered blocks is forty things to look at
 * instead of one.
 */
export function UserList({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles(make);

  return (
    <View style={styles.list} accessibilityRole="list" accessibilityLabel={label}>
      {children}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    list: {
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },

    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 16 },
    ruled: { borderBottomWidth: 1, borderBottomColor: t.color.line },

    // The padding is on the press target rather than on the row, so the tap area
    // covers the whole height of the row instead of an inset rectangle in it.
    identity: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingLeft: 16,
      paddingVertical: 14,
    },
    pressed: { backgroundColor: t.color.surface2 },

    names: { flex: 1, minWidth: 0 },
    displayName: { marginTop: 3 },

    meta: { flexShrink: 0, alignItems: "flex-end" },
    action: { flexShrink: 0 },
  });
