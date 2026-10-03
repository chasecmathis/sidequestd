/**
 * How this client talks to the API — the `configureApi` seam from
 * `@sidequestd/core`, taken at module scope.
 *
 * Module scope rather than an effect, for the reason the web's `providers.tsx`
 * spells out: a screen that fires a request during its first render must already
 * find the base URL set, and module evaluation is the only point guaranteed to
 * precede that. Importing this file for its side effect from the root layout is
 * what makes it happen before any screen mounts.
 *
 * `credentials: "omit"` is the whole of what makes this the *native* client. The
 * web is issued an httpOnly refresh cookie and sends `"include"`; a phone has no
 * cookie jar worth relying on, so it reads the refresh token out of the response
 * body and keeps it in the Keychain (`expo-secure-store`) — see
 * `lib/session-store.ts`. A fetch that quietly attached cookies here would be
 * carrying nothing and hiding the fact.
 */
import Constants from "expo-constants";

import { apiUrl, configureApi } from "@sidequestd/core";

/**
 * The port `npm run api:dev` and `npm run api:lan` serve on.
 *
 * Only used by the inference below, which is only used in development. A real
 * build is told its API address rather than guessing at one.
 */
const DEV_API_PORT = 8000;

/** Where a development machine is, when nothing has said otherwise. */
const DEV_FALLBACK = `http://localhost:${DEV_API_PORT}`;

/**
 * A host this app is willing to *infer* an API address from.
 *
 * `localhost` and a dotted-quad, and nothing else, because the interesting case
 * is the one that is wrong: behind `expo start --tunnel` the packager host is
 * something like `abc123.exp.direct`, which proxies Metro and only Metro. There
 * is no API on it, and pointing at one would produce a confusing failure a
 * long way from here.
 */
function isLocalHost(host: string): boolean {
  return host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * The dev machine's address, learned from the packager this app is already
 * talking to.
 *
 * `hostUri` is how Expo tells a running app where its bundle came from —
 * `192.168.1.235:8081` over LAN, `localhost:8081` on a simulator. That host is
 * the machine running Metro, which in development is also the machine running
 * the API, so it is the one thing on a phone that already knows the answer.
 *
 * This exists because the alternative is a hardcoded LAN address: a phone cannot
 * reach `localhost` — that is the phone's own loopback — so testing on hardware
 * used to mean editing `app.json` with whatever IP the router handed out that
 * morning, and remembering not to commit it.
 */
function packagerHost(): string | null {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host && isLocalHost(host) ? host : null;
}

/**
 * Configuration first, inference second.
 *
 *   1. `EXPO_PUBLIC_API_URL`, inlined at bundle time. The one-off override:
 *      point a dev client at staging without touching a file.
 *   2. `extra.apiUrl` from the app config, which is how a real build is told.
 *   3. The packager's host, in development only.
 *   4. `localhost`, which is right on a simulator and honest everywhere else.
 *
 * Inference never overrules something that was set on purpose — a build aimed at
 * production must not quietly re-aim itself at whatever laptop bundled it.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  if (configured) return configured;

  if (__DEV__) {
    const host = packagerHost();
    if (host) return `http://${host}:${DEV_API_PORT}`;
  }

  return DEV_FALLBACK;
}

configureApi({ baseUrl: resolveBaseUrl(), credentials: "omit" });

/** Where requests are going. For the debug line on the design-system screen. */
export { apiUrl };

/** A loopback origin at the start of a URL, with its port left alone. */
const LOOPBACK_ORIGIN = /^(https?:\/\/)(?:localhost|127\.0\.0\.1)(?=[:/]|$)/i;

/**
 * A media URL the phone can actually reach.
 *
 * Everything above resolves where the *API* is. This resolves where the things
 * the API points at are, which in development is a different machine-local
 * service and therefore a second copy of the same problem.
 *
 * The API builds an avatar or a review photo's URL from `S3_ENDPOINT_URL`, which
 * defaults to `http://localhost:9000` — the MinIO container from
 * `infra/docker-compose.yml`. That URL is correct for the web client, which runs
 * in a browser on the machine MinIO is on. It is meaningless on a phone, where
 * `localhost` is the phone: every avatar and every uploaded photo renders as a
 * blank rectangle, while game cover art — absolute `https://images.igdb.com`
 * URLs — renders fine. The bytes were uploaded and stored correctly; nothing but
 * the address is wrong.
 *
 * So a loopback host in a media URL is rewritten to the packager's host, the way
 * the API's own address already is. The port is deliberately kept: this is not
 * "point at the API", it is "point at the same machine", and in development
 * MinIO, the API and Metro are all on it.
 *
 * Three things it does not do, and each is the point:
 *
 *   - **Nothing outside development.** A production build must never rewrite an
 *     address the server gave it; there `S3_PUBLIC_URL_BASE` names a CDN and
 *     this function is the identity.
 *   - **Nothing to a host that is not loopback.** An IGDB cover, a CDN URL and a
 *     staging bucket all pass through untouched.
 *   - **Nothing when the packager host is not loopback either.** Behind
 *     `expo start --tunnel` there is no LAN address to be had, and inventing one
 *     would trade a blank image for a hanging request.
 *
 * The alternative fix is one line in `apps/api/.env` — `S3_PUBLIC_URL_BASE`
 * pointed at the machine's LAN address — and it is the better answer for a
 * shared or long-lived environment. This exists because that line has to be
 * re-edited whenever the router hands out a different address, which is the
 * exact chore `packagerHost` was added to abolish.
 */
export function mediaUrl(url: string): string;
export function mediaUrl(url: string | null | undefined): string | null;
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!__DEV__) return url;

  const host = packagerHost();
  if (host === null || host === "localhost") return url;

  return url.replace(LOOPBACK_ORIGIN, `$1${host}`);
}
