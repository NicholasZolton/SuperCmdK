import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { createLlmsTxt } from "./llms.ts";

const prefix = process.env.PREFIX ?? "supercmdk";

function llmsTxtPlugin(): Plugin {
  return {
    name: "supercmdk-llms-txt",
    generateBundle(): void {
      this.emitFile({
        type: "asset",
        fileName: "llms.txt",
        source: createLlmsTxt(),
      });
    },
  };
}

export default defineConfig({
  root: "demo",
  plugins: [react(), llmsTxtPlugin()],
  resolve: {
    alias: [
      {
        find: "@supercmdk/palette",
        replacement: fileURLToPath(new URL("../packages/palette/src/index.ts", import.meta.url)),
      },
      {
        find: "@supercmdk/react/agent",
        replacement: fileURLToPath(new URL("../src/agent/index.ts", import.meta.url)),
      },
      {
        find: "@supercmdk/react/tools",
        replacement: fileURLToPath(new URL("../src/tools/index.ts", import.meta.url)),
      },
      {
        find: "@supercmdk/react",
        replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    hmr: {
      host: `web.${prefix}.localhost`,
      protocol: "wss",
      clientPort: 1355,
    },
  },
});
