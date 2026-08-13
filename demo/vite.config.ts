import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const prefix = process.env.PREFIX ?? "supercmdk";

export default defineConfig({
  root: "demo",
  plugins: [react()],
  resolve: {
    alias: [
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
