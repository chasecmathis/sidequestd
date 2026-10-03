"use client";

/**
 * How this client talks to the API, and what state hangs off the tree.
 *
 * Both belong in one client module, and the ordering between them is the reason.
 * `configureApi` runs at module scope rather than in an effect, because a
 * component that fires a request during its first render must already find the
 * base URL set — and module evaluation is the only point guaranteed to precede
 * that. React renders this provider before any of its descendants, so evaluating
 * this file happens strictly before any of them can ask for anything.
 *
 * An effect would be too late: the home feed's first fetch starts in the same
 * commit that mounts the provider tree.
 */
import {
  AuthProvider,
  BacklogProvider,
  NotificationsProvider,
  configureApi,
} from "@sidequestd/core";
import type { ReactNode } from "react";

import { MotionProvider } from "@/components/motion-provider";
import { WebThemeProvider } from "@/lib/theme-provider";

/**
 * `credentials: "include"` is what carries the httpOnly refresh cookie, and it
 * is the whole of what makes this the *web* client: the token never enters
 * JavaScript here, so there is nothing durable for an injected script to steal.
 * The native app sets `"omit"` and keeps its token in the Keychain instead.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at build time, so the fallback is what a
 * local `npm run web:dev` uses against `npm run api:dev`.
 */
configureApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  credentials: "include",
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    // Outermost, and outside `AuthProvider` on purpose: the theme belongs to the
    // device rather than to an account, has nothing to fetch, and has to work on
    // the signed-out landing and auth screens — which never render an `AppShell`
    // and, before this, never rendered a provider either.
    <WebThemeProvider>
      {/* Also outside the data providers: it configures animation, which is a
          property of the whole tree and has nothing to fetch.
          `reducedMotion="user"` is what lets every component below animate
          unconditionally — the preference is honoured once, here, rather than in
          each of them. */}
      <MotionProvider>
        <AuthProvider>
          {/* Inside the auth provider: the backlog is one account's, and it has
              nothing to fetch until there is a session to fetch it for. The
              unread badge is the same, and it is out here rather than in the app
              shell because it has to survive navigation between tabs. */}
          <BacklogProvider>
            <NotificationsProvider>{children}</NotificationsProvider>
          </BacklogProvider>
        </AuthProvider>
      </MotionProvider>
    </WebThemeProvider>
  );
}
