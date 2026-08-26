import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

// Config is loaded by Node; package exports to .ts are not. Same pattern as apps/paper.
import { oblikPlugin } from "../../packages/oblik/src/source/vite-plugin.ts";

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
  server: {
    host: "127.0.0.1",
    port: 43127,
    strictPort: true,
    fs: { allow: [workspaceRoot] },
  },
  resolve: {
    alias: {
      "@": path.resolve(workspaceRoot, "packages/oblik/src"),
    },
  },
  optimizeDeps: {
    exclude: ["oblik"],
  },
});
