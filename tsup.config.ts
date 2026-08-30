import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  sourcemap: true,
  // Ship the Python AST-dump helper alongside the compiled JS.
  onSuccess: "node scripts/copy-assets.mjs",
});
