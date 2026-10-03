import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BLADE, STROKES } from "@sidequestd/design-tokens";

import { Wordmark } from "./wordmark";

describe("Wordmark", () => {
  it("reads as the product's name and nothing else", () => {
    // The glyph is a picture of the word sitting right next to it. If it ever
    // stops being `aria-hidden`, a screen reader announces the brand twice —
    // which is invisible in every screenshot and obvious to anyone listening.
    const { container } = render(<Wordmark />);

    expect(container).toHaveTextContent(/^Sidequestd$/);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws the shared mark rather than a copy of it", () => {
    // The point of the mark living in design-tokens is that the header, the app
    // icon and the social card cannot disagree. A path pasted in here would
    // look identical today and drift the first time the logo is adjusted.
    const { container } = render(<Wordmark />);
    const drawn = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d"));

    for (const stroke of STROKES) expect(drawn).toContain(stroke.d);
    expect(drawn).toContain(BLADE.d);
  });

  it("takes its colour from the accent, in both themes", () => {
    // `text-accent` rather than a hex: the accent inverts between themes, and a
    // literal would be right in exactly one of them.
    const { container } = render(<Wordmark />);

    expect(container.querySelector("svg")).toHaveClass("text-accent");
  });

  it("sizes the glyph off the type rather than per size", () => {
    // The glyph height is an `em`, so the two sizes differ only in the font
    // size on the wrapper and the mark follows on its own. If a size ever grows
    // its own glyph value, these two stop being the same lockup at two scales.
    const small = render(<Wordmark size="sm" />).container.firstElementChild;
    const medium = render(<Wordmark size="md" />).container.firstElementChild;

    expect(small).toHaveClass("text-xl");
    expect(medium).toHaveClass("text-2xl");
    expect(small?.querySelector("svg")?.getAttribute("class")).toBe(
      medium?.querySelector("svg")?.getAttribute("class"),
    );
  });
});
