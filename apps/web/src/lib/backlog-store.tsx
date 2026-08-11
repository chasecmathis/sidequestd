"use client";

/**
 * The signed-in user's own backlog, shared across the screens that can change it.
 *
 * SPEC §6.9 puts "add to list" on Search, Game Detail and a review — three places
 * that each render a control which has to know whether the game in front of it is
 * already on a list. Asking per game would be a request per card, and asking per
 * screen would let two of them disagree the moment one was used.
 *
 * So the whole backlog is read once, as a `gameId -> status` map, and every
 * control reads and writes that. A backlog is human-scale (SPEC §6.9 caps nothing
 * but nobody tracks ten thousand games), which is what makes one request for all
 * of it the cheap option rather than the extravagant one.
 *
 * Loading is *lazy*: nothing is fetched until a control asks, so Home and the
 * profile do not pay for a request they have no use for.
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

import { statusByGame } from "@/lib/backlog";
import { useAuth } from "@/lib/auth";
import type { BacklogEntry, BacklogLists, BacklogStatus } from "@sidequestd/api-types";

interface BacklogContextValue {
  /** What list each game is on. Empty until something asks for it. */
  statuses: Map<string, BacklogStatus>;
  /** Called by a control on mount; the first caller triggers the one fetch. */
  ensureLoaded: () => void;
  /** Put a game on a list or move it. Resolves once the server has agreed. */
  setStatus: (gameId: string, status: BacklogStatus) => Promise<void>;
  /** Take a game off the backlog entirely. */
  clearStatus: (gameId: string) => Promise<void>;
}

const BacklogContext = createContext<BacklogContextValue | null>(null);

export function BacklogProvider({ children }: { children: ReactNode }) {
  const { user, authedRequest } = useAuth();
  const [statuses, setStatuses] = useState<Map<string, BacklogStatus>>(new Map());
  const [wanted, setWanted] = useState(false);

  // A ref so `ensureLoaded` is stable and safe to call from an effect on every
  // control: state here would re-render every consumer on the first mount.
  const asked = useRef(false);

  const ensureLoaded = useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    setWanted(true);
  }, []);

  useEffect(() => {
    if (!wanted || !user) return;

    let cancelled = false;
    authedRequest<BacklogLists>("/users/me/lists")
      .then((lists) => {
        if (!cancelled) setStatuses(statusByGame(lists));
      })
      .catch(() => {
        // A control that does not know the current status still offers every
        // list, which is the useful half. Failing loudly here would put an error
        // on a page that is about something else.
      });

    return () => {
      cancelled = true;
    };
  }, [wanted, user, authedRequest]);

  const setStatus = useCallback(
    async (gameId: string, status: BacklogStatus) => {
      const entry = await authedRequest<BacklogEntry>(`/backlog/${gameId}`, {
        method: "PUT",
        body: { status },
      });
      // The server's answer, not the requested one: it is the same value today,
      // and taking it from the response is what keeps this honest if it stops
      // being (a status the API declines to set, say).
      setStatuses((current) => new Map(current).set(gameId, entry.status));
    },
    [authedRequest],
  );

  const clearStatus = useCallback(
    async (gameId: string) => {
      await authedRequest(`/backlog/${gameId}`, { method: "DELETE" });
      setStatuses((current) => {
        const next = new Map(current);
        next.delete(gameId);
        return next;
      });
    },
    [authedRequest],
  );

  const value = useMemo(
    () => ({ statuses, ensureLoaded, setStatus, clearStatus }),
    [statuses, ensureLoaded, setStatus, clearStatus],
  );

  return <BacklogContext.Provider value={value}>{children}</BacklogContext.Provider>;
}

export function useBacklog(): BacklogContextValue {
  const context = useContext(BacklogContext);
  if (context === null) {
    throw new Error("useBacklog must be used inside a <BacklogProvider>.");
  }
  return context;
}
