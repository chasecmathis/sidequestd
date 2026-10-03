/**
 * Metro, taught about the monorepo.
 *
 * This app is deliberately outside the root npm workspace (see
 * .context/architecture/mobile-client.md), but it now depends on two packages
 * that live inside it — `@sidequestd/core` and
 * `@sidequestd/design-tokens` — through `file:` paths. npm links those as
 * symlinks into `node_modules/@sidequestd`, and everything below exists because
 * a symlinked package's *files* sit outside this project root while its
 * *imports* resolve from where those files are.
 *
 * **`watchFolders`** — Metro only serves files under the project root plus this
 * list. Without `packages/` in it, importing `@sidequestd/core` fails with a
 * "None of these files exist" error naming a path that plainly does exist.
 *
 * **`resolveRequest`** — the load-bearing part, and the reason this file is
 * longer than the Expo monorepo recipe. Node's resolution walks *up* from the
 * importing file, so `react` imported from `packages/core/src/auth.tsx` finds
 * `<repo>/node_modules/react` — the web workspace's copy, currently 19.2.8
 * against this app's 19.1.0. Two React copies in one bundle is the "Invalid hook
 * call" / "Cannot read property 'useState' of null" class of bug, and it appears
 * at runtime on a device rather than at install time.
 *
 * The fix is to resolve those three packages *as if* the import came from this
 * app's own root, which is what rewriting `originModulePath` does. The blunter
 * instrument — `disableHierarchicalLookup`, which pins resolution to a single
 * directory — also works and was tried first; it breaks the moment a dependency
 * keeps a nested copy of something, which `expo-router` does with
 * `@expo/metro-runtime`, and the app then fails to bundle at all.
 *
 * `packages/core` declaring React as a peer dependency rather than a dependency
 * is the other half of this. Both are worth having: the failure mode is a white
 * screen with a misleading stack.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");

/** Packages that must have exactly one copy in the bundle. */
const SINGLETONS = new Set(["react", "react-dom", "react-native"]);

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.resolve(repoRoot, "packages")];

// This app's own `node_modules` first, whoever is asking.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // `react/jsx-runtime` and `react-native/Libraries/…` have to be pinned too, so
  // match on the package rather than on the whole specifier.
  const [scopeOrName, maybeName] = moduleName.split("/");
  const packageName = scopeOrName.startsWith("@") ? `${scopeOrName}/${maybeName}` : scopeOrName;

  const resolve = defaultResolveRequest ?? context.resolveRequest;

  if (SINGLETONS.has(packageName)) {
    return resolve(
      // A file that does not exist, and does not need to: only the *directory*
      // matters, and it is this app's root — so the upward walk starts here and
      // finds this app's copy before the repo root's.
      { ...context, originModulePath: path.join(projectRoot, "index.js") },
      moduleName,
      platform,
    );
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
