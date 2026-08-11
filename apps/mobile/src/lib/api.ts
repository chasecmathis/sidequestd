/**
 * API base URL for the native client.
 *
 * Native apps have no cookie jar we want to rely on, so when the auth screens
 * land here they will read the token pair out of the JSON body and keep the
 * refresh token in expo-secure-store (Keychain / Keystore) rather than in the
 * httpOnly cookie the web client uses.
 */
import Constants from "expo-constants";

export const API_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:8000";

export const API_PREFIX = "/api/v1";
