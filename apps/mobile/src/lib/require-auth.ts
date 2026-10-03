/**
 * "This screen needs a session" — the native spelling of the web's
 *
 *     useEffect(() => { if (!isLoading && !user) router.replace("/login"); })
 *
 * which is copied at the top of seven page components in `apps/web`.
 *
 * Per screen rather than around the whole tab navigator, and that is a decision
 * rather than an accident. Discover, Search and a profile are public on the web
 * and will be public here; a gate on the navigator would sign-in-wall the app's
 * entire browsing surface, which is both a product change and one nobody asked
 * for. Home, Notifications and your own profile are the screens that cannot mean
 * anything without an account, and they are the ones that carry this.
 *
 * `useFocusEffect` rather than `useEffect` is the native half. Tab screens stay
 * mounted once visited, so three gated tabs with plain effects would all fire on
 * the same sign-out and race each other to navigate. Only the focused screen
 * redirects; the others do it if and when the reader comes back to them.
 *
 * Returns the user so a screen can render the signed-in case directly. It is
 * null while the session restore is still settling — which is a frame, and
 * usually a frame that happens under the splash screen — so callers should
 * render nothing rather than an empty state that will be wrong a moment later.
 */
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { useAuth } from "@sidequestd/core";
import type { UserMe } from "@sidequestd/api-types";

export function useRequireAuth(): UserMe | null {
  const { user, isLoading } = useAuth();

  useFocusEffect(
    useCallback(() => {
      // `isLoading` is the guard that matters: without it, every cold start
      // redirects to /login before the stored token has been exchanged, and a
      // signed-in reader is bounced out of the app they were already in.
      if (!isLoading && !user) router.replace("/login");
    }, [isLoading, user]),
  );

  return user;
}
