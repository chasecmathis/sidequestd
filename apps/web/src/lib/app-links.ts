/**
 * Telling iOS and Android that this domain and that app are the same product.
 *
 * Both platforms answer the same question — "may `app.sidequestd.client` open
 * links to sidequestd.app?" — and both answer it by fetching a file from this
 * server before they will honour a single link. Apple's is
 * `/.well-known/apple-app-site-association`; Google's is
 * `/.well-known/assetlinks.json`. This module builds both payloads; the two
 * route handlers under `app/.well-known/` are the four lines that serve them.
 *
 * ## Why the app needs to win one URL
 *
 * Exactly one link in this product cannot be allowed to finish in a browser: the
 * password-reset link. A reset completed on the web leaves the new password in
 * an account the *app* is still signed out of, and the phone in somebody's hand
 * has no way to be handed that session — so the reader who asked to reset from
 * the app ends up back at a sign-in screen typing the password they just set.
 * A universal link puts the reset on the device that asked for it.
 *
 * It is also why this is not a `sidequestd://` link, which is what the Steam
 * callback uses and what an earlier plan assumed would work here too. That
 * redirect is safe to aim at a custom scheme because the app itself opened the
 * browser it lands in — same device, same minute, guaranteed audience. A reset
 * email is read wherever somebody keeps their mail, very often a laptop, and a
 * `sidequestd://` link there is a dead end that reports nothing. An `https://`
 * link is the only one that is correct on both: the app takes it when the app is
 * installed, and the web page takes it the rest of the time. Nothing in the API
 * changes — `request_password_reset` already builds exactly this URL out of
 * `WEB_APP_URL`.
 *
 * ## Absent beats wrong
 *
 * Both builders return null when their deployment value is missing, and both
 * routes answer 404 rather than serving a file with a placeholder in it. That is
 * deliberate and it is the one operational trap here: Apple does not fetch this
 * file from the device, it fetches it through a CDN that caches the answer for
 * up to 24 hours. A file naming the wrong Team ID therefore breaks association
 * for a day *after* the value is corrected, where a 404 breaks nothing — the OS
 * simply never associates, links keep opening the web, and the reset still
 * works. There is no state to undo.
 *
 * ## Where the scoping lives, and why it is not in the same place twice
 *
 * The asymmetry below is real and catches people out:
 *
 * - **iOS scopes here.** `components` names the paths the app may claim, so this
 *   file grants `/reset-password` and nothing else.
 * - **Android scopes in the app.** `handle_all_urls` is the only relation there
 *   is; the fingerprint file grants the whole host unconditionally, and the
 *   *app's* intent filter (`pathPrefix: "/reset-password"` in `app.json`) is
 *   what narrows it. Widening the Android side is an app release, not a config
 *   change — which is the safer direction for the mistake to run in.
 */

/** Matches `bundleIdentifier` / `package` in `apps/mobile/app.json`. */
const APP_ID = "app.sidequestd.client";

/**
 * The one path the app may claim.
 *
 * Every other route on this domain has an app screen too — a review, a profile,
 * a game — and adding them here is a one-line change. It is deliberately not
 * made as part of this: it would change what happens when somebody taps a
 * Sidequestd link in Messages, on every device with the app installed, which is
 * a product decision and not a consequence of fixing a password reset.
 */
const RESET_PATH = "/reset-password";

export interface AppleAppSiteAssociation {
  applinks: {
    details: { appIDs: string[]; components: Record<string, unknown>[] }[];
  };
}

export interface AndroidAssetLink {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}

/**
 * Apple's half, or null when `APPLE_TEAM_ID` is unset.
 *
 * The Team ID is the ten-character prefix on the app identifier — Apple Developer
 * → Membership details, or the `DEVELOPMENT_TEAM` an EAS build reports. It is
 * not a secret; it is here rather than in the file because it differs between
 * whoever's account a given deployment builds under, and a wrong one is the
 * cached-for-a-day failure above.
 *
 * The modern `appIDs`/`components` spelling only. The legacy `apps: []` and
 * `paths: []` form is for iOS 12 and earlier, and Expo SDK 54 will not run
 * below iOS 15.
 */
export function appleAppSiteAssociation(
  teamId = process.env.APPLE_TEAM_ID,
): AppleAppSiteAssociation | null {
  const team = teamId?.trim();
  if (!team) return null;

  return {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${APP_ID}`],
          components: [
            {
              "/": RESET_PATH,
              // The query is deliberately unconstrained. A tokenless
              // `/reset-password` opening the app is the *right* outcome — the
              // screen has a branch that says the link is missing its token and
              // points at "request a new one" — and a pattern that only matched
              // `?token=…` would send that case to a browser instead, which is
              // a worse answer to the same mistake.
              comment: "Password reset. The one link the app has to win.",
            },
          ],
        },
      ],
    },
  };
}

/**
 * Google's half, or null when `ANDROID_CERT_FINGERPRINTS` is unset.
 *
 * Comma-separated, because there are normally **two** and shipping one is the
 * common way this half silently half-works: the upload key you sign with, and
 * the key Play App Signing re-signs with before distribution. `eas credentials`
 * prints the first; the Play Console's App integrity page prints the second, and
 * that is the one installs from the store are actually verified against.
 */
export function androidAssetLinks(
  fingerprints = process.env.ANDROID_CERT_FINGERPRINTS,
): AndroidAssetLink[] | null {
  const certs = (fingerprints ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (certs.length === 0) return null;

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: APP_ID,
        sha256_cert_fingerprints: certs,
      },
    },
  ];
}
