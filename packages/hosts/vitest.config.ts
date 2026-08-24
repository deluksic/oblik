import path from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(packageRoot, "../..");

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(workspaceRoot, "packages/shell/src"),
    },
  },
});
