/**
 * Leaving the app to sign in on Steam, and coming back with the answer.
 *
 * The fifth native seam, after the session store, the theme storage, the media
 * picker and push — and, like push, one with no web half. On the web this whole
 * module is a single line: `window.location.assign(authorizeUrl)`. The browser
 * navigates away, the API's callback redirects it back to `/settings/connections`
 * with a code in the query string, and the page reads it off the URL on mount.
 * The client is the browser, so leaving and returning is free.
 *
 * A phone has no such continuity. `Linking.openURL` would hand Steam to Safari
 * and end the app's involvement — whatever happened next would happen in another
 * application, and Sidequestd would be sitting on "Opening Steam…" with no way
 * to find out how it went short of polling. So the sign-in goes into a browser
 * the app *owns*: `ASWebAuthenticationSession` on iOS, a Custom Tab on Android,
 * both of which watch for a navigation to a URL scheme the app registered,
 * cancel it, close themselves, and hand the URL back as a return value.
 *
 * Which is why the API had to learn about clients at all. Its callback used to
 * redirect to `WEB_APP_URL` unconditionally; now the client kind rides in the
 * signed OAuth state — deliberately not in a query parameter, which would let a
 * stranger aim the redirect — and a link begun here ends at
 * `sidequestd://settings/connections?connected=steam`, which is the scheme this
 * session is waiting for.
 *
 * Two things about that browser are worth keeping rather than trading away:
 *
 * - **It shares the system's cookies**, so somebody already signed into Steam in
 *   Safari does not type a password. That is the entire advantage over an in-app
 *   webview, and it is what `preferEphemeralSession` would throw away. iOS pays
 *   for it with a one-time "wants to use steamcommunity.com to sign in" prompt,
 *   which is the platform being honest about a shared session and not something
 *   to design around.
 * - **It is not a webview we control**, which is what makes it acceptable to
 *   Steam and to the reader: the password is typed into Safari's own chrome,
 *   with Safari's own address bar naming the site.
 *
 * ## What this needs to actually work
 *
 * A **development build or a store build**, the same requirement push has, and
 * for a related reason: the scheme in `app.json` becomes a registered URL type
 * at *build* time, so under Expo Go nothing answers `sidequestd://` and the
 * session waits until the reader dismisses it. That reads as a cancel here,
 * which is the correct outcome and not a crash — but the link cannot complete.
 */
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { CONNECTIONS_PATH } from "@sidequestd/core";

/**
 * The URL the browser session watches for.
 *
 * Built from `scheme` in the app config rather than from a literal, because the
 * API builds its half from `NATIVE_APP_SCHEME` and the two have to be the same
 * word — a mismatch is a session that never returns and a reader stuck on
 * Steam's "you may now close this window".
 *
 * `Linking.createURL` is deliberately only the fallback. It is scheme-aware in a
 * built app but returns an `exp://…/--/…` address under Expo Go, and matching
 * *that* would mean asking the API to redirect somewhere it cannot know about.
 * The scheme is what both ends agree on.
 */
function returnUrl(): string {
  const configured = Constants.expoConfig?.scheme;
  const scheme = Array.isArray(configured) ? configured[0] : configured;
  return scheme
    ? `${scheme}://${CONNECTIONS_PATH.replace(/^\//, "")}`
    : Linking.createURL(CONNECTIONS_PATH);
}

/** `queryParams` types every value as possibly repeated; the callback sends one. */
function only(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Send the member to Steam and wait for the callback's verdict.
 *
 * Resolves to the code the API put in the query string — `connected`, or one of
 * the five failures — which `callbackMessage` in `@sidequestd/core` turns into
 * the same sentence the web shows for it.
 *
 * Null means the reader backed out of the browser, and that is not a failure to
 * report: they pressed Cancel, they know they pressed Cancel, and a banner
 * explaining it to them would be the app talking about itself.
 */
export async function linkSteam(authorizeUrl: string): Promise<string | null> {
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnUrl());
  if (result.type !== "success") return null;

  // `Linking.parse` rather than `new URL`: React Native's URL polyfill has no
  // `searchParams`, and a custom scheme is not something it parses well anyway.
  const { queryParams } = Linking.parse(result.url);
  return only(queryParams?.connected) ?? only(queryParams?.error);
}
