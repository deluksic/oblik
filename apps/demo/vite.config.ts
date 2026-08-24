import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

import { oblikPlugin } from "oblik/plugin";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");

export default defineConfig({
  plugins: [
    solid(),
    oblikPlugin({
      workspaceRoot,
      sceneDir: path.join(appRoot, "src/scenes"),
    }),
  ],
  resolve: {
    alias: {
      oblik: path.resolve(workspaceRoot, "packages/oblik/src/index.ts"),
      "oblik/euclid2": path.resolve(workspaceRoot, "packages/oblik/src/euclid2/View.tsx"),
      "oblik/plugin": path.resolve(workspaceRoot, "packages/oblik/src/source/vite-plugin.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 43127,
    strictPort: true,
    fs: { allow: [workspaceRoot] },
  },
  optimizeDeps: {
    exclude: ["oblik"],
  },
});
