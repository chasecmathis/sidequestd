/**
 * The two quiet controls a faceted browse needs.
 *
 * `Chip` is one facet value, on or off. The web says its state with
 * `aria-pressed` and paints it with an accent border over `accent-wash`; native
 * says it with `accessibilityState.selected` and paints it identically. This is
 * within the palette rule — the accent is a *border and a wash*, never the
 * label — and it is the one place in the app where a wash appears, because a
 * border alone is not enough to pick four active chips out of forty.
 *
 * The `×` only appears on the selected ones, and that is deliberate rather than
 * decorative: with a group collapsed there is no neighbouring unselected chip to
 * compare against, so "press it again to remove it" has to be visible rather
 * than inferred.
 *
 * `TextButton` is the meta-action beside them — "Show all 24", "Clear genre".
 * Mono, no border, no ground. It is a control, but making it look like one would
 * put three buttons' worth of weight next to the chips that actually filter.
 */
import { X } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";

import { selectionTick } from "@/lib/haptics";
import { useStyles, useTokens, type Tokens } from "@/theme";

import { EyebrowText, Text } from "./text";

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      // The tick lives here rather than at the call site so a facet feels the
      // same wherever it is used, and so Discover cannot forget it.
      onPress={() => {
        selectionTick();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipOn : styles.chipOff,
        pressed && !selected && styles.chipPressed,
      ]}
    >
      <Text size={13} tone={selected ? "fg" : "dim"}>
        {label}
      </Text>
      {selected ? <X size={12} strokeWidth={2} color={tokens.color.fgDim} /> : null}
    </Pressable>
  );
}

export function TextButton({ children, onPress }: { children: string; onPress: () => void }) {
  const styles = useStyles(make);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={styles.textButton}>
      {({ pressed }) => <EyebrowText tone={pressed ? "fg" : "faint"}>{children}</EyebrowText>}
    </Pressable>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      // Fully round, which is what separates a facet from a `Badge` (barely
      // rounded, mono caps, not pressable) at a glance.
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipOn: { borderColor: t.color.accent, backgroundColor: t.color.accentWash },
    chipOff: { borderColor: t.color.line },
    chipPressed: { borderColor: t.color.lineStrong, backgroundColor: t.color.surface2 },

    textButton: { paddingHorizontal: 4, paddingVertical: 8 },
  });
