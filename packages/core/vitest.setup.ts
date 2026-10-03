import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * A working `localStorage`.
 *
 * Not a gap in jsdom — jsdom implements this perfectly well. Node 22+ defines a
 * `localStorage` global of its own, and without `--localstorage-file` it is an
 * empty object with no methods on it, which shadows jsdom's. Anything calling
 * `localStorage.getItem` therefore dies on `not a function` rather than getting
 * a miss.
 *
 * `browserThemeStorage` survives that on its own — every access there is
 * wrapped, because Safari's private mode throws too — but a test asserting that
 * a preference was *stored* needs somewhere for it to go.
 */
if (typeof window !== "undefined" && typeof window.localStorage?.getItem !== "function") {
  const entries = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      get length() {
        return entries.size;
      },
    },
  });
}

afterEach(cleanup);
