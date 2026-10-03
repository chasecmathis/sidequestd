/**
 * Write the generated token stylesheet, or check that it is current.
 *
 * `--check` is what runs in lint: it fails when someone edits a token and
 * forgets to regenerate, which is the only way the web and native clients can
 * come to disagree about a colour.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { emitCss } from "../css";

const [target, ...flags] = process.argv.slice(2);

if (!target) {
  console.error("usage: emit-css <output.css> [--check]");
  process.exit(2);
}

const path = resolve(process.cwd(), target);
const next = emitCss();

if (flags.includes("--check")) {
  let current: string | null = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = null;
  }

  if (current !== next) {
    console.error(
      `${target} is out of date with packages/design-tokens.\nRun \`npm run gen:tokens\` and commit the result.`,
    );
    process.exit(1);
  }

  console.log(`${target} is up to date.`);
} else {
  writeFileSync(path, next, "utf8");
  console.log(`Wrote ${target}`);
}
