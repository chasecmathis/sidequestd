"use client";

/**
 * Session state for the web client.
 *
 * The access token is held in React state only — never localStorage — so an
 * injected script has nothing durable to steal. Durability comes from the
 * httpOnly refresh cookie: on mount we call /auth/refresh once, and a valid
 * cookie silently restores the session across reloads.
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // A ref, not state: request helpers need the current token synchronously and
  // must not re-render every consumer when it rotates.
  const accessToken = useRef<string | null>(null);

  const applySession = useCallback((session: AuthSession) => {
    accessToken.current = session.access_token;
    setUser(session.user);
  }, []);

  const clearSession = useCallback(() => {
    accessToken.current = null;
    setUser(null);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const session = await apiRequest<AuthSession>("/auth/refresh", {
        method: "POST",
        body: {},
      });
      applySession(session);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }, [applySession, clearSession]);

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
      applySession(session);
    },
    [applySession],
  );

  const login = useCallback<AuthContextValue["login"]>(
    async (identifier, password) => {
      const session = await apiRequest<AuthSession>("/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST", body: {} });
    } finally {
      // Even if the call fails, drop the local session — the user asked to leave.
      clearSession();
    }
  }, [clearSession]);

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
