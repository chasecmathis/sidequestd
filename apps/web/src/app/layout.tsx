import type { Metadata, Viewport } from "next";
import { Figtree, Instrument_Serif, JetBrains_Mono } from "next/font/google";

// From the `theme-keys` entry point rather than from the package root, and that
// import path is load-bearing: this file is a server component, while `theme.tsx`
// — which the root barrel re-exports these two through — is a client module whose
// exports would arrive here as references rather than values. The constants come
// through as `undefined`, with no error and no build warning, and the pre-paint
// script below quietly compiles to `localStorage.getItem(undefined)`.
//
// The symptom is worth writing down, because nothing about it points here: the
// page resolves to light for everyone, on every first paint, whatever their
// device or their stored preference says — and then corrects itself the instant
// React hydrates, so it only ever looks like a flash. See theme-keys.ts.
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@sidequestd/core";
import { DARK_QUERY, THEME_STORAGE_KEY } from "@sidequestd/core/theme-keys";

import { AppProviders } from "@/lib/providers";

import "./globals.css";

/**
 * Three faces, self-hosted by next/font — no CDN request, no layout shift, and
 * the CSP-friendliness comes free. Each is exposed as a variable that
 * globals.css turns into a Tailwind family.
 */

/** Headlines only, >=28px. A high-contrast serif is unreadable as UI text. */
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

/** Everything else. */
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

/** Micro-labels, ratings, counts, timestamps — anything that is data. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/**
 * The defaults every route inherits.
 *
 * `title.template` is the part that earns its keep: a page exports
 * `title: "About"` and the tab reads "About · Sidequestd", so no route has to
 * remember to append the product name and none of them can disagree about the
 * separator. `metadataBase` resolves the relative URLs Next puts in the Open
 * Graph tags — without it they ship as paths, which no social card renderer
 * will follow.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

/**
 * The colour behind the browser's own chrome on mobile — the status bar on iOS,
 * the toolbar on Android. Two entries rather than one because the OS picks by
 * media query, and a single value would leave a black bar sitting on top of the
 * light page. Each matches its mode's `--sq-canvas` exactly; they are literals
 * because this is emitted as a `<meta>` tag, where a `var()` means nothing.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a090d" },
  ],
};

/**
 * Resolve the theme before the first paint.
 *
 * This has to be a blocking inline script in `<head>`, not a `useEffect` and not
 * a deferred bundle: every route here prerenders to static HTML with no idea who
 * is asking, so without this the document paints in the default mode and then
 * corrects itself. That flash is the whole reason the file exists — a white page
 * strobing to black is far more unpleasant than the reverse, and a reader on
 * light mode would get it on every single navigation to a cold page.
 *
 * It duplicates a few lines of `lib/theme.tsx` because it cannot import them: it
 * runs before any module has loaded. The two are kept honest by
 * `THEME_STORAGE_KEY` and `DARK_QUERY` being interpolated from there rather than
 * retyped, so the pair that actually matters cannot drift.
 *
 * Note for whoever adds a Content-Security-Policy: there is none today, so an
 * inline script is fine. Under a CSP this needs a nonce, which means the layout
 * has to read one off the request and stop being statically rendered.
 */
const THEME_SCRIPT = `
try {
  var c = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (c !== "light" && c !== "dark") {
    c = matchMedia(${JSON.stringify(DARK_QUERY)}).matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = c;
} catch (e) {
  document.documentElement.dataset.theme = "dark";
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: the script above writes `data-theme` onto this
    // element before React arrives, so the server's markup and the DOM React
    // hydrates against necessarily differ by that one attribute. Scoped to this
    // element only — it does not extend to the tree below.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSerif.variable} ${figtree.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
