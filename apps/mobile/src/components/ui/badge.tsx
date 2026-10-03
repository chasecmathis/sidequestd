/**
 * A small standing label: "Private", "Recommended", a media count, an unread
 * total.
 *
 * Mono caps rather than sentence-case sans, so a badge is never mistaken for a
 * button — it says something *about* the thing it sits on, and there is nothing
 * to press. On a touch screen that distinction has to be carried by the type
 * alone, since there is no cursor to change shape.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { rounded, useStyles, type Tokens } from "@/theme";

import { EyebrowText, type Tone as TextTone } from "./text";

type Tone = "neutral" | "accent" | "outline" | "overlay";

const INK: Record<Tone, TextTone> = {
  neutral: "dim",
  accent: "ink",
  outline: "dim",
  overlay: "onScrim",
};

export function Badge({
  tone = "neutral",
  children,
  style,
}: {
  tone?: Tone;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  return (
    <View style={[styles.badge, styles[tone], style]}>
      <EyebrowText tone={INK[tone]}>{children}</EyebrowText>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    badge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      flexShrink: 0,
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: "transparent",
      paddingHorizontal: 6,
      paddingVertical: 4,
    },

    neutral: { backgroundColor: t.color.surface2 },

    // The one place a badge earns the accent: a count the reader is meant to act
    // on, filled rather than lettered, per the palette rule.
    accent: { backgroundColor: t.color.accent },

    outline: { borderColor: t.color.line },

    /**
     * For sitting on top of artwork, where the surface behind is unknown.
     *
     * The one tone that does not change with the theme, and the scrim tokens are
     * how that is said out loud. What is behind this badge is a screenshot, not
     * one of our surfaces — it does not get lighter when the page does, so
     * neither can the chip on top of it.
     *
     * The web adds `backdrop-blur-sm`. Native's equivalent needs a whole view
     * type (`expo-blur`) behind every badge, and at this size against a 72%
     * scrim the blur was doing nothing legible, so it is dropped rather than
     * approximated.
     */
    overlay: { backgroundColor: t.color.scrim },
  });
