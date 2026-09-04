import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "vitest"],
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  ignorePatterns: [
    // Scene files are written by the oblik editor (and AI) — do not lint them at all.
    "**/scenes/**",
    "**/*.scene.ts",
  ],
  env: {
    browser: true,
    node: true,
    es2023: true,
  },
  rules: {
    "eslint/no-unused-vars": [
      "error",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "eslint/no-underscore-dangle": "off",
    "import/no-unassigned-import": [
      "error",
      {
        allow: ["**/*.css", "**/*.module.css"],
      },
    ],
    "eslint/no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "solid-js",
            importNames: ["onSettled"],
            message: "onSettled is forbidden — use createEffect (compute/effect split) instead.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx"],
      plugins: ["vitest"],
      env: {
        vitest: true,
      },
    },
    {
      // Demo app glue (main.tsx, scene-loaders.ts) imports scene modules and
      // virtual:oblik-* modules whose exports are only consumed by the host.
      files: ["apps/demo/**/*"],
      rules: {
        "eslint/no-unused-vars": "off",
      },
    },
    {
      files: ["**/*.{css,module.css}"],
      rules: {
        "import/no-unassigned-import": "off",
      },
    },
  ],
});
