/**
 * The root of the native app.
 *
 * Four things have to happen before the first frame, and the splash screen stays
 * up until all four have:
 *
 *   1. **The API is configured.** `@/lib/api` does it at module scope; importing
 *      it here for the side effect is what guarantees it runs before any screen
 *      can fire a request.
 *   2. **The colour preference is read.** Native storage is asynchronous, so it
 *      is primed into a cache the shared provider can read synchronously. Skip
 *      this and the app paints dark and flips to light a tick later for everyone
 *      who chose light — see `theme/storage.ts`.
 *   3. **The faces are loaded.** Editorial Noir is mostly its typography; one
 *      frame of Helvetica is worse than a slightly longer splash.
 *   4. **The session is restored.** The stored refresh token is exchanged for a
 *      live one before anything renders, so a returning reader goes splash →
 *      Home. Hide the splash first and they go splash → login → Home, which is
 *      the auth version of the theme flash above.
 *
 * The provider order matches the web's, and for the same reasons: the theme is
 * outermost because it belongs to the device rather than to an account, has
 * nothing to fetch, and has to work on the signed-out screens. The session sits
 * beneath it, and the backlog and the unread count beneath that, because both
 * belong to an account.
 *
 * `<PushBridge>` is the one thing here with no web counterpart. It draws
 * nothing; it is where the four facts that only meet inside these providers — a
 * session, an unread count, an OS that delivers notifications, and a navigator —
 * are wired to each other.
 */
import { Stack, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  AuthProvider,
  BacklogProvider,
  NotificationsProvider,
  useAuth,
  useTheme,
} from "@sidequestd/core";

import "@/lib/api";
import { ErrorScreen } from "@/components/error-screen";
import { Grain } from "@/components/grain";
import { PushBridge } from "@/components/push-bridge";
import { secureSessionStore } from "@/lib/session-store";
import { AppThemeProvider, primeThemeChoice, useStyles, useTokens, type Tokens } from "@/theme";
import { useAppFonts } from "@/theme/fonts";

// Held until everything above is ready. The catch is deliberate: on a reload the
// splash screen may already be gone, and that is not an error worth surfacing.
void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * The app's last line of defence, and the widest one — exported from the root
 * layout, so it catches anything any screen throws while rendering.
 *
 * Expo Router looks for this export by name on every route and layout file, and
 * uses the nearest one above the component that threw. Nothing else in the tree
 * exports one, on purpose: a per-screen boundary is worth adding when a screen
 * can fail in a way its *neighbours* can recover from, and no screen here can —
 * they all draw the same feed, the same session and the same theme, so a failure
 * in one is a failure the next would hit too.
 *
 * The splash screen is hidden from here as well. `Chrome` below is what normally
 * does it, and `Chrome` is inside the providers — so a provider that throws on
 * its first render leaves the splash screen up over this boundary for ever, and
 * the reader sees a launch that never finishes rather than the screen explaining
 * that it did not.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  void SplashScreen.hideAsync().catch(() => {});
  return <ErrorScreen error={error} retry={() => void retry()} />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const [themePrimed, setThemePrimed] = useState(false);

  useEffect(() => {
    void primeThemeChoice().then(() => setThemePrimed(true));
  }, []);

  // `fontError` counts as ready. A face that will not load is a reason to run in
  // the fallback family, not a reason to hold the app on a splash screen for
  // ever — the difference is visible, but a silently unstyled app still starts.
  const ready = themePrimed && (fontsLoaded || fontError !== null);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        {/* The one thing that makes this the native client's session: the
            refresh token goes to the Keychain rather than to an httpOnly cookie
            the app cannot have. `secureSessionStore` is a module constant, and
            has to be — a store rebuilt each render would re-run the provider's
            restore effect on every render. */}
        <AuthProvider store={secureSessionStore}>
          {/* Beneath the session, because a backlog belongs to an account —
              and lazy, so a reader who never sees an "Add to list" control
              never costs a request. Its consumers are scattered across Search,
              Game Detail and a review, which is exactly why the state is here
              rather than fetched per screen: two of them on screen at once must
              not be able to disagree about what list a game is on. */}
          <BacklogProvider>
            {/* The unread count and nothing else — never the list, which is on
                one screen while the badge is on every one of them. It polls,
                because a badge has to be right for a reader who declined the
                push permission; push only makes it sooner. */}
            <NotificationsProvider>
              {/* Inside all three, because it needs a session to register an
                  address with, the count to put on the app icon, and the
                  navigator to send a tapped notification to. It renders
                  nothing. */}
              <PushBridge />
              <Chrome />
            </NotificationsProvider>
          </BacklogProvider>
        </AuthProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * How long the splash screen waits for the session before giving up on it.
 *
 * The restore is a network call, and a phone on a captive portal or a dead
 * connection can leave `fetch` hanging for the platform's own timeout — a minute
 * or more of an app that appears not to launch. After this the splash goes
 * regardless, and the reader waits on the app's own canvas instead of on a
 * screen that gives them no way to tell a slow launch from a broken one.
 *
 * Nothing is skipped when the cap fires, and nothing is *wrong* on screen
 * either: `useRequireAuth` only redirects once the restore has settled, so a
 * slow session cannot bounce a signed-in reader out to /login. Until then a
 * gated screen renders nothing — bare canvas, tab bar, no content. Which is
 * unlovely, and the read surfaces are where it becomes a skeleton.
 */
const SESSION_SPLASH_CAP_MS = 2500;

/**
 * Everything that has to be *inside* the providers: the navigator's own
 * background, the status bar's tint, the grain over the top of both — and the
 * splash screen, which is held here because only this side of `AuthProvider`
 * knows whether the session has settled.
 */
function Chrome() {
  const styles = useStyles(make);
  const tokens = useTokens();
  const { resolved } = useTheme();
  const { isLoading } = useAuth();

  const [capReached, setCapReached] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setCapReached(true), SESSION_SPLASH_CAP_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLoading || capReached) void SplashScreen.hideAsync().catch(() => {});
  }, [isLoading, capReached]);

  return (
    <View style={styles.root}>
      {/* The bar's contents invert with the canvas, not with the OS setting —
          a reader on a light phone who picked dark gets light glyphs. */}
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />

      <Stack
        screenOptions={{
          headerShown: false,
          // The colour behind a screen mid-transition. Left unset it is white,
          // which flashes on every push in dark mode.
          contentStyle: { backgroundColor: tokens.color.canvas },
        }}
      >
        {/* The one route the navigator presents differently. Composing a review
            is a task with a beginning and an end, entered from a button rather
            than navigated to, so it comes up over whatever the reader was
            looking at and leaves it exactly where it was. Everything else in
            the app is a place, and pushes. */}
        <Stack.Screen name="reviews/new" options={{ presentation: "modal" }} />
      </Stack>

      {/* Last, so it lies over the navigator and the tab bar alike — the web's
          grain is over `body`, which is the same everything. */}
      <Grain />
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.canvas },
  });
