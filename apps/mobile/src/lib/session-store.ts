/**
 * Where the refresh token lives on a phone — the `SessionStore` seam from
 * `@sidequestd/core`, backed by the Keychain (iOS) and the Keystore-encrypted
 * store (Android).
 *
 * This is the native half of the split `auth.tsx` describes: the web is issued
 * an httpOnly cookie and its store is a pair of no-ops, because the token never
 * enters JavaScript at all. Native has no such thing, so the token *is* in
 * JavaScript and the only question left is where it sleeps between launches.
 * `expo-secure-store` is the answer and `AsyncStorage` is not — that one is
 * plaintext on disk, readable by anything with a file browser on a rooted
 * device or out of an unencrypted backup, and it is where a refresh token
 * becomes a permanent account key rather than a session.
 *
 * The mirror of `theme/storage.ts`, which chooses `AsyncStorage` for the exact
 * opposite reason: a colour preference is not a credential.
 *
 * ---
 *
 * **Every method swallows its failures.** A Keychain that cannot be read or
 * written is not something a reader can act on, and each failure has a sane
 * meaning without an exception:
 *
 *   - `read` fails → treated as no session, so the app opens signed out. The
 *     wrong outcome for the reader; the only safe one for the app.
 *   - `write` fails → this session still works, since the access token lives in
 *     memory. Only its survival across a restart is lost.
 *   - `write(null)` fails → the local session is gone regardless, and by then
 *     `/auth/logout` has already revoked the token server-side. Throwing here
 *     would reject `logout()` mid-`finally` and strand a signed-out reader on a
 *     signed-in screen.
 */
import * as SecureStore from "expo-secure-store";

import type { SessionStore } from "@sidequestd/core";

/**
 * Namespaced rather than `refresh-token`: the Keychain is per-app but the
 * Android store is a file this app shares with every library in it.
 */
const KEY = "sidequestd.refresh-token";

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, which is two decisions.
 *
 * *When unlocked* — the app only ever refreshes in the foreground, so the token
 * is never wanted while the phone is locked. (Phase 6's background push handling
 * is what would change this, and the weakest thing that would do is
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. It should not be loosened before there
 * is code that needs it.)
 *
 * *This device only* — the item is excluded from iCloud Keychain and encrypted
 * backups, so restoring a backup onto a second phone does not clone a live
 * session onto it. The reader signs in again there, which is the correct amount
 * of friction for a credential.
 *
 * `requireAuthentication` is deliberately left off: a Face ID prompt on every
 * cold start, to read a token the app immediately trades for a new one, would be
 * a gate on the app rather than on anything secret.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureSessionStore: SessionStore = {
  read: async () => {
    try {
      return await SecureStore.getItemAsync(KEY, OPTIONS);
    } catch {
      // Most often a value this build can no longer decrypt — an Android
      // Keystore key invalidated by a lock-screen change, or a keychain item
      // written under different options. It will never be readable again, so
      // clearing it stops every future launch from failing the same way.
      await secureSessionStore.write(null);
      return null;
    }
  },

  write: async (token) => {
    try {
      if (token === null) {
        await SecureStore.deleteItemAsync(KEY, OPTIONS);
      } else {
        await SecureStore.setItemAsync(KEY, token, OPTIONS);
      }
    } catch {
      // See the header: nothing here is actionable, and each failure degrades to
      // "this session is not durable" rather than to a broken app.
    }
  },
};
