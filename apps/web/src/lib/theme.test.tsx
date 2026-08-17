import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "./theme";

/**
 * A `matchMedia` that answers honestly and can change its mind.
 *
 * The global stub in vitest.setup.ts answers `matches: false` to every query,
 * which is the right default everywhere else but would silently pin this suite
 * to light and make the system-preference tests assert nothing. It also has no
 * way to fire a change, which is half of what is under test here.
 *
 * Installed per-test rather than by editing the global stub, because the other
 * suites depend on that one's behaviour for Motion.
 */
function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  let dark = prefersDark;

  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return dark;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      dispatchEvent: vi.fn(() => false),
    }) as unknown as MediaQueryList) as typeof window.matchMedia;

  /** Flip the OS preference and tell whoever subscribed, like a real one would. */
  return function setSystemDark(next: boolean) {
    dark = next;
    act(() => {
      listeners.forEach((listener) => listener());
    });
  };
}

/** Renders the two values a consumer can see, plus buttons to change them. */
function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <div>
      <output data-testid="choice">{theme}</output>
      <output data-testid="resolved">{resolved}</output>
      <button onClick={() => setTheme("light")}>pick light</button>
      <button onClick={() => setTheme("dark")}>pick dark</button>
      <button onClick={() => setTheme("system")}>pick system</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

const choice = () => screen.getByTestId("choice").textContent;
const resolved = () => screen.getByTestId("resolved").textContent;
const attribute = () => document.documentElement.dataset.theme;

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("ThemeProvider", () => {
  it("follows the device when nothing has been chosen", () => {
    mockMatchMedia(true);
    renderProbe();

    expect(choice()).toBe("system");
    expect(resolved()).toBe("dark");
    expect(attribute()).toBe("dark");
  });

  it("resolves to light when the device asks for light", () => {
    mockMatchMedia(false);
    renderProbe();

    expect(choice()).toBe("system");
    expect(resolved()).toBe("light");
    expect(attribute()).toBe("light");
  });

  it("tracks the device while the choice is still System", () => {
    const setSystemDark = mockMatchMedia(false);
    renderProbe();
    expect(resolved()).toBe("light");

    setSystemDark(true);

    expect(resolved()).toBe("dark");
    expect(attribute()).toBe("dark");
    // Following the device is not the same as having picked a side.
    expect(choice()).toBe("system");
  });

  it("stops tracking the device once a side is picked", async () => {
    const setSystemDark = mockMatchMedia(false);
    renderProbe();

    await userEvent.click(screen.getByRole("button", { name: "pick dark" }));
    expect(resolved()).toBe("dark");

    // The whole point of an explicit choice: the OS switching to light at dawn
    // must not quietly undo it.
    setSystemDark(false);

    expect(choice()).toBe("dark");
    expect(resolved()).toBe("dark");
    expect(attribute()).toBe("dark");
  });

  it("starts tracking the device again when System is chosen back", async () => {
    const setSystemDark = mockMatchMedia(false);
    renderProbe();

    await userEvent.click(screen.getByRole("button", { name: "pick dark" }));
    await userEvent.click(screen.getByRole("button", { name: "pick system" }));

    expect(resolved()).toBe("light");

    setSystemDark(true);
    expect(resolved()).toBe("dark");
  });

  it("persists the choice rather than the resolved value", async () => {
    mockMatchMedia(true);
    renderProbe();

    await userEvent.click(screen.getByRole("button", { name: "pick system" }));

    // "system" and not "dark": storing what was resolved is how a preference
    // silently stops following the device on the next page load.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("restores a stored choice over the device preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    mockMatchMedia(true);

    renderProbe();

    expect(choice()).toBe("light");
    expect(resolved()).toBe("light");
  });

  it("falls back to System when the stored value is junk", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    mockMatchMedia(true);

    renderProbe();

    expect(choice()).toBe("system");
    expect(resolved()).toBe("dark");
  });

  it("still renders when storage throws, as it does in private mode", () => {
    mockMatchMedia(true);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => renderProbe()).not.toThrow();
    expect(resolved()).toBe("dark");

    getItem.mockRestore();
  });
});
