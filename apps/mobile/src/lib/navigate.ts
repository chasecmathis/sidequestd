/**
 * Going somewhere, from a path the shared package built.
 *
 * `profilePath`, `reviewPath` and the rest live in `@sidequestd/core` and return
 * plain strings, because they are the *same* strings the web routes on — that is
 * the point of them being shared. Expo Router wants an `Href`, which is a union
 * of the route literals it generated from `app/`, so every one of those strings
 * needs the same cast at the call site.
 *
 * One cast here rather than thirty out there, and one place to say why it is
 * safe: the route tree under `app/` mirrors the web's, and `core`'s own tests
 * pin the shapes these builders produce. If a route is renamed on one side only,
 * this is where the mismatch will be found — so the two must be moved together.
 */
import { router, type Href } from "expo-router";

/**
 * Drops a `#fragment`, because native has no anchors.
 *
 * Two of core's builders produce one — `commentsPath` and `notificationHref`,
 * both pointing at `/reviews/{id}#comments` — and on the web the fragment is the
 * whole point: it scrolls the thread into view on a page that is taller than the
 * viewport. Expo Router has nothing to do with it and would look for a route
 * literally called `#comments`, so a tapped reply would land on the not-found
 * screen rather than on the review it is about.
 *
 * Stripping it here rather than at the two call sites keeps the rule where the
 * other web-path reconciliation already lives: any path core hands over is safe
 * to pass to these two functions. The review screen renders its comments in the
 * same scroll, so the destination is right — only the scroll position is lost,
 * and a 390pt screen was never going to honour it the same way regardless.
 */
function toHref(path: string): Href {
  const hash = path.indexOf("#");
  return (hash === -1 ? path : path.slice(0, hash)) as Href;
}

/** Push a screen. The back gesture returns to where the reader was. */
export function open(path: string) {
  router.push(toHref(path));
}

/** Replace the current screen. For a redirect the reader must not walk back into. */
export function openReplacing(path: string) {
  router.replace(toHref(path));
}
