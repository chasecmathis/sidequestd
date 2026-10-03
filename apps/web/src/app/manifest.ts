import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@sidequestd/core";

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * Next links this into every document on its own once the file exists, so
 * nothing in `layout.tsx` has to know about it.
 *
 * What it buys: "Add to Home Screen" produces the real mark instead of a
 * screenshot of whatever page was open, and the installed window opens on the
 * app's own canvas rather than a white flash. That is the whole ambition — this
 * is not a claim to be an offline-capable PWA, and there is no service worker
 * behind it.
 *
 * The icons are the three files in `public/`, not `app/icon.png`: a manifest
 * needs URLs it can write down, and Next serves the `app/` icon conventions
 * from a content-hashed path that changes whenever the file does.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    /* The dark canvas, matching the `<meta name="theme-color">` an installed
       window would otherwise contradict. `background_color` is what the OS
       paints while the app is starting, before any CSS has loaded — the one
       colour that has to be a literal, since nothing has read a token yet. */
    background_color: "#0a090d",
    theme_color: "#0a090d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      /* Separate file rather than `purpose: "any maskable"` on the one above.
         A launcher crops a maskable icon to its own shape, so the mark inside
         is pulled well in from the edges; declaring that same artwork as `any`
         would leave it floating in the middle of a plain square everywhere
         else. Two purposes, two crops. */
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
