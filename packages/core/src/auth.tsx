"use client";

/**
 * Session state, for both clients.
 *
 * The access token is held in React state only — never in durable storage — so
 * an injected script has nothing to steal. That half is identical everywhere.
 *
 * Durability is the half that is not, and `SessionStore` is the whole of the
 * difference. The web is issued an httpOnly refresh cookie at login: the token
 * never enters JavaScript, so the store is a pair of no-ops and `/auth/refresh`
 * is called with an empty body. A native app has no equivalent, so it keeps the
 * refresh token in the Keychain / Keystore and sends it explicitly. The API was
 * built expecting both — `RefreshRequest.refresh_token` is documented as the
 * native spelling, and the cookie as the web one.
 *
 * Writing this as an injected interface rather than a `Platform.OS` branch is
 * what keeps the security note above honest: there is exactly one place per app
 * that decides where the token lives, and it is named.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AuthSession, UserMe } from "@sidequestd/api-types";

import { ApiError, apiRequest } from "./api";

/**
 * Where the refresh token lives between launches.
 *
 * Async on both sides even though the web's implementation is synchronous:
 * the Keychain is not, and an interface that pretended otherwise would force
 * the native store to lie about when a write had landed.
 */
export interface SessionStore {
  /** The stored token, or null when there is none — or when the platform keeps
      it somewhere JavaScript cannot see, which is the web's answer. */
  read: () => Promise<string | null>;
  /** Persist a new token, or clear it when passed null. */
  write: (token: string | null) => Promise<void>;
}

/**
 * The web's store: the httpOnly cookie does all of this already.
 *
 * `read` returning null is not a failure — it is what tells `refresh()` to send
 * an empty body and let the cookie speak for itself.
 */
export const cookieSessionStore: SessionStore = {
  read: async () => null,
  write: async () => {},
};

interface AuthContextValue {
  user: UserMe | null;
  /** True until the initial refresh attempt settles; render a splash meanwhile. */
  isLoading: boolean;
  register: (input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Authenticated GET/POST that retries once after a silent token refresh. */
  authedRequest: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;
  /**
   * Replace the cached record after an edit.
   *
   * `/users/me` responses are authoritative, so the profile editor hands the one
   * it just received straight back rather than making the nav refetch it.
   */
  syncUser: (updated: UserMe) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  /**
   * Defaulted to the cookie store so the web — which is every existing caller —
   * mounts `<AuthProvider>` unchanged. Native must pass its own.
   */
  store = cookieSessionStore,
}: {
  children: ReactNode;
  store?: SessionStore;
}) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // A ref, not state: request helpers need the current token synchronously and
  // must not re-render every consumer when it rotates.
  const accessToken = useRef<string | null>(null);

  const applySession = useCallback(
    async (session: AuthSession) => {
      accessToken.current = session.access_token;
      setUser(session.user);
      // The API rotates the refresh token on every issue, so this has to happen
      // on refresh as well as on login — storing only the one from login would
      // leave the app holding a token that stops working after the first
      // rotation, and the failure would look like a random sign-out days later.
      await store.write(session.refresh_token);
    },
    [store],
  );

  const clearSession = useCallback(async () => {
    accessToken.current = null;
    setUser(null);
    await store.write(null);
  }, [store]);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const stored = await store.read();
      const session = await apiRequest<AuthSession>("/auth/refresh", {
        method: "POST",
        // Empty body on the web, where the cookie carries it. Sending
        // `refresh_token: null` instead would be rejected by the schema.
        body: stored ? { refresh_token: stored } : {},
      });
      await applySession(session);
      return true;
    } catch {
      await clearSession();
      return false;
    }
  }, [applySession, clearSession, store]);

  // Restore an existing session on first load.
  useEffect(() => {
    let cancelled = false;
    void refresh().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const register = useCallback<AuthContextValue["register"]>(
    async ({ username, email, password, displayName }) => {
      const session = await apiRequest<AuthSession>("/auth/register", {
        method: "POST",
        body: {
          username,
          email,
          password,
          // Omit rather than send "": the API rejects an empty display name.
          ...(displayName?.trim() ? { display_name: displayName.trim() } : {}),
        },
      });
      await applySession(session);
    },
    [applySession],
  );

  const login = useCallback<AuthContextValue["login"]>(
    async (identifier, password) => {
      const session = await apiRequest<AuthSession>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      await applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      // The token is sent for the same reason `refresh` sends it, and the API
      // reads the two sources in the same order: body first, cookie second. The
      // web has nothing to put here and its cookie speaks for it. Native has no
      // cookie — omit this and `/auth/logout` revokes nothing, so a signed-out
      // phone leaves a live refresh token on the server until it expires, and
      // the local delete below is the only thing that ever happened.
      const stored = await store.read();
      await apiRequest("/auth/logout", {
        method: "POST",
        body: stored ? { refresh_token: stored } : {},
      });
    } catch {
      // Swallowed, and this is the one place that is right: signing out is a
      // local act that the server is merely told about. Every caller's next line
      // navigates to the signed-out screen, and a rejection here would skip it —
      // leaving someone who has no session looking at a signed-in surface.
    } finally {
      // Even if the call fails, drop the local session — the user asked to
      // leave. Awaited so a native caller navigating to /login on the next line
      // cannot race the Keychain write and find the old token still there.
      await clearSession();
    }
  }, [clearSession, store]);

  const authedRequest = useCallback<AuthContextValue["authedRequest"]>(
    async (path, options = {}) => {
      try {
        return await apiRequest(path, { ...options, accessToken: accessToken.current });
      } catch (error) {
        // Access tokens are short-lived; one 401 is expected, so rotate and retry.
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if (!(await refresh())) throw error;
        return await apiRequest(path, { ...options, accessToken: accessToken.current });
      }
    },
    [refresh],
  );

  const syncUser = useCallback((updated: UserMe) => setUser(updated), []);

  const value = useMemo(
    () => ({ user, isLoading, register, login, logout, authedRequest, syncUser }),
    [user, isLoading, register, login, logout, authedRequest, syncUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside an <AuthProvider>.");
  }
  return context;
}
