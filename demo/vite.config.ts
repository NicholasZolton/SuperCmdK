import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const prefix = process.env.PREFIX ?? "supercmdk";

export default defineConfig({
  root: "demo",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    hmr: {
      host: `web.${prefix}.localhost`,
      protocol: "wss",
      clientPort: 1355,
    },
  },
});
