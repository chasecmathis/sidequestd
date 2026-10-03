/**
 * Where a colour preference lives on a phone, and how the device announces its
 * own — the `ThemeStorage` seam from `@sidequestd/core`.
 *
 * The web's adapter is `localStorage` + `matchMedia`; this is `AsyncStorage` +
 * `Appearance`. Everything *interesting* about the theme — the `theme` versus
 * `resolved` split, when to follow the device, when to stop — is in the shared
 * provider and is not repeated here.
 *
 * `AsyncStorage` rather than `expo-secure-store`, deliberately, and it is the
 * mirror of the note in `auth.tsx`: the refresh token goes in the Keychain
 * because it is a credential. A colour preference is neither secret nor
 * account-scoped, it belongs to the device rather than to the login, and putting
 * it behind the Keychain would mean a biometric-gated store answering a question
 * about what colour to paint.
 *
 * ---
 *
 * **The priming dance.** `ThemeStorage.readStored` is synchronous, because the
 * web's storage is and making it async would cost that platform a paint in the
 * wrong mode. Native storage is not synchronous, so the value is read once
 * before the provider mounts and kept in the module below. `primeThemeChoice`
 * is what the root layout awaits while the splash screen is still up; the
 * provider then reads it synchronously like the web does, and the first painted
 * frame is already the right mode.
 *
 * Without the await the app renders dark, then flips to light one tick later for
 * every reader who chose light — the native version of the flash that
 * `theme.tsx`'s hydration handling exists to prevent.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";

import {
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeChoice,
  type ThemeStorage,
} from "@sidequestd/core";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** Last known preference. "system" until `primeThemeChoice` says otherwise. */
let cached: ThemeChoice = "system";

/**
 * Read the stored preference into the cache. Resolves even when storage fails —
 * a device that cannot read its own preferences still gets a themed app, it just
 * gets the default one.
 */
export async function primeThemeChoice(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeChoice(stored)) cached = stored;
  } catch {
    // Keep "system".
  }
}

export const nativeThemeStorage: ThemeStorage = {
  readStored: () => cached,

  writeStored: (choice) => {
    // The cache is updated first and synchronously: it is what a remount reads,
    // and it must be correct even if the write below never lands.
    cached = choice;
    void AsyncStorage.setItem(THEME_STORAGE_KEY, choice).catch(() => {
      // Storage full, or a corrupted store. The choice still applies for this
      // session; only its durability is lost, and there is nothing useful to
      // tell the reader about that.
    });
  },

  /**
   * `Appearance` only reports the device's real setting when the app has not
   * pinned one — `userInterfaceStyle` in `app.json` is `"automatic"` for exactly
   * this reason. Pinned to `"dark"`, this returns "dark" on a light phone and
   * the "System" option becomes a lie that is very hard to see.
   *
   * A null scheme (the OS declining to say) falls back to dark, which is the
   * brand's own mode and what `theme.tsx` defaults to.
   */
  getSystemTheme: (): ResolvedTheme => (Appearance.getColorScheme() === "light" ? "light" : "dark"),

  subscribeToSystem: (onChange) => {
    const subscription = Appearance.addChangeListener(onChange);
    return () => subscription.remove();
  },
};
