import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

import { sceneDevPlugin } from "../../packages/shell/src/vite-plugin.ts";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");

export default defineConfig({
  plugins: [
    solid(),
    sceneDevPlugin({
      workspaceRoot,
      sceneDir: path.join(appRoot, "src/scenes"),
    }),
  ],
  resolve: {
    alias: {
      "@design-scenes/geom": path.resolve(workspaceRoot, "packages/geom/src/index.ts"),
      "@design-scenes/euclid2": path.resolve(workspaceRoot, "packages/euclid2/src/index.ts"),
      "@design-scenes/euclid3": path.resolve(workspaceRoot, "packages/euclid3/src/index.ts"),
      "@design-scenes/sdf": path.resolve(workspaceRoot, "packages/sdf/src/index.ts"),
      "@design-scenes/shell": path.resolve(workspaceRoot, "packages/shell/src/index.ts"),
      "@design-scenes/hosts": path.resolve(workspaceRoot, "packages/hosts/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 43117,
    strictPort: true,
    fs: { allow: [workspaceRoot] },
  },
  optimizeDeps: {
    exclude: [
      "@design-scenes/geom",
      "@design-scenes/euclid2",
      "@design-scenes/euclid3",
      "@design-scenes/sdf",
      "@design-scenes/shell",
      "@design-scenes/hosts",
    ],
  },
});
