/**
 * System, light, dark — one control, cycling.
 *
 * The web has room for a three-item popover; a phone's app bar has room for one
 * 44pt square. Cycling is the honest way to fit three states into it, and the
 * icon always shows the state you are *in* rather than the one you would get,
 * because an icon that shows the next state is a control nobody can read.
 *
 * "System" is a real position in the cycle, not a settings-screen afterthought.
 * That is the whole reason `theme.tsx` keeps the reader's *choice* separate from
 * what is painted: a toggle that only stored the resolved value would silently
 * drop "follow my device" the first time it was pressed.
 */
import { Monitor, Moon, Sun } from "lucide-react-native";

import { useTheme, type ThemeChoice } from "@sidequestd/core";

import { selectionTick } from "@/lib/haptics";

import { IconButton } from "./ui/button";
import { Segmented, type SegmentOption } from "./ui/segmented";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

const LABELS: Record<ThemeChoice, string> = {
  system: "Theme: follow device. Switch to light.",
  light: "Theme: light. Switch to dark.",
  dark: "Theme: dark. Follow device instead.",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <IconButton
      icon={ICONS[theme]}
      label={LABELS[theme]}
      size="md"
      variant="ghost"
      // A cycle with no visible track: the tick is the only confirmation that
      // the press landed on the position you meant rather than past it.
      onPress={() => {
        selectionTick();
        setTheme(NEXT[theme]);
      }}
    />
  );
}

const CHOICES: SegmentOption<ThemeChoice>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The same three states, laid out flat — the web's `ThemeSegments`, for the one
 * screen with room for all of them at once.
 *
 * The app bar's cycle is a compromise the settings screen does not have to make:
 * here every position is visible, which is what lets "System" read as a choice
 * rather than as the absence of one. `Segmented` already carries the tick and
 * the `tab` semantics, so this is only the list.
 */
export function ThemeSegments() {
  const { theme, setTheme } = useTheme();
  return <Segmented label="Theme" options={CHOICES} value={theme} onChange={setTheme} />;
}
