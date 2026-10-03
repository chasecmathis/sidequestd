/**
 * The two strings the theme is addressed by, in a module with no `"use client"`
 * on it.
 *
 * They look like they belong in `theme.tsx` beside everything else, and they
 * were there first. They cannot be: that file is a client module, so when the
 * root layout — a server component — imports from it, Next hands back a client
 * *reference* rather than the module. The constants come through as `undefined`,
 * with no error and no build warning, and the pre-paint script quietly compiles
 * to `localStorage.getItem(undefined)`.
 *
 * The symptom is worth writing down, because nothing about it points here: the
 * page resolves to light for everyone, on every first paint, whatever their
 * device or their stored preference says — and then corrects itself the instant
 * React hydrates, so it only ever looks like a flash.
 *
 * A plain module is importable from both sides, which is the whole fix.
 */

/** Where the reader's choice is kept. Read by `theme.tsx` and by the script in
 *  `layout.tsx`, which is the pair that must not drift. */
export const THEME_STORAGE_KEY = "sidequestd-theme";

export const DARK_QUERY = "(prefers-color-scheme: dark)";
