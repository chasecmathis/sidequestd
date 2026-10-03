---
type: system_architecture
title: "Mobile Client"
description: "How the Expo client is built: package wiring, what comes from where, screen-writing rules, how the design system translates to native, deliberate divergences from the web, failure screens and accessibility."
tags: [architecture, mobile, expo, react-native, design-system, accessibility]
timestamp: 2026-10-03T21:25:55Z
resource: apps/mobile/
---

# Mobile client

The Expo (React Native) client for iOS and Android is at feature parity with
`apps/web`. It shares the design system and the shared logic, and rebuilds only
the views. Running it on a device is covered in
[Local development → Mobile](development.md#mobile-on-a-device). The decisions
made while porting it are recorded in the
[mobile port plan](../decisions/2026-08-mobile-port-plan.md).

## Package wiring

- **Outside the npm workspace.** Metro resolves modules from the package
  directory, and workspace hoisting produces duplicate React copies, so the app
  takes `@sidequestd/core`, `design-tokens` and `api-types` as `file:`
  dependencies and installs separately.
- **This has a cost:** the repo root holds the web's React (19.2.x) and this app
  pins 19.1.0. `metro.config.js` therefore resolves `react`, `react-dom` and
  `react-native` as if every import came from this app's root, and adds
  `packages/` to `watchFolders`. The file explains why the blunter
  `disableHierarchicalLookup` breaks bundling. `packages/core` declares
  `react` as a **peer** dependency, never a regular one.
- Packages export TypeScript source, and Metro transpiles it, so there is no
  build step.

## What comes from where

| Source | Provides |
| --- | --- |
| `@sidequestd/core` | API transport, every presentation and validation rule, the session, backlog, notification and theme providers, and the words of the About page and policies. See [Shared packages](shared-packages.md). |
| `@sidequestd/design-tokens` | Colours, radii, shadows, grain opacity, the motion curve, font families, and the logomark as path data |
| `src/theme/` | Tokens in React Native's shape, theme storage (`storage.ts`), and `shape.ts` (the squircle corner, which CSS can't express) |
| `src/lib/` | The native seams: `api.ts` (base URL and media URL rewriting), `session-store.ts` (Keychain/Keystore), `media-picker.ts`, `push.ts`, `steam-link.ts`, plus `navigate.ts`, `layout.ts`, `haptics.ts`, `use-reduced-motion.ts`, `use-scroll-to-top.ts` and `require-auth.ts` |
| `src/components/ui/` | Primitives rebuilt as views, with the same names and prop shapes as `apps/web/src/components/ui/` |
| `src/components/*.tsx` | Domain components (`ReviewCard`, `GameCard`, `StarRating`, …) and the two screens shared by two routes each (`profile-screen`, `follow-list-screen`) |
| `app/` | Routes only. A route resolves its params and renders a component, and anything longer belongs in `src/` |

## Writing a screen

```tsx
import { useStyles, text, type Tokens } from "@/theme";

function Row() {
  const styles = useStyles(make);
  return <View style={styles.row} />;
}

const make = (t: Tokens) =>
  StyleSheet.create({ row: { backgroundColor: t.color.surface, ...rounded(t.radius.lg) } });
```

`make` must be module-level, because `useStyles` caches per factory and token
set. Nine rules the compiler won't enforce:

1. **Never set `fontWeight`.** Every weight is its own font family; use `<Text>`
   or the `text.*` helpers. On Android a missing weight silently falls back to
   the system font.
2. **Corners go through `rounded()`**, never a bare `borderRadius`. It adds
   `borderCurve: "continuous"` (the iOS squircle). Capsules and hairlines are the
   two exceptions, spelled as a plain `borderRadius` so it's clear they were
   chosen deliberately.
3. **Wrap anything drawn on artwork in `<OverMedia>`**, which pins four colour
   roles over a photograph. `<Scrim>` in `components/media.tsx` already does
   this.
4. **No literal colours.** A missing value belongs in `packages/design-tokens`.
5. **Remote images go through `<RemoteImage>` or `<Cover>`.** They set
   `recyclingKey`; without it a recycled `FlatList` row shows the previous
   row's cover until the new one decodes.
6. **A grid cell gets a pixel width from `useColumnWidth`, never `flex`.** RN's
   flexbox stretches the last row, so four games would render as three cards
   and one double-width card. `lib/layout.ts` has the arithmetic.
7. **Haptics mark a selection or a commit, nothing else** (`lib/haptics.ts`):
   chips, segmented controls, the tab bar, and the pull-to-refresh threshold.
   Never on navigation.
8. **A fixed height with `<Text>` inside is a bug.** Nothing opts out of
   Dynamic Type. Controls grow their box (`Button` does; see
   `LARGE_TEXT_SCALE`) instead of capping their type. Only the tab bar badge and
   the wordmark are capped (`theme/typography.ts`).
9. **A pushed route pays its own bottom inset.** `<Screen back>` handles it; a
   route that scrolls with a `FlatList` calls `useContentBottom(true)`.

## Translating the design system

Editorial Noir's rules hold on both platforms: quiet surfaces, cover art as the
only saturated colour, and the orchid accent as a fill or border but almost
never as text. What changes is the mechanism:

| Web | Native |
| --- | --- |
| `next/font` | `expo-font`. Each weight is an explicitly named family, because RN doesn't synthesise weights |
| CSS cascade on `[data-theme]` | `ThemeProvider` context plus `useStyles(make)` |
| `@utility over-media` | the `<OverMedia>` provider, which swaps the token set for its subtree |
| `body::after` SVG turbulence grain | `assets/grain.png`, generated from the same parameters (`npm run gen:grain`; deterministic) |
| `:focus-visible` ring | press feedback through `Pressable`'s `pressed` state |
| `link` (orchid underline on hover) | a persistent underline in `line-strong`, because there is no hover |
| `color-mix()` | rgba strings precomputed in the token module (including the `scrimLayer` gradient stops) |
| Framer Motion | RN `Animated` on the native driver. Reanimated is deliberately absent; add it only for gesture or layout animation, not mount transitions |
| `next/image` | `expo-image` |
| inline `<svg>` stars and store marks | `react-native-svg` with the same path constants from core |

## Deliberate divergences from the web

All of these come from a 390pt screen or the lack of a cursor:

- **Navigation:** five tabs. Follow requests are a segmented control on
  Notifications, not a sixth tab. The web's user menu becomes a Settings stack
  reached from Profile. "Write a review" is the app bar action on Home.
- **Sheet instead of Dialog** (`ui/sheet.tsx`). It is a `Modal`, not an Expo
  Router `formSheet`, because each caller hands a value back to the screen
  underneath rather than navigating somewhere.
- **`BacklogControl` is a button plus a sheet**, not a `<select>`. The button
  shows the current answer ("Playing").
- **Covers scroll in horizontal shelves** on a profile, instead of multi-column
  grids. `GameGrid` is a fixed two columns.
- **Review tiles always show their rating** (the web shows it on hover). Mastheads
  are centred, and game detail stacks the cover above the title.
- **The star input is 44pt** (the web's is 32), so each half-star is a usable
  target.
- **A notification row is one target plus one control.** Opening a row marks it
  read. Opening the *tab* still marks nothing.
- **The inbox pages** through `FlatList`'s `onEndReached`.
- **Deleting asks first** (a comment, a review, a follower, or unlinking
  Steam), using the platform alert. Following doesn't, because pressing again
  undoes it.
- **The favourites editor reorders with arrows**, because a long-press drag
  would fight its horizontal scroll.
- **The Steam card's action sits below its identity**, and its figures wrap to
  two columns.

Native-only additions: squircles, haptics, tapping the active tab to scroll to
the top, and dismissing the keyboard on drag.

## Failure screens

- **`app/+not-found.tsx`** replaces Expo Router's "Unmatched Route". Bad paths
  are real: anything can follow `sidequestd://`, a push can point at a deleted
  review, and `lib/navigate.ts` casts core's path strings, so a route renamed
  on one side only compiles but fails when tapped.
- **`ErrorBoundary` in `app/_layout.tsx`** renders `components/error-screen.tsx`.
  Without it, a release build shows a blank white screen. The error screen
  assumes **no provider** (it can render because a provider threw), so it uses
  no `<Screen>`, safe-area hook or theme hook, and it hides the splash screen
  itself.

## Accessibility

Every `Pressable` has a label. Beyond that:

- **Dynamic Type:** see rule 8 above.
- **Reduced motion:** `lib/use-reduced-motion.ts` subscribes to the setting
  instead of reading it once. The feed fade, tab indicator, like pop,
  skeletons and sheet all consult it. With reduced motion the sheet fades
  instead of sliding.
- **The sheet is modal** (`accessibilityViewIsModal`); otherwise VoiceOver
  reads past it into the screen beneath.
- **Texture is hidden** from screen readers (grain, rules, skeletons).
  `pointerEvents="none"` alone doesn't do that.

## Specimen screen

`app/design-system.tsx` (development only, under **Settings → Design system**)
renders every primitive on one scroll: `OverMedia`, `Sheet`, the `Prose`
renderer and both failure screens. It also prints the resolved API URL. Flip the
theme to check both modes at once.

Related: [Shared packages](shared-packages.md) · [Documents](../domains/documents.md) · [Folder structure](folder-structure.md)
