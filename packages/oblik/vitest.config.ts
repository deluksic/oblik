import path from "node:path";
import { fileURLToPath } from "node:url";

import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vitest/config";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

/** Shader tests: TGSL bodies need `unplugin-typegpu` to be transformed before
 * `tgpu.resolve` can compile them to WGSL — that is how the GPU pipelines are
 * checked without a device, so `pnpm test` runs these too. The transform is only
 * wanted for them: over the whole suite it triples the transform cost and
 * perturbs unrelated tests, hence the separate project.
 *
 * The pattern is `**\/wgsl.test.ts`, not `**\/*.wgsl.test.ts`: a bare `*.`
 * segment in an include glob matches nothing here (no stem before the dot). */
const SHADER_TESTS = "**/wgsl.test.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(packageRoot, "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          exclude: ["**/node_modules/**", SHADER_TESTS],
        },
      },
      {
        extends: true,
        root: packageRoot,
        plugins: [typegpu()],
        test: {
          name: "shaders",
          environment: "node",
          include: [SHADER_TESTS],
        },
      },
    ],
  },
});
