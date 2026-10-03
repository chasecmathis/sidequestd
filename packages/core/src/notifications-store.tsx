"use client";

/**
 * The unread badge, shared by the nav and the tab (SPEC §6.12).
 *
 * Only the *count* lives here, never the list. The badge is on every screen and
 * the list is on one, so holding the list in a provider would mean every screen
 * paying for a page of notifications nobody is looking at.
 *
 * It is polled, because delivery in this version is in-app only — SPEC §6.12
 * names push as post-MVP — so there is nothing to push the number down. The poll
 * is a floor rather than the mechanism: marking something read updates the count
 * from the same response that did the marking, so the badge moves immediately
 * and the poll only ever catches what arrived from somebody else.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "./auth";
import { UNREAD_POLL_MS } from "./notifications";
import type { NotificationReadResult, UnreadCount } from "@sidequestd/api-types";

interface NotificationsContextValue {
  /** Unread notifications for the signed-in user; 0 when signed out. */
  unreadCount: number;
  /** Mark some read, or all of them when `ids` is omitted. */
  markRead: (ids?: string[]) => Promise<void>;
  /** Re-ask now — for a screen that has just changed something. */
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, authedRequest } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  // Bumped to re-run the effect on demand. A number rather than a boolean so two
  // refreshes in a row are two runs and not one.
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((current) => current + 1), []);

  useEffect(() => {
    if (!user) {
      // Signing out has to clear it: a badge left over from the last session is
      // a number about somebody who is no longer here.
      setUnreadCount(0);
      return;
    }

    let cancelled = false;
    const ask = () => {
      authedRequest<UnreadCount>("/notifications/unread-count")
        .then((body) => {
          if (!cancelled) setUnreadCount(body.count);
        })
        .catch(() => {
          // A badge is not worth an error message. The next poll tries again.
        });
    };

    ask();
    const timer = setInterval(ask, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, authedRequest, tick]);

  const markRead = useCallback(
    async (ids?: string[]) => {
      const result = await authedRequest<NotificationReadResult>("/notifications/read", {
        method: "POST",
        // `undefined` for "all": an empty array means "none" to the API, which is
        // the one mistake this whole call could make.
        body: { ids: ids ?? null },
      });
      // The server's number rather than a subtraction: something may have
      // arrived between the page loading and the button being pressed.
      setUnreadCount(result.unread_count);
    },
    [authedRequest],
  );

  const value = useMemo(
    () => ({ unreadCount, markRead, refresh }),
    [unreadCount, markRead, refresh],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (context === null) {
    throw new Error("useNotifications must be used inside a <NotificationsProvider>.");
  }
  return context;
}
