---
type: decision_log
title: "Mobile Port Plan (2026-08)"
description: "The approved eight-phase plan for building the Expo client at parity with the web, kept verbatim with the as-built deviations recorded at its head."
tags: [decisions, mobile, plan, history, design-system]
timestamp: 2026-10-03T21:25:55Z
resource: apps/mobile/
---

> **Archived decision record.** This was `apps/mobile/PLAN.md`. It was moved
> here verbatim on 2026-10-03 because the file was never committed to git, so
> there was no other copy. It records *why* the mobile client was built the
> way it was. For how it works today, read
> [Mobile client](../architecture/mobile-client.md) and
> [Shared packages](../architecture/shared-packages.md). Where this record and
> those files disagree, they and the code win.

<!--
  Recovered on 2026-08-19 from the planning session of 2026-08-18, where it only
  ever existed as an approved plan and a list of tasks. Everything below the rule
  is that plan verbatim — it is a record of what was decided and why, not a
  description of what is in the tree.

  Where the two disagree, the code and the `.context/` knowledge bundle win. The plan is left unedited
  so the disagreements stay visible; the ones known so far are noted under Status.
-->

# Sidequestd Mobile — the plan

**Status, 2026-08-22: all eight phases are done. The API work finished with
phase 7, and phase 8 touched no server code — as expected — but it did touch
`apps/web`, which nothing after phase 1 was supposed to. See the phase 8 notes
below for why that was the right call rather than scope creep.**

[`product/roadmap.md`](../product/roadmap.md) is the live
record of what has landed and what is deliberately still missing. This file is
the sequencing and the reasoning behind it, which is the part the bundle does
not carry.

| Phase | | |
|---|---|---|
| 0 | `packages/design-tokens` | done |
| 1 | `packages/core` extraction | done |
| 2 | Mobile foundation | done |
| 3 | Auth screens + SecureStore session | done |
| 4 | Read surfaces | done |
| 5 | Write surfaces | done |
| 6 | Notifications + push *(needs API work)* | done |
| 7 | Connections + Steam deep link *(needs API work)* | done |
| 8 | Policy screens, empty/error states, reduced motion, a11y | done |

Things the implementation decided differently, so the plan below is not read as
current. From phases 0–3:

- **The `SessionStore` seam is `read` / `write`**, not `readRefreshToken` /
  `writeRefreshToken`, and it is async on both platforms because the Keychain is.
- **`Dialog`-as-a-bottom-sheet has not been built.** It has no caller until the
  write surfaces, and a sheet built against no screen is built against a guess.
- **`logout` now sends the stored refresh token too**, which the plan did not
  anticipate: the API reads body-then-cookie, so without it a signed-out phone
  left a live refresh token on the server until it expired.

And from phase 4, where three of the translations below did not survive contact
with a 390pt screen (the bundle's `product/roadmap.md` is the live status):

- **Reanimated is not in the tree, and the feed's stagger is gone with it.** The
  plan's `FadeInDown.delay()` is the web's `STAGGER_COUNT` translated literally,
  and it assumes a viewport showing three cards. A phone shows one and a half,
  so four sixths of that animation happens below the fold. The list fades in as
  one movement, on RN's own `Animated`.
- **The web's multi-column cover grids became horizontal shelves** on the
  profile — favourites, the four backlog lists, the platform showcase. A phone
  fits two covers across, so six-across became three stacked rows apiece and a
  profile nobody would scroll to the bottom of.
- **`GameGrid` is two columns, fixed**, and its cells carry pixel widths rather
  than a flex basis. The plan said nothing about it; RN's flexbox has a
  last-row-stretch bug that makes the obvious spelling wrong. See
  `src/lib/layout.ts`.
- **A new token, `scrimLayer`.** The review tile's scrim is a gradient rather
  than a flat fill, and an SVG stop discards its colour's alpha — the same trap
  `bloomLayer` already documents, so `fixed.scrim` gained the same split.

And from a pass back over those screens looking for what a port arrives with
none of — the things the phone has and the browser does not, which nothing in a
screen-by-screen parity check can catch because the web has no column for them:

- **Every rounded rectangle is a squircle.** `borderCurve: "continuous"`, through
  a `rounded()` helper in `theme/shape.ts` rather than by hand. The shared
  `radius` token cannot carry it — CSS has no shipping equivalent — so this is
  the first piece of shape that is native's alone.
- **Haptics, on selection and on commit only.** `lib/haptics.ts`, iOS-gated.
  Facets, sorts, the theme cycle and the tab you are moving *to*; pull-to-refresh
  on the threshold rather than on the response. Navigation gets none.
- **Re-pressing the active tab scrolls that tab to the top.** The tab bar was
  already emitting `tabPress` for it and nothing was listening.
- **Pushed routes pay their own home-indicator inset.** They cover the tab bar,
  which is what was accounting for it, so the last line of a follow list ran
  under the indicator with six points to spare.

And from phase 5, where the plan's component list survived but three of its
mechanisms did not:

- **`Dialog` became `Sheet`, and it is a `Modal` rather than a route.** The plan
  said "a native bottom sheet" and left it there. Expo Router can present a route
  as a `formSheet`, which is the better answer when the sheet *is* a
  destination — and none of the three callers is. Each hands a value back to the
  state of the screen underneath, and routing that value through navigation
  params would replace three `useState` calls with a global.
- **`BacklogControl` is a button and a sheet, not a picker.** The web is a
  `<select>` and the reasoning it gives is sound; React Native has no `<select>`,
  and the platform pickers it does have are two different controls that look
  nothing alike and neither of which can be told what a Sidequestd list looks
  like. The button says the *answer* once there is one, which is what a
  `<select>` does without being asked.
- **The favourites editor reorders with arrows for a second reason.** The web
  chose them over drag so there would be a keyboard path. Here the row is a
  horizontal `ScrollView`, and a long-press-drag inside one fights the scroll it
  lives in.
- **The star input is drawn at 44 rather than the web's 32.** A half of a 32pt
  star is a 16pt target, which is a third of the platform's floor.

And from phase 6, where the plan's four bullets of API work turned out to be
right about what to build and wrong about two things it assumed came free:

- **The server has to write the sentence, so there are two copies of it.** The
  plan inherited `lib/notifications.ts`'s premise that wording lives on the
  client and is therefore changeable without an API deploy. That premise is
  about a *row we render*. On a lock screen the renderer is the operating
  system, so `_PHRASES` in `app/services/push.py` is a second copy of core's
  table, cross-referenced in both directions and pinned by a test that every
  member of the enum has one. They may differ in register — a push quotes the
  comment, a list row does not — never in meaning.
- **The send step could not go "in the notification-creation service".** `emit`
  writes and does not commit; that is the property its module docstring opens
  with, and it is what stops a rolled-back like leaving a notification about
  something that never happened. A push posted from inside that transaction is
  the same bug on somebody's lock screen, and unlike a row a push cannot be
  taken back. So `emit` records the intent on the session and a SQLAlchemy
  `after_commit` listener dispatches it. No producer moved, which was the point.
- **The endpoints are `/users/me/devices`**, not the plan's `/me/devices`: the
  users router is mounted at `/users` and `/users/me/…` is where every other
  thing that hangs off the signed-in member already lives.
- **Deregistration has to happen *before* `logout`**, which "deregister on
  logout" hides. It is an authenticated call and `logout` destroys the token it
  needs. The server's second line of defence is that `device_tokens` is unique on
  the token alone rather than on `(user, token)`, so registering moves a phone
  to its new owner — but that only fires if somebody else ever signs in on it.
- **The push carries the badge.** The plan kept `UNREAD_POLL_MS` as the fallback
  and it is still the floor, but "the badge updates from a background push" is
  only literally true if the number is in the payload — the app is not running to
  be told. Each message carries its recipient's unread count, grouped out of one
  query.
- **A notification row marks itself read when it is opened**, where the web's
  page marks only on an explicit button. The web's actual position — opening the
  *tab* must not clear the list — survives untouched; a row the reader opened is
  a different thing, and every native inbox agrees.

And from phase 7, where the plan's paragraph on the Steam deep link was right
about the mechanism and quiet about the four things around it:

- **The state grew a `client` claim, and the redirect is the only thing that
  branches.** The plan said "thread the client kind through the existing signed
  `state` token (not a new query param — the state is already replay-protected, a
  forgeable param is not)", and that reasoning is exactly why it is built this
  way. What the paragraph did not say is what the claim is *for*: nothing about
  the OpenID round trip changes. `realm` and `return_to` are the API's own HTTPS
  addresses, Steam signs them, and they stay. Only the hop after verification
  differs, and there is a test named after the property — the callback will not
  be told where to send somebody.
- **A failure has to come back to the phone too**, which "the callback redirects
  to `sidequestd://`" quietly reads as a success path. It is the failures that
  matter more: a refusal is precisely when somebody needs to be looking at the
  screen with the Connect button on it, and a version that sent the success to
  the app and the errors to a web page would leave the app on "Opening Steam…"
  for ever, behind a browser explaining a problem to nobody.
- **There is one case with no client to send to**, and the plan had no room for
  it. An unreadable state is where the answer lives, so it has no answer — that
  path falls back to the web, because a `sidequestd://` URL on a machine with no
  app installed reports nothing at all where a web address is a page that can say
  what went wrong.
- **The outcome arrives twice, and both paths are handled.** The plan's client
  half is `openAuthSessionAsync` handing the URL back, and that is the normal
  path — the screen never unmounts and nothing is routed. But the redirect *is* a
  real deep link, and if the app was killed behind the browser, or Android routes
  the intent before the Custom Tab sees it, the OS delivers it as a link and the
  app launches onto `/settings/connections?connected=steam`. So the screen reads
  the query string as well, exactly as the web does, and clears it once read.
- **Unlinking asks in the platform's alert**, where the web reveals an inline
  confirm strip with a Keep-it escape. Same decision as the web's, in the form
  this app already uses for a comment, a review and a follower.

And from phase 8, which is one line in the table above and turned out to be four
unrelated pieces of work with one thing in common — each is something a port
arrives *without* and nobody notices until the wrong person is holding the
phone:

- **The policy documents went into `packages/core`, and that meant editing
  `apps/web`.** The plan says phases 0 and 1 touch the web and nothing after
  them does, and this broke that. The reason is that "policy screens" quietly
  assumed the words would be typed out again here — six hundred lines of legal
  prose in a second place, with nothing to notice when the copies drifted. A
  privacy policy that says two different things on two clients is not two
  versions of a page; it is one of them being wrong, in the one place being
  wrong is expensive. So the words are `packages/core/src/policy.ts` and
  `about.ts`, each client renders them (`components/prose.tsx` on both sides),
  and the claims that some *other* file could quietly falsify — the media
  pipeline stripping EXIF, the absence of an ad network, §512's three
  requirements — are pinned by `policy.test.ts` at the source rather than by a
  test on one platform's page. The web's own page tests passed unedited, which
  is the same safety net phase 1 used and the reason to trust the move.
  `lib/site.ts` came along, because the phone needs the contact address too.
- **Two of the plan's own bullets were already there.** "Empty states" and "a11y
  labels" read as phase 8 work in a plan written before phase 4, and by the time
  the read and write surfaces were done every list had an `EmptyState` and every
  `Pressable` in the app had a name. What was actually missing was narrower and
  more specific, which is the next two bullets.
- **The two screens Expo Router draws itself.** `+not-found` and the error
  boundary were the only surfaces left that were not in this design system, and
  both appear at the moment a reader is already confused. The second is worse
  than it sounds: in a release build Expo Router's default is a blank white
  screen, which is indistinguishable from a crash, and it is the version an
  actual reader would meet. `components/error-screen.tsx` assumes no provider —
  it can be asked to render *because* the theme or the session provider was the
  thing that threw — and hides the splash screen itself for the same reason.
- **Dynamic Type, which nothing had considered.** React Native scales every
  `<Text>` by the system text size and caps nothing, so the app was already
  correct for prose and already broken for a `Button`: a 44pt box holding a
  one-line label renders "Write a…" at 2×. The rule that came out of it is in
  `theme/typography.ts` — nothing opts out of scaling, controls grow their box
  instead of capping their type, and exactly two things are capped (the tab
  bar's 18pt badge capsule and the wordmark, which is a logotype rather than
  reading material). `Button` is the only primitive that needed teaching; the
  rest were built on padding rather than on a height and needed nothing, which
  is a nice retroactive argument for how they were built.
- **Reduced motion had one gap, and it was the biggest movement in the app.**
  `useReducedMotion` existed and the feed, the tab indicator, the like button
  and the skeletons all consulted it. The `Sheet` did not — and a panel sliding
  the height of the screen is precisely what somebody who turned the setting on
  turned it on about. It fades now rather than sliding, and it gained
  `accessibilityViewIsModal` while it was open, without which VoiceOver walks
  straight past the last option into the screen the sheet is covering.

---

# Sidequestd Mobile — design & implementation plan

## Context

Sidequestd today is a FastAPI backend (`apps/api`) and a Next.js 15 web client (`apps/web`, ~11k lines) built on a distinctive, heavily-documented design system called **Editorial Noir**. `apps/mobile` exists but is a bare Expo Router scaffold: one placeholder screen, a hardcoded `API_URL`, and a README that says auth screens land "after the web slice is reviewed."

The goal is a native iOS/Android client at **full feature parity** with the web app, that looks like the same product, and that shares as much code as the two platforms can honestly share.

Two findings from exploring the codebase shape everything below:

1. **The web's `lib/` layer is already platform-agnostic.** Every module in `apps/web/src/lib/` imports only `@sidequestd/api-types`, React, and its siblings — there is not one `next/*` import among them. `api.ts`, `feed.ts`, `catalog.ts`, `reviews.ts`, `profile.ts`, `social.ts`, `notifications.ts`, `interactions.ts`, `backlog.ts`, `connections.ts` and the three context providers can be lifted into a shared package almost verbatim. This is the single largest reuse opportunity in the repo and it costs a move, not a rewrite.

2. **The API already anticipated a native client.** `AuthSession` returns `refresh_token` in the response body, and `RefreshRequest.refresh_token` is documented as "Native clients send the refresh token here. The web client omits it and relies on the httpOnly cookie." The session design needs no server change.

The design system does *not* port mechanically — `globals.css` is Tailwind v4 `@theme`, custom `@utility` rules, `color-mix()`, and an SVG-turbulence grain overlay. So the plan shares **tokens**, not class strings, and rebuilds the primitives in React Native against those tokens.

---

## Architecture

Three new/changed workspace members plus the two apps:

```
packages/
  api-types/        (unchanged — already shared)
  design-tokens/    NEW — the Editorial Noir palette, shape, type & motion scale
  core/             NEW — the entire lib/ layer + React providers, platform-seamed
apps/
  web/              imports from core + design-tokens instead of local lib/
  mobile/           imports from core + design-tokens; owns its own view layer
```

### `packages/design-tokens`

`src/tokens.ts` becomes the single source of truth for every value currently literal in `globals.css`: the two colour ramps, radii (6/10/14/20/24), the `--ease-out` curve, grain opacity, and the per-mode shadow definitions.

- `src/css.ts` generates the `@theme { … }` and `[data-theme="light"] { … }` blocks into `apps/web/src/app/tokens.generated.css`, which `globals.css` `@import`s.
- **`globals.css` keeps everything that is not a raw value** — every `@utility` (`type-display`, `type-eyebrow`, `over-media`, `link`, `prose-review`, `prose-legal`), the grain layer, the focus ring, the reduced-motion backstop, and its extensive design commentary. Only the token literals move out, and the rationale comments attached to them move *with* them into `tokens.ts`, where they now document both platforms.
- Shadows stay special-cased exactly as they are today on web (the file already explains why `--shadow-*` cannot live in `@theme`); the token module exports them in both CSS and RN (`shadowColor`/`shadowOpacity`/`shadowRadius` + Android `elevation`) shapes.
- Add `npm run gen:tokens` to the root scripts, and a check in `npm run lint` that the generated file is current.

### `packages/core`

Moved verbatim from `apps/web/src/lib/`, with their existing test files (`*.test.ts`) coming along as the proof the move was lossless:

`api.ts` · `feed.ts` · `catalog.ts` · `reviews.ts` · `profile.ts` · `social.ts` · `notifications.ts` · `interactions.ts` · `backlog.ts` · `connections.ts` · `backlog-store.tsx` · `notifications-store.tsx`

Three modules need a **platform seam** rather than a straight move:

| Module | Seam | Web injects | Mobile injects |
|---|---|---|---|
| `api.ts` | `configureApi({ baseUrl, credentials })` | `"include"` (carries the httpOnly cookie) | `"omit"` |
| `auth.tsx` | a `SessionStore` with `readRefreshToken()` / `writeRefreshToken()` | no-ops — the cookie is the store | `expo-secure-store` (Keychain/Keystore) |
| `theme.tsx` | `{ readStored, writeStored, getSystemTheme, subscribeToSystem }` | `localStorage` + `matchMedia` | `AsyncStorage` + `Appearance` |

`auth.tsx`'s refresh call becomes `body: refreshToken ? { refresh_token: refreshToken } : {}` — the API accepts both spellings already. The careful `theme` (what the reader chose) vs `resolved` (what is painted) distinction documented in `lib/theme.tsx` is preserved and now shared; only the storage and system-detection primitives differ.

`use-dismissable.ts` stays in `apps/web` — it is DOM-bound and has no native meaning.

One `rejectMedia` signature change: it takes a DOM `File` today. Widen it to `{ type: string; size: number }` so an `expo-image-picker` asset satisfies it too.

**Metro gotcha, and it is load-bearing.** `apps/mobile/README.md` documents why the app sits outside npm workspaces: Metro resolves from the package directory and a hoisted install produces duplicate React copies. The new packages must therefore be `file:` dependencies (as `api-types` already is), *and*:

- `packages/core` declares `react` as a **peerDependency**, never a dependency.
- `apps/mobile/metro.config.js` gains `watchFolders` for `packages/*` and an `extraNodeModules` mapping `react`/`react-dom` back to the mobile app's own copy.
- Packages export TypeScript source via `main`; Metro transpiles it through Babel, so there is no build step to keep in sync.

---

## Translating Editorial Noir to native

The system's governing rules survive intact: quiet near-neutral surfaces with a violet cast, cover art as the only saturated colour, the orchid accent as a **fill or border and almost never as body text**, amber stars as the one warm chromatic thing, elevation by lightness-plus-hairline rather than drop shadow, and tight deliberate radii. What changes is the mechanism.

| Web mechanism | Native equivalent |
|---|---|
| `next/font` self-hosting 3 faces | `expo-font` + `@expo-google-fonts/{instrument-serif,figtree,jetbrains-mono}`. RN does not synthesise weights — map each weight to an explicitly named family. |
| CSS cascade re-assigns `--color-*` on `[data-theme]` | `ThemeProvider` context returns the token object; screens use `const s = useStyles(makeStyles)`, where `makeStyles(t)` returns a `StyleSheet.create` memoised per resolved theme. |
| `@utility over-media` (inherited custom properties pin the palette over artwork) | An `<OverMedia>` provider that swaps the context's token set for its subtree. This is the *direct* analogue — and it is required for the same reason the CSS comment gives: without it, light-theme `StarRating` paints filled stars darker than empty ones against a black scrim. |
| `body::after` SVG turbulence grain | A pre-rendered 160×160 PNG of the same turbulence, tiled at the root in an absolutely-positioned `pointerEvents="none"` overlay, at the per-theme `--grain` opacity (0.035 dark / 0.022 light). |
| `:focus-visible` accent ring | No native equivalent. Replaced by press feedback — `Pressable`'s `pressed` state carries what `active:translate-y-px` and the hover borders do on web. |
| `link` (underline turns orchid on hover) | Persistent `textDecorationLine` with `textDecorationColor: line-strong` in prose. |
| `link-quiet` (underline only on hover) | Dropped — a hover-only affordance has no meaning on touch. Titles rely on press opacity. |
| `color-mix()` / `bg-canvas/80` | Pre-computed `rgba()` strings in the token module. |
| `shadow-pop` / `shadow-panel` | Per-platform token objects (iOS shadow props + Android `elevation`). |
| Framer Motion | `react-native-reanimated`. The feed's `STAGGER_COUNT`-limited entrance becomes `FadeInDown.delay()`; the nav's `layoutId` orchid rule becomes a shared animated indicator on the tab bar. |
| `next/image` | `expo-image` (`contentFit: "cover"`, memory/disk caching). |
| `lucide-react` | `lucide-react-native` — same icon set, same names. Straight swap. |
| `StarRating`'s inline `<svg>` path | `react-native-svg` using the *same* `PATH` constant, hoisted into `packages/core`. Half-stars stay a clipped width, not a third glyph. |

---

## Navigation & information architecture

`AppShell` is already mobile-first — a fixed bottom bar under `md` — so the IA transfers almost 1:1 to a native tab navigator.

```
app/
  _layout.tsx                    Theme → Auth → Backlog → Notifications providers + grain
  (auth)/                        login · register · forgot-password · reset-password
  (tabs)/_layout.tsx             Home · Discover · Search · Notifications · Profile
  games/[id].tsx
  reviews/new.tsx                modal presentation
  reviews/[id]/index.tsx · edit.tsx
  profile/[username]/index.tsx · followers.tsx · following.tsx
  follow/requests.tsx
  settings/index.tsx · profile.tsx · connections.tsx
  about.tsx · privacy.tsx · terms.tsx
```

Three deliberate divergences from the web nav, each because the web pattern has no good native form:

- **"Write a review" stays a header-right accent button on Home**, exactly as on web — not a centre-FAB. Five tabs is the native ceiling, and the design system's "at most one primary per view" rule already puts this control in the header.
- **Follow requests become a segmented control on Notifications** (All / Requests), shown only for private accounts. Web gives it a conditional nav slot; a conditional sixth tab would be worse.
- **The `UserMenu` popover becomes a Settings stack** reached from a gear in the Profile tab header. Policy documents (`about`/`privacy`/`terms`, currently `prose-legal`) live under it.

---

## Component parity

Ported to `apps/mobile/src/components/`, keeping web's names and prop shapes so the two trees read the same:

- **Primitives** — `Button` (4 variants × 3 sizes), `Card`/`Header`/`Body`/`Footer`, `Badge` (4 tones incl. `overlay`), `Eyebrow` (with `rule`), `Stat`, `EmptyState`, `Alert`, `Field`, `PageHeader`, `Skeleton` set, `Wordmark`, `StoreMark`. `Dialog` becomes a native bottom sheet.
- **Domain** — `Avatar`, `StarRating`/`StarRatingInput`/`StarGlyph`, `ReviewCard`, `ReviewTile`/`ReviewGrid`, `GameCard`/`GameGrid`, `FollowButton`, `LikeButton`, `Comments`, `BacklogControl`, `FavoriteGames`, `MediaCarousel`, `PlatformShowcase`, `VerifiedPlaytimeChip`, `UserRow`, `ActivityRow`, `RecommendedRow`, `FollowListScreen`, `GameScores`, `SteamConnectCard`.

Every one of these keeps its **logic** in `packages/core` (`excerpt`, `formatStars`, `starFill`, `formatPlaytime`, `timeAgo`, `releaseYearLabel`, `notificationText`, `syncNotice`, `feedItemKey`, the `isReviewItem`/`isActivityItem`/`isRecommendedItem` narrowing) and rebuilds only the view.

Feed paging swaps the web's `IntersectionObserver` + `FEED_PREFETCH_MARGIN` for `FlatList`'s `onEndReached` — same `FEED_PAGE_SIZE`, same cursor logic, same `fetching` ref guard against double-fetching a cursor.

---

## Native-only work

**1. SecureStore session** — as described in the `packages/core` seam. No API change.

**2. Camera / photo library** — `expo-image-picker` replaces `<input type="file">`. `apps/web/src/app/reviews/new/page.tsx` already documents the ordering constraint (a review must exist before media can attach, and `reviewId` is retained so a partial failure retries only what is left); that flow is preserved as-is.

**3. Push notifications** — the only feature needing **new backend surface**. `lib/notifications.ts` currently says push is post-MVP and polls every 60s.
- API: `device_tokens` table + Alembic migration; `POST /api/v1/me/devices` `{ token, platform }` and `DELETE /api/v1/me/devices/{token}`; a send step in the existing notification-creation service via the Expo Push API.
- Client: `expo-notifications`; register on login, deregister on logout. **Keep `UNREAD_POLL_MS` as the fallback** — a user who denies the permission must still get a correct badge.

**4. Steam OAuth deep link** — also needs an API change. `apps/api/app/api/v1/connections.py:56` hard-redirects the callback to `settings.web_app_url + /settings/connections`. Thread the client kind through the **existing signed `state` token** (not a new query param — the state is already replay-protected, a forgeable param is not): `GET /connections/steam/start?client=native` → the callback redirects to `sidequestd://settings/connections?…`. Steam's `realm`/`return_to` are the API's own URLs and are unaffected; only the final hop changes. Client uses `expo-web-browser`'s `openAuthSessionAsync`, and the existing `callbackMessage(code)` in `connections.ts` decodes the result unchanged.

---

## Sequencing

| Phase | Work | Done when |
|---|---|---|
| 0 | `packages/design-tokens`; wire `globals.css` to the generated block | Web renders identically; `web:test` green |
| 1 | `packages/core` extraction; migrate `apps/web` imports | **All existing web tests pass unchanged** — this is the refactor's safety net |
| 2 | Mobile foundation: Metro config, fonts, ThemeProvider, primitives, grain, tab skeleton | Empty tabs render in both themes on device |
| 3 | Auth screens + SecureStore session | Session survives a cold app restart |
| 4 | Read surfaces: Home, Game detail, Review detail, Profile, Discover, Search, follow lists | Feed pages; facets filter |
| 5 | Write surfaces: compose + image picker, comments, likes, backlog, favorites, settings | A review with media posts from a phone |
| 6 | Notifications + push (incl. API work) | Badge updates from a background push |
| 7 | Connections + Steam deep link (incl. API work) | Link completes without leaving the app |
| 8 | Policy screens, empty/error states, reduced-motion, a11y labels | — |

Phases 0 and 1 touch `apps/web` and nothing else; the mobile app is not blocked on anything after phase 2.

---

## Verification

- **The refactor (phases 0–1):** `npm run web:test` and `npm run web:lint` must pass with zero test-file edits beyond import paths. The ~20 existing `*.test.ts(x)` files are what prove the extraction was lossless. Add `vitest` to `packages/core` and run its moved tests there too.
- **Types:** `npm run gen:types` still round-trips; `tsc --noEmit` in `apps/web`, `packages/core`, and `apps/mobile`.
- **Token drift:** `npm run gen:tokens` produces no diff in CI.
- **On device:** `npm run mobile:dev`, then iOS simulator and an Android device. Check both themes on every screen, and specifically the `OverMedia` case — a review tile's hover/press scrim in **light** theme, which is the one place the web comments flag as easy to get inverted.
- **Visual parity:** web at a 390px viewport beside the simulator, screen by screen.
- **API additions:** pytest coverage for the device-token endpoints and for the native-vs-web branch in the Steam callback redirect.

## Open risks

- `packages/core` exporting React components is the one place a duplicate-React bug can appear. If `extraNodeModules` proves fragile, the fallback is splitting `core` into `core` (pure TS, no React) and `core-react` (providers), with mobile owning its own providers over the pure half.
- Instrument Serif is stated in `globals.css` as headline-only at ≥28px. Several native surfaces are narrower than their web counterparts; sizes need re-checking on a 390px screen rather than scaled down proportionally.
