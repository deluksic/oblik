import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

import { oblikPlugin, oblikVanillaExtractHmr } from "oblik/plugin";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vanillaExtractPlugin(),
    solid(),
    Icons({ compiler: "solid" }),
    oblikPlugin({
      workspaceRoot: appRoot,
      sceneDir: path.join(appRoot, "src/scenes"),
    }),
    oblikVanillaExtractHmr(),
  ],
  server: {
    port: 43127,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["oblik"],
  },
});
