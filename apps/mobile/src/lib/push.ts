/**
 * Push notifications: the permission, the address, and what the OS does with
 * one that arrives.
 *
 * The fourth native seam, after the session store, the theme storage and the
 * media picker — and the only one of the four with no web half at all. A browser
 * has no device to register and no lock screen to draw on, so nothing here is
 * shared and nothing here belongs in `@sidequestd/core`.
 *
 * **The badge is not this file's job to be correct.** `NotificationsProvider`
 * polls `/notifications/unread-count` every 60 seconds, on both clients, and
 * that stays the floor: a reader who declines the permission — or whose phone is
 * an emulator, or who is running in Expo Go — must still get a right number.
 * What push adds is *sooner*, and a badge on the app icon for someone who never
 * opens the app at all. Every function below can fail and the app is only
 * slower to notice things, never wrong about them.
 *
 * Which is why nothing here throws. A denied permission, a missing project id, a
 * simulator with no APNs registration — all of them are ordinary states of a
 * real installation, not errors to surface to somebody who was trying to sign
 * in.
 *
 * ## What this needs to actually deliver
 *
 * A **development build or a store build**, not Expo Go: remote push was removed
 * from Expo Go in SDK 53, so `register` there gets as far as the permission and
 * then finds no token. And an **EAS project id** — `extra.eas.projectId` in
 * `app.json`, written by `eas init` — because that is what the Expo push service
 * resolves a token against. Without it `getExpoPushTokenAsync` throws, which is
 * caught and logged here rather than being allowed to take a launch with it.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

import type { DevicePlatform, DeviceRegistered } from "@sidequestd/api-types";

/** What `POST`/`DELETE` here are called. Native-only, so not in `core`. */
const DEVICES_PATH = "/users/me/devices";

/**
 * The Android channel every push names.
 *
 * Android 8 and up will not show a notification whose channel does not exist,
 * and the channel — not the payload — is what owns the sound, the light and
 * whether it appears as a heads-up banner. So it is created once at launch, and
 * `app.services.push` names the same id on the way out. The two have to agree,
 * which is why the constant is quoted in both files.
 */
const CHANNEL_ID = "default";

/**
 * How a notification arriving while the app is *open* is treated.
 *
 * Banner and sound, no list entry: the in-app inbox is the list, and letting the
 * OS also keep one would mean two places showing the same seven things with two
 * different ideas of what is unread. The badge is left alone here for the same
 * reason — `NotificationsProvider` owns that number, and a handler that also set
 * it would be a second writer racing the first.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowList: false,
  }),
});

/** iOS or Android, in the API's spelling. */
function platform(): DevicePlatform {
  return Platform.OS === "ios" ? "IOS" : "ANDROID";
}

/**
 * The EAS project this build belongs to.
 *
 * Read from two places because the two build paths write it to different ones —
 * `easConfig` in a development build, `extra.eas` in a bare app config — and a
 * function that only checked one would report a correctly configured project as
 * unconfigured.
 */
function projectId(): string | null {
  const fromEas = Constants.easConfig?.projectId;
  const fromExtra = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
    ?.projectId;
  return fromEas ?? fromExtra ?? null;
}

/**
 * Ask for the permission, if it has not been answered already.
 *
 * `getPermissionsAsync` first, always. Asking again after a refusal does nothing
 * on either platform — iOS shows the system prompt exactly once per install —
 * so the only thing a blind `requestPermissionsAsync` achieves is a prompt on
 * every launch for the reader who said yes.
 */
async function permitted(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // `canAskAgain` false means the reader has refused and the only way back is
  // the Settings app. Prompting anyway resolves instantly with a denial.
  if (!existing.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * This installation's push token, or null when there cannot be one.
 *
 * Null is the common case in development and is not a failure: a simulator has
 * no APNs registration, Expo Go has had no remote push since SDK 53, and a
 * project with no id has nothing for the push service to resolve against.
 */
export async function pushToken(): Promise<string | null> {
  // A simulator can hold the permission and still never receive anything, so
  // there is nothing to register. Android emulators with Play Services are the
  // exception and `Device.isDevice` reports them honestly.
  if (!Device.isDevice) return null;

  try {
    if (!(await permitted())) return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Notifications",
        importance: Notifications.AndroidImportance.DEFAULT,
        // Left to the system rather than tinted with the accent: this colours
        // the notification LED and the small status-bar icon on some skins, and
        // the orchid at that size against an unknown wallpaper is a smudge.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const id = projectId();
    if (!id) {
      if (__DEV__) {
        console.warn(
          "[push] No EAS project id, so no push token. Run `eas init`, or ignore this — " +
            "the unread badge still polls.",
        );
      }
      return null;
    }

    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch (cause) {
    if (__DEV__) console.warn("[push] Could not get a push token:", cause);
    return null;
  }
}

type AuthedRequest = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

/**
 * Put this device on file for whoever is signed in.
 *
 * Called on every launch with a session rather than once ever, because the OS
 * can reissue a token at any time — after a restore, a reinstall, or a long
 * enough silence — and a client that registered once would go quiet without any
 * signal that it had. The endpoint is an upsert, so the repetition costs one
 * request and no rows.
 *
 * Returns whether the deployment says it can actually deliver, so a caller can
 * tell "registered" from "registered, and nothing will ever come of it".
 */
export async function registerDevice(authedRequest: AuthedRequest): Promise<boolean> {
  const token = await pushToken();
  if (!token) return false;

  try {
    const result = await authedRequest<DeviceRegistered>(DEVICES_PATH, {
      method: "POST",
      body: { token, platform: platform() },
    });
    return result.push_enabled;
  } catch (cause) {
    if (__DEV__) console.warn("[push] Could not register this device:", cause);
    return false;
  }
}

/**
 * Take this device off file — what signing out sends, *before* the session goes.
 *
 * Order is the whole of it: the endpoint needs the access token, and `logout`
 * clears it. Get this wrong and the phone stays registered to an account nobody
 * is signed into on it, which is a stranger's notifications on a lock screen.
 *
 * The server has a second line of defence — registering a token that already
 * exists moves it to the new owner rather than duplicating it — but that one
 * only fires when somebody else signs in on this phone, which may be never.
 *
 * `getExpoPushTokenAsync` rather than a remembered value, because the token this
 * install is *currently* addressed by is the one that has to go, and it may have
 * been reissued since the launch that registered it.
 */
export async function forgetDevice(authedRequest: AuthedRequest): Promise<void> {
  try {
    const token = await pushToken();
    if (!token) return;

    // Brackets in `ExponentPushToken[…]` are not path-safe.
    await authedRequest(`${DEVICES_PATH}/${encodeURIComponent(token)}`, { method: "DELETE" });
  } catch (cause) {
    // Swallowed for the same reason `logout` swallows its own failure: signing
    // out is a local act the server is merely told about, and a caller whose
    // next line navigates to /login must not be stopped from getting there.
    if (__DEV__) console.warn("[push] Could not deregister this device:", cause);
  }
}

/**
 * The number on the app icon.
 *
 * Set from the same count the in-app badge uses, so the two cannot disagree —
 * the alternative is a home screen saying 3 over an app that says 0. Pushes
 * carry a badge of their own for the case where the app is not running to be
 * told; this is what corrects it the moment it is.
 */
export async function setIconBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // Android launchers vary in whether they support one at all, and a home
    // screen that shows no number is not a broken app.
  }
}

/**
 * Where a notification says to go, if it said.
 *
 * The API resolves the path when it composes the push (`deep_link_path` in
 * `app.services.push`), because a tap can arrive at an app that was not running
 * — there is no loaded inbox to look the row up in, and a cold launch that has
 * to fetch before it can navigate is a tap that does nothing on a train.
 */
export function pathFromNotification(
  response: Notifications.NotificationResponse | null,
): string | null {
  const data = response?.notification.request.content.data;
  const path = data?.path;
  return typeof path === "string" && path.startsWith("/") ? path : null;
}
