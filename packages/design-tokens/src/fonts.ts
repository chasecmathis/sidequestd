/**
 * Three faces, and how each platform names them.
 *
 * The *roles* are the shared part — display for headlines, sans for everything
 * else, mono for anything that is data. The bindings differ because the
 * loaders do: the web self-hosts through `next/font`, which hands back a CSS
 * variable per family, while native loads static files through `expo-font`,
 * which has no notion of a family with several weights in it.
 *
 * That last difference is the one that bites. A browser picks the 500 weight of
 * a variable font from `font-weight: 500`; React Native does not synthesise
 * weights for custom fonts at all, and on Android asking for a weight the
 * family does not have silently falls back to the system face. So every weight
 * the app uses has to be loaded and named individually below, and native styles
 * select a *family*, never a `fontWeight`.
 *
 * The app uses 400 and 500 throughout, plus one 600. Anything outside this list
 * will not render as intended on Android.
 */

/**
 * The web's family stacks.
 *
 * The `--font-*` variables these point at are set by `next/font` in the root
 * layout; the rest of each stack is the fallback if a face fails to load.
 */
export const webStacks = {
  display: "var(--font-instrument-serif), ui-serif, Georgia, serif",
  sans: "var(--font-figtree), ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-jetbrains-mono), ui-monospace, monospace",
} as const;

/**
 * The native family names, as `@expo-google-fonts/*` exports them.
 *
 * The keys are what a style should ask for; the values are what `expo-font`
 * registers. Keeping the mapping here rather than inline at each call site is
 * what makes "the sans face at medium" one lookup instead of a string every
 * component spells slightly differently.
 */
export const nativeFamilies = {
  display: "InstrumentSerif_400Regular",
  displayItalic: "InstrumentSerif_400Regular_Italic",

  sans: "Figtree_400Regular",
  sansMedium: "Figtree_500Medium",
  sansSemibold: "Figtree_600SemiBold",

  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

export type NativeFamily = keyof typeof nativeFamilies;
