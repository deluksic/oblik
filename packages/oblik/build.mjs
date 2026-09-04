import { build } from "esbuild";

await build({
  entryPoints: ["src/source/vite-plugin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "dist/plugin.js",
});
