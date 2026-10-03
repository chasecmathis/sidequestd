/**
 * The theme, wired to this app.
 *
 * `@sidequestd/core` decides *what* the theme is; this file decides what a
 * component gets to touch. The web's equivalent — `lib/theme-provider.tsx` —
 * stamps `data-theme` on `<html>` and stops there, because CSS takes it from
 * the cascade. Native has no cascade, so the token set travels by context and
 * every style is a function of it.
 *
 * The shape that falls out of that:
 *
 *   const styles = useStyles(make);
 *   ...
 *   const make = (t: Tokens) => StyleSheet.create({ card: { backgroundColor: t.color.surface } });
 *
 * `make` is a module-level function, so `useStyles` can cache its result per
 * (function, token set) pair — four possible token sets, so at most four
 * stylesheets per component, built the first time each is needed and never
 * again. That matters more here than it looks: `StyleSheet.create` on every
 * render of every row in a feed is exactly the kind of cost that shows up as a
 * dropped frame while scrolling and nowhere else.
 */
import { createContext, useContext, type ReactNode } from "react";
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";

import { ThemeProvider, useTheme } from "@sidequestd/core";

import { nativeThemeStorage } from "./storage";
import { tokensFor, type Tokens } from "./tokens";

export type { Tokens } from "./tokens";
export { primeThemeChoice } from "./storage";
export { rounded } from "./shape";

/** The type utilities, namespaced: `text.display(24)`, `text.eyebrow`. */
export * as text from "./typography";

/** The two Dynamic Type constants, unnamespaced — they are read as bare values. */
export { CHROME_SCALE_CAP, LARGE_TEXT_SCALE } from "./typography";

/**
 * Dark rather than null as the default, so a component rendered outside the
 * provider — a screen in a test, an error boundary above it — still paints in
 * the brand's own mode instead of throwing. `useTheme` is the hook that
 * genuinely cannot work without its provider, and it already says so.
 */
const TokensContext = createContext<Tokens>(tokensFor("dark"));

/**
 * The provider stack's outermost layer, and outside `AuthProvider` for the same
 * reason it is on the web: the theme belongs to the device rather than to an
 * account, has nothing to fetch, and has to work on the signed-out screens.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider storage={nativeThemeStorage}>
      <TokenBridge>{children}</TokenBridge>
    </ThemeProvider>
  );
}

/**
 * Turns the resolved theme into the token set beneath it.
 *
 * A separate component because it has to be *inside* the provider to read
 * `useTheme`, and because keeping the two contexts distinct means a control that
 * changes the theme (the toggle, which needs `theme` and `setTheme`) and the
 * hundreds of components that only paint (which need the tokens) do not
 * re-render for each other's reasons.
 */
function TokenBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  return <TokensContext.Provider value={tokensFor(resolved)}>{children}</TokensContext.Provider>;
}

/**
 * A subtree laid over user media — cover art, a screenshot, a video still.
 *
 * The direct analogue of the web's `over-media` utility, and required for the
 * same concrete reason: four colour roles have to stop following the theme,
 * because what is behind them is a photograph and it does not get lighter when
 * the page does. See `toMedia` in `tokens.ts` for the failure it prevents.
 *
 * Wrap the *scrim*, not the image: everything inside inherits the pinned roles,
 * so a `StarRating` or a `Badge` in there is correct without being told where
 * it is.
 */
export function OverMedia({ children }: { children: ReactNode }) {
  const tokens = useContext(TokensContext);
  return (
    <TokensContext.Provider value={tokensFor(tokens.name, true)}>{children}</TokensContext.Provider>
  );
}

/** The palette, shape and motion currently in force. */
export function useTokens(): Tokens {
  return useContext(TokensContext);
}

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Two levels of `WeakMap`, and both are weak on purpose: the outer keys are
 * style factories (garbage when a component is hot-reloaded away), the inner
 * are the token objects. Neither is allowed to keep the other alive.
 */
const registry = new WeakMap<object, WeakMap<Tokens, NamedStyles>>();

/**
 * The stylesheet for the current theme.
 *
 * Pass a module-level factory. Passing an inline arrow works — it just defeats
 * the cache, so every render builds a stylesheet and the whole point is lost.
 */
export function useStyles<T extends NamedStyles>(factory: (tokens: Tokens) => T): T {
  const tokens = useTokens();

  let perTheme = registry.get(factory);
  if (!perTheme) {
    perTheme = new WeakMap();
    registry.set(factory, perTheme);
  }

  let styles = perTheme.get(tokens);
  if (!styles) {
    styles = StyleSheet.create(factory(tokens));
    perTheme.set(tokens, styles);
  }

  return styles as T;
}
