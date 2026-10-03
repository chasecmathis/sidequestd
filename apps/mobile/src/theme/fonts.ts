/**
 * The three faces, loaded.
 *
 * Every weight the app uses is registered as its own family, because React
 * Native does not synthesise weights for a custom face — asking Android for a
 * 500 the family does not contain silently gives back the system font, which is
 * the kind of bug that only shows up on someone else's phone. The full argument
 * is in `fonts.ts` in the tokens package; the list below is that decision made
 * concrete, and it is why there are seven entries rather than three.
 *
 * The keys are read out of `nativeFamilies` rather than typed out, so the string
 * a style asks for and the string registered here cannot drift.
 *
 * Each face is imported from its own subpath rather than from the package root.
 * The root re-exports every weight the family ships, and Metro bundles an asset
 * it can see referenced — importing `@expo-google-fonts/figtree` for three
 * weights put all fourteen into the app, along with everything JetBrains Mono
 * has. Deep imports take the seven faces that are actually used and nothing
 * else, which is around 3 MB of download.
 */
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif/400Regular";
import { InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif/400Regular_Italic";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono/400Regular";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { useFonts } from "expo-font";

import { nativeFamilies } from "@sidequestd/design-tokens";

const FACES = {
  [nativeFamilies.display]: InstrumentSerif_400Regular,
  [nativeFamilies.displayItalic]: InstrumentSerif_400Regular_Italic,

  [nativeFamilies.sans]: Figtree_400Regular,
  [nativeFamilies.sansMedium]: Figtree_500Medium,
  [nativeFamilies.sansSemibold]: Figtree_600SemiBold,

  [nativeFamilies.mono]: JetBrainsMono_400Regular,
  [nativeFamilies.monoMedium]: JetBrainsMono_500Medium,
};

/**
 * `[loaded, error]`, straight from `expo-font`.
 *
 * The root layout holds the splash screen up until this is settled — *either*
 * settled: a font that fails to load is a reason to show the app in the fallback
 * face, not a reason to show a splash screen forever. Editorial Noir leans hard
 * on its type, so the difference is visible, but a silently unstyled app still
 * beats one that never starts.
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts(FACES);
}
