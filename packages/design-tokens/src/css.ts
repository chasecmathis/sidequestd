/**
 * The tokens, as the CSS the web client consumes.
 *
 * Why generate rather than hand-write: `apps/web/src/app/globals.css` used to
 * carry these literals, and the native client would have had to repeat all of
 * them. Two lists of forty hexes stay identical for about a week. Everything
 * *else* in `globals.css` — the `@utility` rules, the grain layer, the focus
 * ring, the prose styles — is still hand-written there, because none of it is a
 * value the native client can use.
 *
 * Three things about the shape of the output, each of which cost a build to
 * find out and none of which should be changed casually:
 *
 *   - `@theme`, not `@theme inline`. `inline` suppresses the `:root` variables
 *     and bakes values into the utilities, which leaves every hand-written
 *     `var(--color-…)` in globals.css pointing at variables that no longer
 *     exist.
 *   - Shadows cannot live in `@theme` under either spelling. Tailwind parses a
 *     `--shadow-*` token at build time and inlines its colour, so the light
 *     block would be ignored. They are emitted as plain properties instead, and
 *     globals.css turns them into utilities by hand.
 *   - The light block wins the cascade on *layer order*, not specificity —
 *     `[data-theme="light"]` and `:root` have identical specificity, so that
 *     would otherwise be a coin toss. `@theme` emits into `@layer theme`; this
 *     block is unlayered, and unlayered beats layered outright. It therefore
 *     has to stay outside any `@layer`, and this file has to be imported after
 *     `tailwindcss`.
 */
import { webStacks } from "./fonts";
import { dark, fixed, light, overMedia, type Palette } from "./palette";
import { elevation, grain, motion, radius } from "./shape";

/** `accentInk` -> `accent-ink`, so a token name becomes a Tailwind utility. */
function kebab(name: string): string {
  return name.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
}

function colorVars(palette: Palette, indent: string): string {
  return (Object.keys(palette) as (keyof Palette)[])
    .map((key) => `${indent}--color-${kebab(key)}: ${palette[key]};`)
    .join("\n");
}

const BANNER = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by \`npm run gen:tokens\` from packages/design-tokens.
 * Edit the values in packages/design-tokens/src/, then re-run it.
 *
 * The design rationale for every value below lives in that package's
 * \`palette.ts\` and \`shape.ts\`, where the native client reads it too.
 */`;

export function emitCss(): string {
  const radiusVars = Object.entries(radius)
    .map(([name, value]) => `  --radius-${name}: ${value}px;`)
    .join("\n");

  const fontVars = Object.entries(webStacks)
    .map(([role, stack]) => `  --font-${role}: ${stack};`)
    .join("\n");

  const fixedVars = Object.entries(fixed)
    .map(([name, value]) => `  --color-${kebab(name)}: ${value};`)
    .join("\n");

  const overMediaVars = Object.entries(overMedia)
    .map(([name, value]) => `  --color-${kebab(name)}: ${value};`)
    .join("\n");

  return `${BANNER}

/* Dark is the default and carries the bare token names, which does two things
   at once: it emits \`--color-canvas\` onto \`:root\`, and it makes \`bg-canvas\`
   compile to \`var(--color-canvas)\` rather than to the literal. The light block
   at the bottom then reassigns those same names, and every utility follows at
   once — which is why no component in either client ever names a mode, and why
   there is no \`dark:\` variant anywhere in this codebase. */
@theme {
${colorVars(dark, "  ")}

  /* Fixed in both modes: type and chrome laid over user media, where what sits
     behind is an arbitrary photograph rather than one of our surfaces. */
${fixedVars}

${radiusVars}

  --ease-out: ${motion.easeOutCss};

${fontVars}
}

:root {
  color-scheme: dark;

  /* Read once each, by one rule in globals.css — so neither needs to be a
     \`@theme\` token with a utility generated for it. */
  --grain: ${grain.dark};
  --shadow-pop: ${elevation.dark.pop.css};
  --shadow-panel: ${elevation.dark.panel.css};
}

[data-theme="light"] {
  color-scheme: light;

${colorVars(light, "  ")}

  --shadow-pop: ${elevation.light.pop.css};
  --shadow-panel: ${elevation.light.panel.css};

  --grain: ${grain.light};
}

/* A patch of dark, sitting on artwork.
 *
 * The scrim tokens cover a flat fill and the type on it. This covers the harder
 * case: a *subtree* over media, containing components that colour themselves
 * from the palette and have no idea they are on a photograph. Redeclaring the
 * inherited custom properties is the whole mechanism — anything inside picks
 * them up without being passed a prop or told which mode it is in.
 *
 * The values are the dark theme's, repeated deliberately, and must not follow
 * it if it changes. See \`overMedia\` in packages/design-tokens/src/palette.ts
 * for the failure this exists to fix. */
@utility over-media {
${overMediaVars}

  color: var(--color-fg);
}
`;
}
