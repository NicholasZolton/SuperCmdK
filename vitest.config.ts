import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@supercmdk/react/agent",
        replacement: fileURLToPath(new URL("./src/agent/index.ts", import.meta.url)),
      },
      {
        find: "@supercmdk/react/tools",
        replacement: fileURLToPath(new URL("./src/tools/index.ts", import.meta.url)),
      },
      {
        find: "@supercmdk/react",
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}", "packages/*/tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
  },
});
