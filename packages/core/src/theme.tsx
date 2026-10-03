"use client";

/**
 * Which of the two palettes is on screen.
 *
 * There are two pieces of state here and conflating them is the usual bug:
 *
 *   `theme`    — what the reader *chose*: "system", "light" or "dark". This is
 *                what the toggle checks, and what gets persisted.
 *   `resolved` — what is actually painted: "light" or "dark", never "system".
 *                This is what an icon should reflect.
 *
 * A control that stores only the resolved value silently forgets that the
 * reader asked to follow their device, and stops tracking it the first time
 * they change it. Keeping both is what makes "System" a real, sticky choice
 * rather than a one-shot button.
 *
 * The resolved value is written to `data-theme` on `<html>`, which is the sole
 * input to the mode blocks in globals.css. Deliberately no
 * `@media (prefers-color-scheme)` rule exists over there: if CSS could also
 * decide the mode, CSS and this file would be two sources of truth that
 * disagree the moment someone picks the non-system option, and the page would
 * contradict its own toggle.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { DARK_QUERY, THEME_STORAGE_KEY } from "./theme-keys";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/**
 * Re-exported so a consumer has one place to import from, but *defined* in
 * `theme-keys.ts` — which has no `"use client"` on it, and has to stay that way.
 * The root layout is a server component and needs these values, not client
 * references to them. See that file for what goes wrong otherwise.
 */
export { DARK_QUERY, THEME_STORAGE_KEY };

/** The brand's own mode, and what an unattributed document falls back to. */
const DEFAULT_RESOLVED: ResolvedTheme = "dark";

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * The four things a platform has to supply, and nothing else.
 *
 * Everything interesting here — the `theme` / `resolved` split, when to follow
 * the device, the hydration dance — is identical on both clients. What differs
 * is only *where* a preference is kept and *how* the device announces its own,
 * so that is all this interface covers.
 *
 * `readStored` is synchronous because the web's `localStorage` is, and making
 * it async would reintroduce a paint in the wrong mode for the one platform
 * that can avoid it. Native's storage is async, so its adapter primes a cached
 * value before mounting the provider — see the mobile app's theme entry point.
 */
export interface ThemeStorage {
  readStored: () => ThemeChoice;
  writeStored: (choice: ThemeChoice) => void;
  getSystemTheme: () => ResolvedTheme;
  /** Subscribe to device appearance changes. Returns its own unsubscribe. */
  subscribeToSystem: (onChange: () => void) => () => void;
}

/**
 * The browser's adapter.
 *
 * Persisting a colour preference is a security decision worth stating, because
 * `auth.tsx` documents the opposite policy one file over: the access token is
 * never persisted, so an injected script has nothing durable to steal. That
 * rule is about credentials. A colour preference is neither secret nor
 * account-scoped — it belongs to the device, not the login — and the API has no
 * field for it.
 *
 * Every access is wrapped: Safari's private mode throws on `localStorage`
 * rather than returning null, and a theme is never worth a crash.
 */
export const browserThemeStorage: ThemeStorage = {
  readStored: () => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      return isThemeChoice(stored) ? stored : "system";
    } catch {
      return "system";
    }
  },
  writeStored: (choice) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Private mode, or storage full. The choice still applies for this
      // session; only its durability is lost, and there is nothing useful to
      // tell the reader about that.
    }
  },
  getSystemTheme: () => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light"),
  subscribeToSystem: (onChange) => {
    const query = window.matchMedia(DARK_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  },
};

interface ThemeContextValue {
  /** What the reader chose. Bind the toggle's checked state to this. */
  theme: ThemeChoice;
  /** What is on screen. Bind icons and anything mode-dependent to this. */
  resolved: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  /** Defaulted to the browser adapter, so every existing web caller is
      unchanged. Native passes its own. */
  storage = browserThemeStorage,
  /**
   * Told what is now on screen, whenever that changes.
   *
   * The web uses it to stamp `data-theme` on `<html>`, which is the sole input
   * to the mode block in the generated stylesheet. Native has no equivalent —
   * its components read the palette from this context directly — so it passes
   * nothing, or uses it to re-tint the status bar.
   */
  onResolvedChange,
}: {
  children: ReactNode;
  storage?: ThemeStorage;
  onResolvedChange?: (resolved: ResolvedTheme) => void;
}) {
  const resolve = useCallback(
    (choice: ThemeChoice): ResolvedTheme =>
      choice === "system" ? storage.getSystemTheme() : choice,
    [storage],
  );

  /**
   * These start at the defaults and are corrected on mount, rather than being
   * read from storage in a lazy initialiser — which is the obvious version, and
   * is wrong.
   *
   * React requires the first client render to produce exactly what the server
   * sent. The server cannot know a preference held in the reader's
   * `localStorage`, so a lazy initialiser makes the first render disagree with
   * the markup for anyone not on the default, and React discards the whole tree
   * and re-renders it. It shows up as a hydration error naming whichever node
   * happened to display the theme.
   *
   * Nothing *visible* lags as a result. The page's colours come from the
   * `data-theme` attribute the pre-paint script already set and from CSS that
   * never consults React at all; what lags by one commit is only React's own
   * copy of the value. `hydrated` below is what keeps that lag invisible.
   */
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>(DEFAULT_RESOLVED);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = storage.readStored();
    setThemeState(stored);
    setResolved(resolve(stored));
    setHydrated(true);
  }, [resolve, storage]);

  const setTheme = useCallback(
    (choice: ThemeChoice) => {
      setThemeState(choice);
      setResolved(resolve(choice));
      storage.writeStored(choice);
    },
    [resolve, storage],
  );

  /**
   * The platform is told from an effect rather than at render, because
   * rendering must stay pure — and on the web the script in the head has
   * already set the correct value for the first paint, so this only ever runs
   * to *change* it.
   *
   * The `hydrated` guard is the load-bearing part. Without it this fires on the
   * first commit, while `resolved` is still the default, and stamps `dark` over
   * the `light` the script correctly worked out a moment earlier — reintroducing
   * the flash from inside the very component meant to prevent it, and only for
   * the readers who had set a preference.
   */
  useEffect(() => {
    if (!hydrated) return;
    onResolvedChange?.(resolved);
  }, [hydrated, resolved, onResolvedChange]);

  // Follow the device, but only while the reader has actually asked to. Once
  // they pick Light or Dark explicitly, changing the OS appearance must leave
  // the page alone — an explicit choice that gets overwritten at dusk is worse
  // than no choice at all.
  //
  // Also gated on `hydrated`, and for a subtler reason than above: before the
  // stored choice has been read, `theme` is still the default "system", so this
  // would subscribe on behalf of a reader who had actually chosen a side and
  // immediately overwrite their choice with the device's.
  useEffect(() => {
    if (!hydrated || theme !== "system") return;

    const onChange = () => setResolved(storage.getSystemTheme());
    const unsubscribe = storage.subscribeToSystem(onChange);

    // Re-read on subscribe: the preference can have flipped between the initial
    // render and this effect, and nothing else would notice.
    onChange();

    return unsubscribe;
  }, [hydrated, theme, storage]);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside a ThemeProvider");
  return value;
}
