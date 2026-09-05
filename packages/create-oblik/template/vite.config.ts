import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import { oblikPlugin } from "oblik/plugin";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    solid(),
    Icons({ compiler: "solid" }),
    oblikPlugin({
      workspaceRoot: appRoot,
      sceneDir: path.join(appRoot, "src/scenes"),
    }),
  ],
  server: {
    port: 43127,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["oblik"],
  },
});
