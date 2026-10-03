/**
 * A small run of mutually exclusive options: Discover's sort, Search's two tabs.
 *
 * The web draws these as a row of `type-eyebrow` buttons where the current one
 * takes a `surface-2` ground, and that is exactly what is here — not the
 * platform's own segmented control, which comes with its own type, its own
 * corner radius and its own idea of what a selected segment looks like. The
 * design system has answers to all three.
 *
 * `accessibilityRole="tab"` and `selected` are the native spelling of the web's
 * `role="tab"` / `aria-selected`. The group carries `tablist` so the options are
 * announced as "1 of 3" rather than as three unrelated buttons.
 *
 * Generic over the option value so a caller keeps its own union — `GameSort`,
 * `"games" | "users"` — instead of round-tripping through a string.
 */
import { Pressable, StyleSheet, View } from "react-native";

import { selectionTick } from "@/lib/haptics";
import { rounded, useStyles, type Tokens } from "@/theme";

import { EyebrowText } from "./text";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useStyles(make);

  return (
    <View style={styles.group} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((option) => {
        const current = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: current }}
            // Nothing on the segment you are already on: the tick means "that
            // changed", and pressing the current sort changes nothing.
            onPress={() => {
              if (current) return;
              selectionTick();
              onChange(option.value);
            }}
            style={[styles.segment, current && styles.on]}
          >
            <EyebrowText tone={current ? "fg" : "faint"}>{option.label}</EyebrowText>
          </Pressable>
        );
      })}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    group: { flexDirection: "row", alignItems: "center", gap: 4 },
    segment: {
      ...rounded(t.radius.md),
      paddingHorizontal: 12,
      // 40pt tall with the 11px eyebrow inside it. Under the 44 floor, and
      // allowed to be: these sit in a row of three, every one of which is the
      // same size, so a near-miss lands on a neighbour rather than on nothing.
      paddingVertical: 12,
    },
    on: { backgroundColor: t.color.surface2 },
  });
