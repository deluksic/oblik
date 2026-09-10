import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100,
  sortImports: {},
  // Vendored skill content (pinned by `skills-lock.json`, sourced from upstream)
  // is not ours to reformat: `pnpm fmt` would drift it from the pinned source.
  ignorePatterns: [".agents/skills/**"],
});
