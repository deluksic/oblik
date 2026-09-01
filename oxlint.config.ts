import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "vitest"],
  categories: {
    correctness: "error",
    suspicious: "error",
  },
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
      // Scene files keep named `const` bindings for interactive editing even when
      // not yet referenced in the rest of the scene.
      files: [
        "apps/**/scenes/**/*",
        "apps/**/*.scene.ts",
        "apps/**/demo/**/*",
      ],
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
