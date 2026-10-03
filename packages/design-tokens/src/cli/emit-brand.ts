/**
 * Render every brand raster from `brand.ts`, or check that they are current.
 *
 * The companion to `emit-css.ts`, for the same reason and with the same
 * `--check`: twelve files across two apps all have to be the same drawing, and
 * the only way to guarantee that is for none of them to be hand-made. Edit the
 * geometry, run `npm run gen:brand`, commit the result — and if you forget,
 * `npm run lint` says so.
 *
 * `--check` compares bytes, which is only meaningful because every step here is
 * deterministic. That is also why the social card sets its type by reading
 * glyph outlines out of the vendored `.ttf` files rather than asking the
 * renderer for a font by name: see `runToPath` below.
 *
 *   npx tsx src/cli/emit-brand.ts            # write
 *   npx tsx src/cli/emit-brand.ts --check    # verify
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import opentype from "opentype.js";
import sharp from "sharp";

import { SITE_NAME, SITE_TAGLINE } from "@sidequestd/core";

import { ICON_PADDING, MARK_INK, VIEW_BOX, markElements, markSvg } from "../brand";
import { dark, light } from "../palette";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const WEB = join(ROOT, "apps/web");
const MOBILE = join(ROOT, "apps/mobile");

/** A file this run is responsible for. */
interface Asset {
  path: string;
  render: () => Promise<Buffer>;
}

/**
 * Rasterise an SVG string at its declared size.
 *
 * No `density`, deliberately. The SVGs here carry real pixel `width`/`height`,
 * and sharp's density is a *multiplier* over the 72dpi default — so a density
 * of 384 does not render a 64px icon more crisply, it renders a 341px one.
 * Everything here is vector, so librsvg rasterises at the declared size with no
 * loss to recover.
 */
const raster = (svg: string, opaque = false) => {
  const image = sharp(Buffer.from(svg));
  // A tile covers the whole square, so the alpha channel it still carries is
  // uniformly opaque and pure weight — except on iOS, where it is a rejection:
  // App Store Connect refuses an icon that has an alpha channel at all,
  // regardless of what is in it. Dropped here rather than trusted to `prebuild`.
  return (opaque ? image.removeAlpha() : image).png().toBuffer();
};

/** A square icon: the mark on a tile, or on nothing. */
function icon(size: number, padding: number, background: string | null, ink = MARK_INK) {
  return () => raster(markSvg({ size, padding, background, ink }), background !== null);
}

/* --- type, as outlines ---------------------------------------------------- */

/**
 * The three faces, loaded from `node_modules` rather than from the machine.
 *
 * A generator that renders with whatever fonts the host happens to have
 * installed produces a different card on every laptop, and `--check` then fails
 * for everyone except whoever last ran it. These are the same files the apps
 * ship.
 */
const FACES = {
  serif: "@expo-google-fonts/instrument-serif/400Regular/InstrumentSerif_400Regular.ttf",
  serifItalic:
    "@expo-google-fonts/instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf",
  sans: "@expo-google-fonts/figtree/400Regular/Figtree_400Regular.ttf",
} as const;

const face = (key: keyof typeof FACES) =>
  opentype.parse(readFileSync(require.resolve(FACES[key])).buffer as ArrayBuffer);

/**
 * Set one run of text as SVG path data, with the baseline at the origin.
 *
 * Glyph outlines rather than an `<svg:text>` element or sharp's text input, and
 * this is not premature cleverness — both of the alternatives were tried and
 * both silently set the card in Helvetica. sharp's prebuilt libvips ignores
 * `fontfile` and every fontconfig variable on this platform; librsvg will not
 * load a `@font-face`. Neither *fails*: they fall back to a system face and
 * report success, so the wrong typeface ships and the generator says it worked.
 * Reading the outlines out of the `.ttf` cannot go wrong quietly — either the
 * file parses or the run throws.
 *
 * It is also the only version that is genuinely portable. There is no font
 * installed anywhere that this depends on, so the bytes are identical in CI, on
 * a fresh laptop, and on a machine that happens to have its own Instrument
 * Serif.
 *
 * Glyphs are positioned one at a time, applying kerning pairs by hand, rather
 * than through `font.getPath()`. The high-level call runs opentype.js's full
 * shaper, which throws on Instrument Serif's `ccmp` table
 * (`lookupType: 6 - substFormat: 2 is not yet supported`). Nothing in a Latin
 * wordmark needs shaping beyond kerning, which is applied below.
 */
function runToPath(font: opentype.Font, value: string, size: number) {
  const scale = size / font.unitsPerEm;
  let x = 0;
  let d = "";
  let previous: opentype.Glyph | null = null;

  for (const character of value) {
    const glyph = font.charToGlyph(character);
    if (previous) x += font.getKerningValue(previous, glyph) * scale;
    d += `${glyph.getPath(x, 0, size).toPathData(3)} `;
    x += glyph.advanceWidth * scale;
    previous = glyph;
  }

  return { d: d.trim(), width: x };
}

/** The ink extents of some path data — what is actually drawn, not the em box. */
function inkBox(d: string) {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const ys = numbers.filter((_, i) => i % 2 === 1);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

/* --- the Open Graph card -------------------------------------------------- */

/**
 * The 1200×630 social card.
 *
 * A centred lockup — mark, wordmark, tagline — rather than the auth screen's
 * left-aligned pitch. Every platform that unfurls a link crops this to its own
 * aspect ratio, and centred content is the only arrangement that survives all
 * of them.
 *
 * Laid out against the type's *ink* rather than its line box, because the gaps
 * above and below a wordmark are the only thing holding it together optically,
 * and a 130px line box in a display serif has far more air in it than the
 * letters do. The bloom is an SVG radial gradient — the same approximation of
 * the web's `blur(120px)` that the native auth screen settles for.
 */
async function openGraphCard(): Promise<Buffer> {
  const W = 1200;
  const H = 630;

  const serif = face("serif");
  const italic = face("serifItalic");
  const sans = face("sans");

  const WORD = 130;
  const TAGLINE = 27;

  const side = runToPath(serif, "Side", WORD);
  // The italic is the drawn face, loaded as its own file — not the roman
  // skewed, which is what asking a renderer for "italic" would have produced.
  const questd = runToPath(italic, "questd", WORD);
  const tagline = runToPath(sans, SITE_TAGLINE, TAGLINE);

  const wordWidth = side.width + questd.width;
  const wordInk = inkBox(side.d + questd.d);
  const taglineInk = inkBox(tagline.d);

  // The mark, drawn in the accent rather than the artwork's ivory: it sits on
  // the dark canvas here, not on a purple tile, and ivory would read as a
  // second brand colour.
  const markHeight = 128;
  const markWidth = (markHeight * VIEW_BOX.width) / VIEW_BOX.height;

  const GAP_MARK = 46;
  const GAP_TAGLINE = 34;

  const wordHeight = wordInk.bottom - wordInk.top;
  const taglineHeight = taglineInk.bottom - taglineInk.top;
  const total = markHeight + GAP_MARK + wordHeight + GAP_TAGLINE + taglineHeight;

  const markTop = (H - total) / 2;
  // Baselines, derived from where each run's ink has to land.
  const wordBaseline = markTop + markHeight + GAP_MARK - wordInk.top;
  const taglineBaseline = wordBaseline + wordInk.bottom + GAP_TAGLINE - taglineInk.top;

  const wordLeft = (W - wordWidth) / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bloom" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${dark.accent}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${dark.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${dark.canvas}"/>
  <circle cx="150" cy="120" r="520" fill="url(#bloom)"/>
  <g transform="translate(${(W - markWidth) / 2} ${markTop}) scale(${markHeight / VIEW_BOX.height})">
    ${markElements(dark.accent)}
  </g>
  <g transform="translate(${wordLeft} ${wordBaseline})">
    <path d="${side.d}" fill="${dark.fg}"/>
    <g transform="translate(${side.width} 0)"><path d="${questd.d}" fill="${dark.fgDim}"/></g>
  </g>
  <path transform="translate(${(W - tagline.width) / 2} ${taglineBaseline})"
        d="${tagline.d}" fill="${dark.fgFaint}"/>
</svg>`;

  return raster(svg, true);
}

/* --- the manifest of everything ------------------------------------------- */

const ASSETS: Asset[] = [
  /* Web. Next resolves `icon` and `apple-icon` in `app/` into the document's
     <link> tags on its own, so these need no metadata to go with them. The
     three under `public/` do: a manifest's icons are URLs, and Next serves
     `app/icon.png` from a hashed path that nothing can write down. */
  {
    path: join(WEB, "src/app/icon.png"),
    render: icon(64, ICON_PADDING.favicon, dark.accent),
  },
  {
    path: join(WEB, "src/app/apple-icon.png"),
    render: icon(180, ICON_PADDING.app, dark.accent),
  },
  {
    // Twitter falls back to `og:image` when no `twitter:image` is present, so
    // one file serves both cards.
    path: join(WEB, "src/app/opengraph-image.png"),
    render: openGraphCard,
  },
  {
    path: join(WEB, "public/icon-192.png"),
    render: icon(192, ICON_PADDING.app, dark.accent),
  },
  {
    path: join(WEB, "public/icon-512.png"),
    render: icon(512, ICON_PADDING.app, dark.accent),
  },
  {
    // `purpose: "maskable"`. Android crops this to its own shape, so the mark
    // pulls in to the adaptive safe zone and the tile is allowed to bleed.
    path: join(WEB, "public/icon-maskable-512.png"),
    render: icon(512, ICON_PADDING.adaptive, dark.accent),
  },

  /* Mobile. Every one of these is referenced from app.json. */
  {
    // Opaque, and it has to stay that way: the App Store rejects an icon that
    // carries an alpha channel at all.
    path: join(MOBILE, "assets/icon.png"),
    render: icon(1024, ICON_PADDING.app, dark.accent),
  },
  {
    // The Android foreground layer. Transparent — app.json supplies the accent
    // as the background layer underneath it.
    path: join(MOBILE, "assets/adaptive-icon.png"),
    render: icon(1024, ICON_PADDING.adaptive, null),
  },
  {
    // The splash marks: the accent in each theme rather than the artwork's
    // ivory, which would be invisible on the light splash's near-white ground.
    path: join(MOBILE, "assets/splash-icon-dark.png"),
    render: icon(512, ICON_PADDING.splash, null, dark.accent),
  },
  {
    path: join(MOBILE, "assets/splash-icon-light.png"),
    render: icon(512, ICON_PADDING.splash, null, light.accent),
  },
  {
    // Android keeps only this file's alpha and paints the silhouette itself, so
    // the colour is arbitrary — white by convention, so it stays legible if
    // some OEM skin decides to draw it as-is.
    path: join(MOBILE, "assets/notification-icon.png"),
    render: icon(96, ICON_PADDING.notification, null, "#ffffff"),
  },
  {
    path: join(MOBILE, "assets/favicon.png"),
    render: icon(48, ICON_PADDING.favicon, dark.accent),
  },
];

/* --- run ------------------------------------------------------------------ */

const check = process.argv.includes("--check");
let stale = 0;

for (const asset of ASSETS) {
  const next = await asset.render();
  const label = relative(ROOT, asset.path);

  if (check) {
    let current: Buffer | null = null;
    try {
      current = readFileSync(asset.path);
    } catch {
      current = null;
    }

    if (!current || !current.equals(next)) {
      console.error(`${label} is out of date with packages/design-tokens.`);
      stale += 1;
    }
    continue;
  }

  mkdirSync(dirname(asset.path), { recursive: true });
  writeFileSync(asset.path, next);
  console.log(`Wrote ${label} (${(next.length / 1024).toFixed(1)} kB)`);
}

if (check) {
  if (stale > 0) {
    console.error("\nRun `npm run gen:brand` and commit the result.");
    process.exit(1);
  }
  console.log(`${ASSETS.length} brand assets are up to date.`);
} else {
  console.log(`\n${ASSETS.length} assets written for ${SITE_NAME}.`);
}
