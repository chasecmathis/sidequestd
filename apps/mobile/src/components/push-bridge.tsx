/**
 * Everything that has to happen *because* the app runs on a phone.
 *
 * It renders nothing. It exists because four separate facts — a session, an
 * unread count, an operating system that delivers notifications, and a navigator
 * — only meet inside the providers, and a component is the only place inside
 * them where an effect can live.
 *
 * Four jobs, in the order they matter:
 *
 *   1. **Register on sign-in, forget on sign-out.** Registration is here rather
 *      than in the login screen because it has to happen on every launch with a
 *      live session, not on the launches that happened to include a login. The
 *      *forget* half cannot be here — it needs the access token that signing out
 *      destroys — so `app/settings/index.tsx` sends it before calling `logout`.
 *   2. **Refresh the badge when a push lands.** The push already carries the
 *      right number for the icon; this is what moves the number *inside* the app
 *      without waiting up to sixty seconds for the next poll.
 *   3. **Route a tap.** Including the tap that woke a killed app, which arrives
 *      before any listener could have been added and has to be asked for.
 *   4. **Refresh on foreground.** No push involved and no permission needed —
 *      a phone that has been in a pocket for an hour is a phone whose badge is
 *      up to sixty seconds stale the moment it is looked at, and every native
 *      app corrects that on the way back in.
 *
 * The last one is the reason a reader who denied the permission still gets a
 * badge that feels alive.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";

import { useAuth, useNotifications } from "@sidequestd/core";

import { open } from "@/lib/navigate";
import { pathFromNotification, registerDevice, setIconBadge } from "@/lib/push";

export function PushBridge() {
  const { user, authedRequest } = useAuth();
  const { unreadCount, refresh } = useNotifications();

  const userId = user?.id ?? null;

  // The launch tap is answered once per app run. A remount — a sign-out and
  // back in, a fast refresh — must not re-navigate somebody who has since
  // walked away from wherever that notification pointed.
  const handledColdStart = useRef(false);

  // --- 1. The address on file -----------------------------------------------
  useEffect(() => {
    if (!userId) return;
    void registerDevice(authedRequest);
  }, [userId, authedRequest]);

  // --- 2 & 3. What the OS hands back ---------------------------------------
  useEffect(() => {
    if (!userId) return;

    // Arriving while the app is open. The banner is the handler's business; the
    // badge is ours, and a poll that is up to a minute away is not an answer
    // when the thing it would report is already on screen.
    const received = Notifications.addNotificationReceivedListener(() => refresh());

    // A tap, on a notification in the tray. `open` strips the `#comments`
    // fragment the API sends for a reply, which is the one thing a native
    // client cannot use — see `lib/navigate`.
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = pathFromNotification(response);
      if (path) open(path);
      // Refreshed either way: the tap is about a notification that exists, and
      // the badge should account for it even if the row had no target.
      refresh();
    });

    // The tap that *launched* the app. It happened before either listener above
    // could exist, so it has to be asked for — and only once, or every remount
    // of this component would re-navigate somebody who has since walked away
    // from wherever the notification pointed.
    let cancelled = false;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (cancelled || handledColdStart.current) return;
      handledColdStart.current = true;
      const path = pathFromNotification(response);
      if (path) open(path);
    });

    return () => {
      cancelled = true;
      received.remove();
      tapped.remove();
    };
  }, [userId, refresh]);

  // --- 4. Coming back to the app -------------------------------------------
  useEffect(() => {
    if (!userId) return;

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [userId, refresh]);

  // --- The number on the icon ----------------------------------------------
  useEffect(() => {
    // Cleared rather than left behind on sign-out: a badge from the last session
    // is a number about somebody who is no longer here, which is the same call
    // `NotificationsProvider` makes about its own count.
    void setIconBadge(userId ? unreadCount : 0);
  }, [userId, unreadCount]);

  return null;
}
