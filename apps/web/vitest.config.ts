import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Node 25 turns its own Web Storage on by default. Without `--localstorage-file`
 * its `localStorage` global is a stub with no methods that shadows jsdom's real
 * one, and touching it prints a warning from every worker. Switching it off
 * leaves jsdom's in charge. Only where the flag exists: Node 20 has none, and an
 * unknown flag would stop the workers from starting.
 */
const NO_NODE_WEBSTORAGE = "--no-experimental-webstorage";
const execArgv = process.allowedNodeEnvironmentFlags.has(NO_NODE_WEBSTORAGE)
  ? [NO_NODE_WEBSTORAGE]
  : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    poolOptions: { forks: { execArgv }, threads: { execArgv } },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
