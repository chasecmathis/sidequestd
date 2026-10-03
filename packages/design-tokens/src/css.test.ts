/**
 * The guard on the extraction.
 *
 * These values were literals in `apps/web/src/app/globals.css` before this
 * package existed, and the whole point of moving them was that nothing on
 * screen should change. The expectations below are that file as it stood, typed
 * out by hand — so if a token is dropped, renamed or mistyped on the way
 * through the generator, this fails rather than the web app quietly rendering a
 * different colour.
 *
 * Deliberately not a snapshot test: a snapshot records whatever the code does
 * today, including a mistake, and updates itself the moment someone runs it
 * with `-u`. These are the intended values, written down independently.
 */
import { describe, expect, it } from "vitest";

import { emitCss } from "./css";

/** Exactly what `@theme` and `[data-theme="light"]` declared before the move. */
const ORIGINAL = {
  dark: {
    "--color-canvas": "#0a090d",
    "--color-surface": "#131218",
    "--color-surface-2": "#1c1b24",
    "--color-line": "#282634",
    "--color-line-strong": "#3c3a4d",
    "--color-fg": "#f1eff5",
    "--color-fg-dim": "#a3a0ae",
    "--color-fg-faint": "#6c6979",
    "--color-accent": "#c08cff",
    "--color-accent-dim": "#a96ff5",
    "--color-accent-ink": "#12091c",
    "--color-star": "#f5b942",
    "--color-danger": "#ff6b5a",
    "--color-success": "#6fd98f",
    "--color-on-scrim": "#ffffff",
  },
  light: {
    "--color-canvas": "#f7f5fa",
    "--color-surface": "#ffffff",
    "--color-surface-2": "#f1eef6",
    "--color-line": "#e1ddea",
    "--color-line-strong": "#c8c3d6",
    "--color-fg": "#191622",
    "--color-fg-dim": "#4e4a5b",
    "--color-fg-faint": "#7a7688",
    "--color-accent": "#6b3fc4",
    "--color-accent-dim": "#5a31ab",
    "--color-accent-ink": "#ffffff",
    "--color-star": "#8a5a05",
    "--color-danger": "#c2352a",
    "--color-success": "#1c7a46",
  },
} as const;

/** The declarations inside one top-level block of the emitted stylesheet. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from the generated stylesheet`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

describe("emitCss", () => {
  const css = emitCss();

  it("carries every dark token @theme declared before the extraction", () => {
    const theme = block(css, "@theme");
    for (const [name, value] of Object.entries(ORIGINAL.dark)) {
      expect(theme, name).toContain(`${name}: ${value};`);
    }
  });

  it("carries every light override", () => {
    const mode = block(css, '[data-theme="light"]');
    for (const [name, value] of Object.entries(ORIGINAL.light)) {
      expect(mode, name).toContain(`${name}: ${value};`);
    }
  });

  it("reassigns in light exactly the colours dark declares, and no others", () => {
    const names = (source: string) =>
      [...source.matchAll(/--color-[a-z0-9-]+/g)].map((match) => match[0]).sort();

    const inTheme = names(block(css, "@theme"));
    const inLight = names(block(css, '[data-theme="light"]'));

    // `scrim` and `on-scrim` are the deliberate exceptions: they sit over user
    // media, so they must NOT get lighter when the page does.
    expect(inLight).toEqual(inTheme.filter((name) => !name.endsWith("scrim")));
  });

  it("keeps shadows out of @theme, where Tailwind would bake their colour in", () => {
    expect(block(css, "@theme")).not.toContain("--shadow-");
    expect(block(css, ":root")).toContain("--shadow-pop:");
    expect(block(css, '[data-theme="light"]')).toContain("--shadow-pop:");
  });

  it("leaves the light block unlayered, so it beats @theme on layer order", () => {
    // Specificity is identical between `:root` and `[data-theme="light"]`, so
    // the cascade is decided by the layer. Anything wrapping this block in an
    // `@layer` would silently make the light theme a coin toss.
    expect(css).not.toContain("@layer");
  });

  it("sets a colour-scheme for each mode, so form controls follow", () => {
    expect(block(css, ":root")).toContain("color-scheme: dark;");
    expect(block(css, '[data-theme="light"]')).toContain("color-scheme: light;");
  });

  it("gives light a quieter grain than dark", () => {
    // Noise is roughly twice as loud on paper; the same value in both modes
    // reads as a dirty screen on light.
    expect(block(css, ":root")).toContain("--grain: 0.035;");
    expect(block(css, '[data-theme="light"]')).toContain("--grain: 0.022;");
  });
});
