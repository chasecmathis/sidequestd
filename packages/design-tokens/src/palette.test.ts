import { describe, expect, it } from "vitest";

import { bloomLayer, fixed, palettes, scrimLayer, type ThemeName } from "./palette";

/** "#c08cff" → "192, 140, 255", the way an rgba() string spells it. */
function toRgbChannels(hex: string): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].join(", ");
}

describe("bloomLayer", () => {
  // The bloom is written twice — once as an rgba string for CSS, once as a
  // colour and an alpha for a gradient stop that would otherwise ignore the
  // alpha entirely. Two spellings of one value is a drift waiting to happen, and
  // the drift is silent: the web keeps glowing correctly while native paints a
  // solid block. This is the check that makes the duplication safe.
  it.each<ThemeName>(["dark", "light"])("matches the %s palette's bloom", (name) => {
    const { color, opacity } = bloomLayer[name];
    expect(palettes[name].bloom).toBe(`rgba(${toRgbChannels(color)}, ${opacity})`);
  });
});

describe("scrimLayer", () => {
  // Same duplication, same silent drift: the flat scrim behind a badge and the
  // faded one under a tile's rating are one decision written twice, and nothing
  // on screen would show them disagreeing until the two were side by side.
  it("matches the fixed scrim", () => {
    expect(fixed.scrim).toBe(`rgba(${toRgbChannels(scrimLayer.color)}, ${scrimLayer.opacity})`);
  });
});
