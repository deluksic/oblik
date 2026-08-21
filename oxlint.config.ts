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
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx"],
      plugins: ["vitest"],
      env: {
        vitest: true,
      },
    },
  ],
});
