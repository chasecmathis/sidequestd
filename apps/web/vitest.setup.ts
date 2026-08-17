import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * jsdom does not implement `matchMedia`, and Motion calls it on mount to read
 * `prefers-reduced-motion`. Without this every test that renders an animated
 * component throws before it reaches an assertion.
 *
 * It answers "no" to everything, which is the right default: tests should see
 * the animated code path, since that is what a browser renders.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }) as unknown as MediaQueryList;
}

/**
 * A working `localStorage`.
 *
 * Not a gap in jsdom — jsdom implements this perfectly well. Node 22+ defines a
 * `localStorage` global of its own, and without `--localstorage-file` it is an
 * empty object with no methods on it, which shadows jsdom's. Anything calling
 * `localStorage.getItem` therefore dies on `not a function` rather than getting
 * a miss.
 *
 * The theme provider survives that on its own — every access there is wrapped,
 * because Safari's private mode throws too — but a test asserting that a
 * preference was *stored* needs somewhere for it to go.
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
