/**
 * Babel, for this app *and* for the shared packages.
 *
 * `@sidequestd/core` and `@sidequestd/design-tokens` publish TypeScript source
 * rather than a build — `main` points straight at `src/index.ts`. That is a
 * deliberate trade: there is no build step to keep in sync and no stale `dist/`
 * to debug, at the cost of Metro having to compile files that live outside this
 * project root. React Native's transformer loads this config from the project
 * root and applies it to every file it is handed, wherever that file came from,
 * so `babel-preset-expo` — which carries `@babel/preset-typescript` — covers the
 * packages as well as `src/`.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
