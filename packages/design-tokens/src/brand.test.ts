import { describe, expect, it } from "vitest";

import { BLADE, ICON_PADDING, STROKES, VIEW_BOX, VIEW_BOX_ATTR, markSvg } from "./brand";

/**
 * Every on-path point in a path string, as `[x, y]` pairs.
 *
 * A real walk of the commands rather than a regex over the numbers, because the
 * commands here have four different arities — `H` takes one x, `V` one y, `A`
 * seven parameters of which only the last two are a point. Pulling every number
 * out and calling the even ones x-coordinates reads an arc's radii and its
 * sweep flag as geometry, which is how a test like this passes while measuring
 * nothing.
 *
 * Only the absolute commands the mark actually uses are handled; anything else
 * throws rather than being silently skipped.
 */
function pointsOf(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let i = 0;

  const num = () => Number(tokens[i++]);
  const push = () => points.push([x, y]);

  while (i < tokens.length) {
    const command = tokens[i++];
    switch (command) {
      case "M":
      case "L":
        x = num();
        y = num();
        push();
        break;
      case "H":
        x = num();
        push();
        break;
      case "V":
        y = num();
        push();
        break;
      case "Q":
        // The control point is not on the path; only the endpoint is.
        num();
        num();
        x = num();
        y = num();
        push();
        break;
      case "A":
        // rx ry rotation large-arc sweep, then the endpoint.
        for (let skip = 0; skip < 5; skip += 1) num();
        x = num();
        y = num();
        push();
        break;
      case "Z":
        break;
      default:
        throw new Error(`unhandled path command: ${command}`);
    }
  }

  return points;
}

/** The x of every on-path point. */
const xsOf = (d: string) => pointsOf(d).map(([x]) => x);

describe("the mark's geometry", () => {
  // The single invariant worth protecting. Card, grip, guard and blade are four
  // independent path strings that only *look* like one drawing because they
  // agree on where the middle is; nudge any one of them and the sword slides
  // out of its card by a couple of units. That is far too small to notice in a
  // 20px wordmark and impossible to miss on a 1024px app icon, which is exactly
  // the kind of bug that ships.
  const centre = VIEW_BOX.width / 2;

  it("mirrors the card's two arcs about the vertical axis", () => {
    const xs = xsOf(STROKES[0].d);
    // The two arcs are mirror images: every x on the left has a partner at
    // `width - x` on the right.
    const left = xs.filter((x) => x < centre).sort((a, b) => a - b);
    const right = xs.filter((x) => x > centre).sort((a, b) => b - a);
    expect(left.map((x) => VIEW_BOX.width - x)).toEqual(right);
  });

  it.each([
    ["grip", STROKES[1].d],
    ["guard", STROKES[2].d],
    ["blade", BLADE.d],
  ])("centres the %s on the same axis", (_name, d) => {
    const xs = xsOf(d);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(centre);
  });

  it("keeps the fuller inside the blade's silhouette", () => {
    // `evenodd` turns the second subpath into a hole only while it sits within
    // the first. A fuller that grew past the walls would stop being a hole and
    // start being a second blade.
    const [silhouette, fuller] = BLADE.d.split("Z").map(xsOf);
    expect(Math.min(...fuller)).toBeGreaterThan(Math.min(...silhouette));
    expect(Math.max(...fuller)).toBeLessThan(Math.max(...silhouette));
  });

  it("hangs the blade behind the guard rather than butting against it", () => {
    // The blade's top (y=31) has to sit above the guard's crown (y=29 plus half
    // its 7-unit stroke, so ~32.5) or a seam of background opens between them
    // at large sizes. Everything else in the mark is deliberately broken; this
    // join is deliberately not.
    const bladeTop = Math.min(...pointsOf(BLADE.d).map(([, y]) => y));
    const guard = STROKES[2];
    const crownBottom = Math.min(...pointsOf(guard.d).map(([, y]) => y)) + guard.width / 2;
    expect(bladeTop).toBeLessThan(crownBottom);
  });
});

describe("markSvg", () => {
  it("declares the requested size and a matching viewBox", () => {
    const svg = markSvg({ size: 512 });
    expect(svg).toContain('width="512"');
    expect(svg).toContain('viewBox="0 0 512 512"');
  });

  it("omits the tile when no background is given", () => {
    // The transparent variants — the Android adaptive foreground and the
    // notification silhouette — are the assets where an accidental opaque rect
    // does not fail, it just quietly ships as a coloured square.
    expect(markSvg({ background: null })).not.toContain("<rect");
    expect(markSvg({ background: "#c08cff" })).toContain("<rect");
  });

  it("scales the mark to the requested fraction of the height", () => {
    const size = 1000;
    const svg = markSvg({ size, padding: 0.5 });
    const scale = (size * 0.5) / VIEW_BOX.height;
    expect(svg).toContain(`scale(${scale})`);
  });

  it("paints every stroke and the blade in one ink", () => {
    const svg = markSvg({ ink: "#abcdef" });
    // Four paths: three strokes plus the blade. A missed one is a limb of the
    // sword rendering in the wrong colour, or not at all.
    expect(svg.match(/#abcdef/g)).toHaveLength(STROKES.length + 1);
  });
});

describe("ICON_PADDING", () => {
  it("keeps the adaptive foreground inside Android's safe zone", () => {
    // Android guarantees only the inner 66% of an adaptive icon survives
    // masking. Anything larger risks a launcher cropping the sword's point.
    expect(ICON_PADDING.adaptive).toBeLessThan(0.66);
  });

  it("matches the original artwork's proportions for the app icon", () => {
    expect(ICON_PADDING.app).toBeCloseTo(0.348, 3);
  });
});

describe("VIEW_BOX_ATTR", () => {
  it("agrees with VIEW_BOX", () => {
    expect(VIEW_BOX_ATTR).toBe(`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`);
  });
});
