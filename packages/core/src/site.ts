/**
 * The strings that describe the product rather than any one screen.
 *
 * These were previously either inlined at a single call site (the root
 * `metadata`) or nowhere at all. The footer, the About page and both policy
 * pages all need the same handful, and a contact address that is right in three
 * places and stale in the fourth is worse than one that lives in one file.
 *
 * Everything here is a plain constant rather than an env var: none of it varies
 * by deployment, and a value the build can inline is one fewer thing that can be
 * missing in production.
 *
 * This started in `apps/web/src/lib/site.ts` and moved here when the phone grew
 * the same three pages, for exactly the reason the paragraph above gives — one
 * client's contact address going stale is the same bug as one page's, and a
 * support address that differs between a phone and a browser is worse than
 * either.
 */

export const SITE_NAME = "Sidequestd";

/** No trailing slash — `new URL(path, SITE_URL)` and `metadataBase` both want it that way. */
export const SITE_URL = "https://sidequestd.app";

/** The landing headline, in one line. Also the footer's line under the mark. */
export const SITE_TAGLINE = "Every game you've played, written down.";

export const SITE_DESCRIPTION =
  "Rate and review the games you play, keep a backlog you actually maintain, and follow what your friends are playing.";

/**
 * Where support, privacy requests and account deletions arrive.
 *
 * Both policy pages point here, so this address has to be real and monitored
 * before those pages are public.
 */
export const CONTACT_EMAIL = "hello@sidequestd.app";

/**
 * Bumped by hand alongside the two `package.json`s. Shown in the web footer and
 * at the bottom of the phone's About screen.
 *
 * Deliberately not read from either app's manifest: this is the *product's*
 * version, and the two clients ship on their own schedules — a phone build sat
 * in review for a week is not a different Sidequestd from the web it was cut
 * alongside.
 */
export const APP_VERSION = "0.1.0";

/** The "last updated" date on /privacy and /terms. Bump when either changes. */
export const POLICY_UPDATED = "August 16, 2026";

/** Where the catalog comes from. Credited in the footer and on /about. */
export const IGDB_URL = "https://www.igdb.com";
