import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { sceneDevPlugin } from "@design-scenes/shell";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");

export default defineConfig({
  plugins: [
    sceneDevPlugin({
      workspaceRoot,
      sceneDir: path.join(appRoot, "src/scenes"),
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 43117,
    strictPort: true,
    fs: { allow: [workspaceRoot] },
  },
  optimizeDeps: {
    exclude: [
      "@design-scenes/geom",
      "@design-scenes/mark",
      "@design-scenes/euclid2",
    ],
  },
});
