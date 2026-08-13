import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    needle: "src/needle/index.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  external: ["react", "react-dom"],
});
