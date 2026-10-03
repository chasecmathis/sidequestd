/**
 * The grain tile.
 *
 * The web draws its grain with an inline SVG filter — `feTurbulence` with
 * `type="fractalNoise" baseFrequency="0.85" numOctaves="3"`, tiled over a fixed
 * 160×160 box. React Native has no SVG filters worth relying on across both
 * platforms, so the same noise is rendered once, here, into a PNG that
 * `<Grain>` tiles at the per-theme opacity.
 *
 * This is a generator rather than a hand-drawn asset for one reason: the two
 * clients have to show the *same* texture, and "some noise someone exported
 * once" drifts from the filter the moment anyone touches either. The parameters
 * below are the filter's, spelled the same way.
 *
 *   node scripts/generate-grain.mjs
 *
 * Deterministic — same seed, same bytes — so re-running it produces no diff
 * unless a parameter actually changed.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** The filter's own numbers. Changing one changes both clients' texture. */
const SIZE = 160;
const BASE_FREQUENCY = 0.85;
const OCTAVES = 3;

/* --- noise ---------------------------------------------------------------- */

/** Small, fast, and seeded: the tile must be byte-identical between runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * One octave of value noise on a `cells`×`cells` lattice, sampled over the
 * tile.
 *
 * Tileability is the whole reason the lattice is indexed with `% cells` rather
 * than clamped: at x = SIZE the sample lands exactly back on lattice column 0,
 * so the tile's right edge meets its own left edge with no seam. Every
 * frequency below is chosen so that `cells` divides evenly into the tile.
 */
function octave(cells, random) {
  const lattice = Float64Array.from({ length: cells * cells }, random);
  const at = (cx, cy) => lattice[(cy % cells) * cells + (cx % cells)];

  return (x, y) => {
    const fx = (x / SIZE) * cells;
    const fy = (y / SIZE) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fade(fx - x0);
    const ty = fade(fy - y0);

    const top = lerp(at(x0, y0), at(x0 + 1, y0), tx);
    const bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx);
    return lerp(top, bottom, ty);
  };
}

/**
 * `numOctaves` octaves at doubling frequency and halving amplitude — the
 * definition of `fractalNoise`, and what gives the texture its film-grain
 * clumping rather than the flat static of a single octave.
 */
function fractalNoise(seed) {
  const random = mulberry32(seed);
  const base = Math.round(SIZE * BASE_FREQUENCY);

  const layers = [];
  let amplitude = 1;
  let total = 0;
  for (let index = 0; index < OCTAVES; index += 1) {
    layers.push({ sample: octave(base * 2 ** index, random), amplitude });
    total += amplitude;
    amplitude /= 2;
  }

  return (x, y) => {
    let sum = 0;
    for (const { sample, amplitude: a } of layers) sum += sample(x, y) * a;
    return sum / total;
  };
}

/* --- PNG ------------------------------------------------------------------ */

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 8-bit grey + alpha (colour type 4) — two channels rather than four, because
    the noise is neutral and the alpha is what does the work. */
function encodePng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 4;

  const raw = Buffer.alloc(SIZE * (SIZE * 2 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * (SIZE * 2 + 1);
    raw[rowStart] = 0; // filter: none. Noise defeats every predictor anyway.
    pixels.copy(raw, rowStart + 1, y * SIZE * 2, (y + 1) * SIZE * 2);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- render --------------------------------------------------------------- */

// Two independent fields, as the filter produces: the luminance decides whether
// a speck is lighter or darker than what is under it, the alpha decides whether
// there is a speck there at all. One field for both would give a texture where
// every dark grain is also a transparent one, which reads as a scratched
// screen rather than as film.
const luma = fractalNoise(0x51de9e57);
const alpha = fractalNoise(0x0eda1f1a);

const pixels = Buffer.alloc(SIZE * SIZE * 2);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const index = (y * SIZE + x) * 2;
    pixels[index] = Math.round(luma(x, y) * 255);
    pixels[index + 1] = Math.round(alpha(x, y) * 255);
  }
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/grain.png");
writeFileSync(out, encodePng(pixels));
console.log(`grain: ${SIZE}×${SIZE}, ${OCTAVES} octaves at ${BASE_FREQUENCY} → ${out}`);
