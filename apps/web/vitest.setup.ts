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

afterEach(cleanup);
