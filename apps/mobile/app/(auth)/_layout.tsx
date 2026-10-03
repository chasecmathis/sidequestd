/**
 * The signed-out stack.
 *
 * A group rather than four routes at the top level, so the redirect below is
 * written once: anyone who reaches an auth screen *with* a session is sent to
 * the app. That happens more than it sounds — the reset-password deep link
 * opening on a phone that is already signed in, or a stale back gesture landing
 * on /login after a sign-in completed.
 *
 * `isLoading` is the case worth being careful about. It is true for the moment
 * between launch and the session restore settling, and treating it as signed-out
 * would mean redirecting a returning reader to /login and then bouncing them
 * back — so the guard waits, and the splash screen is still up while it does.
 */
import { Redirect, Stack } from "expo-router";

import { useAuth } from "@sidequestd/core";

export default function AuthLayout() {
  const { user, isLoading } = useAuth();

  if (!isLoading && user) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // These four screens are one flow, not a hierarchy: sign-in and register
        // are two ways into the same place. A horizontal push says "deeper in",
        // which is not what moving between them means.
        animation: "fade",
      }}
    />
  );
}
