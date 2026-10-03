import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";

import { ThemeMenu, ThemeSegments } from "./theme-toggle";
import { THEME_STORAGE_KEY } from "@sidequestd/core";
// The web wrapper rather than the shared provider, because the assertions below
// read `data-theme` off `<html>` — and stamping that attribute is precisely the
// part this app adds on top. See lib/theme-provider.tsx.
import { WebThemeProvider } from "@/lib/theme-provider";

// The global matchMedia stub answers `matches: false` to everything, so an
// untouched device reads as light here. That is fine for this file — what is
// under test is the control, not the resolution, which theme.test.tsx covers.

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function renderIn(ui: React.ReactNode) {
  return render(<WebThemeProvider>{ui}</WebThemeProvider>);
}

describe("ThemeMenu", () => {
  it("names the current choice, since the icon can only show the result", async () => {
    renderIn(<ThemeMenu />);

    // Not "Theme: light" — the reader has chosen to follow their device, and an
    // icon showing a sun cannot convey that on its own.
    expect(screen.getByRole("button", { name: "Theme: system" })).toBeInTheDocument();
  });

  it("marks exactly one option as checked", async () => {
    renderIn(<ThemeMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Theme: system" }));

    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(screen.getByRole("menuitemradio", { name: /System/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("applies a choice and closes", async () => {
    renderIn(<ThemeMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Theme: system" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Dark/ }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
  });

  it("closes on Escape without changing anything", async () => {
    renderIn(<ThemeMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Theme: system" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("closes on a press outside it", async () => {
    renderIn(
      <>
        <ThemeMenu />
        <button>somewhere else</button>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Theme: system" }));

    // A popover that only closes by pressing its own trigger again is a trap on
    // touch, where there is no Escape key to reach for.
    await userEvent.click(screen.getByRole("button", { name: "somewhere else" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("ThemeSegments", () => {
  it("is one radiogroup with one answer", () => {
    renderIn(<ThemeSegments />);

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const options = screen.getAllByRole("radio");
    expect(group).toBeInTheDocument();
    expect(options).toHaveLength(3);
    expect(options.filter((o) => o.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("puts the single tab stop on the current choice", () => {
    renderIn(<ThemeSegments />);

    // The roving-tabindex pattern the role implies: Tab reaches the group once,
    // landing on the answer, and the arrows move within it.
    const stops = screen.getAllByRole("radio").filter((o) => o.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName(/System/);
  });

  it("moves between options with the arrow keys, wrapping", async () => {
    renderIn(<ThemeSegments />);

    await userEvent.click(screen.getByRole("radio", { name: /System/ }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Light/ })).toHaveAttribute("aria-checked", "true");

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Dark/ })).toHaveAttribute("aria-checked", "true");

    // The ends of the row are not walls.
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /System/ })).toHaveAttribute("aria-checked", "true");

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: /Dark/ })).toHaveAttribute("aria-checked", "true");
  });

  it("applies immediately, with no save step", async () => {
    renderIn(<ThemeSegments />);

    await userEvent.click(screen.getByRole("radio", { name: /Light/ }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("shares its state with the menu", async () => {
    renderIn(
      <>
        <ThemeMenu />
        <ThemeSegments />
      </>,
    );

    await userEvent.click(screen.getByRole("radio", { name: /Dark/ }));

    // Both read the same context, so the header control cannot drift from the
    // settings control.
    expect(screen.getByRole("button", { name: "Theme: dark" })).toBeInTheDocument();
  });
});
