/**
 * Profile picture, with a lettered fallback when there isn't one.
 *
 * The initial is set in the display serif rather than the UI sans, which is the
 * web's call and worth keeping: at avatar sizes a single letter is a piece of
 * lettering, not a label, and the serif is the only face here with enough
 * character to carry one. `size / 2.2` is the same ratio, so the two clients
 * letter an avatar identically at every size they both draw.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { avatarInitial } from "@sidequestd/core";
import type { UserPublic } from "@sidequestd/api-types";

import { useStyles, type Tokens } from "@/theme";

import { RemoteImage } from "./media";
import { Text } from "./ui/text";

type Subject = Pick<UserPublic, "username" | "display_name" | "avatar_url">;

export function Avatar({
  user,
  size = 96,
  style,
}: {
  user: Subject;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);
  const name = user.display_name ?? user.username;
  const round = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.frame, round, style]}>
      {user.avatar_url ? (
        <RemoteImage
          uri={user.avatar_url}
          label={`${name}'s profile picture`}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        // Hidden rather than announced: the row this sits in already names the
        // person, and "R" is not a second useful thing to hear.
        <Text
          variant="display"
          size={Math.round(size / 2.2)}
          tone="faint"
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {avatarInitial(user)}
        </Text>
      )}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    frame: {
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
    },
  });
