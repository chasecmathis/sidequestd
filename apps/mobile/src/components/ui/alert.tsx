/**
 * Something went wrong, or something worked.
 *
 * The tone picks the announcement as well as the colour — an error interrupts,
 * a confirmation does not — so getting the colour right and getting the
 * announcement right stay one decision, exactly as on the web.
 *
 * The web says this with `role="alert"` / `role="status"`. Native needs both
 * halves of a two-platform spelling: `accessibilityRole` is what iOS reads, and
 * `accessibilityLiveRegion` is what makes TalkBack speak a message that appears
 * without the focus moving to it. Setting only the first is the common miss, and
 * it fails silently on the platform where forms go wrong most.
 *
 * `inline` is for the several places where the message belongs under a single
 * control rather than above a form: same colour, same announcement, no box.
 */
import { AlertCircle, CheckCircle2 } from "lucide-react-native";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { Text } from "./text";

type Tone = "error" | "success";

export function Alert({
  tone = "error",
  inline = false,
  children,
  style,
}: {
  tone?: Tone;
  inline?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();

  // Callers pass a possibly-null message straight through, so an empty alert
  // renders nothing rather than an empty coloured box.
  if (children === null || children === undefined || children === false) return null;

  const live = tone === "error" ? "assertive" : "polite";

  if (inline) {
    return (
      <Text
        size={12}
        tone={tone === "error" ? "danger" : "success"}
        accessibilityRole="alert"
        accessibilityLiveRegion={live}
        style={style}
      >
        {children}
      </Text>
    );
  }

  const Icon = tone === "error" ? AlertCircle : CheckCircle2;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion={live}
      style={[styles.box, styles[tone], style]}
    >
      <Icon
        size={16}
        strokeWidth={1.75}
        color={tone === "error" ? tokens.color.danger : tokens.color.success}
        style={styles.icon}
      />
      {/* An error is the one string a reader has a reason to lift off the
          screen — into a bug report, a search, a message to us — and on a phone
          long-press-to-select is the only way to. The web gave it away for
          free; native withholds it until asked. */}
      <Text
        size={14}
        tone={tone === "error" ? "danger" : "success"}
        relaxed
        selectable
        style={styles.message}
      >
        {children}
      </Text>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    box: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      ...rounded(t.radius.md),
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    // The web tints the ground with `bg-danger/10`. There is no alpha token for
    // that, and a tint is the least of what carries this — the border, the icon
    // and the letters are all already the semantic colour — so the box takes the
    // surface it sits on and the edge does the work.
    error: { borderColor: t.color.danger, backgroundColor: t.color.surface },
    success: { borderColor: t.color.success, backgroundColor: t.color.surface },

    icon: { marginTop: 1 },
    message: { flex: 1 },
  });
