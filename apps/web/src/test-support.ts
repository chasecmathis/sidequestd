import { act } from "@testing-library/react";

/**
 * Let `ms` of real time pass with React's work queue open.
 *
 * A few tests assert that something *did not* happen — no fetch while the
 * session is still loading, no second poll after one settled — and the only way
 * to show that is to wait and look. `findBy`/`waitFor` already run their polling
 * inside `act`, but a bare `await new Promise(setTimeout)` does not, so anything
 * React flushes during that window lands outside it and prints "an update … was
 * not wrapped in act". In jsdom that is usually not our code at all: `next/link`
 * finds no `IntersectionObserver`, falls back to `requestIdleCallback` to decide
 * a link is visible enough to prefetch, and sets state ~1ms after mount.
 */
export function settle(ms = 20): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
