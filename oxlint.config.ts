import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "vitest"],
  // eslint-plugin-solid loaded through oxlint's JS-plugin bridge (ESLint v9 API).
  // We follow its `v2` preset — this repo is on Solid 2 RC — minus the
  // SolidStart-only server-function rules.
  // https://github.com/solidjs-community/eslint-plugin-solid
  jsPlugins: [{ name: "solid", specifier: "eslint-plugin-solid" }],
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
    // Policy: `null` is not used in this codebase — absence is `undefined`. DOM
    // and JSON produce `null` only at the platform boundary and are converted
    // there (`?? undefined`). JSX conditional children never use `: null`
    // (use `<Show>` / `: undefined`). No `== null` nullish idiom either — write
    // `=== undefined` / `!== undefined` or optional chaining. This note lives
    // next to the rules that enforce it (eqeqeq, unicorn/no-null) and in the
    // solidjs skill.
    "eslint/eqeqeq": ["error", "always"],
    "unicorn/no-null": "error",
    // eslint-plugin-solid (Solid 2) — the `v2` rule set.
    "solid/jsx-no-duplicate-props": "error",
    "solid/jsx-no-undef": "error",
    "solid/jsx-uses-vars": "error",
    "solid/no-unknown-namespaces": "error",
    "solid/no-innerhtml": "error",
    "solid/jsx-no-script-url": "error",
    "solid/components-return-once": "error",
    "solid/no-destructure": "error",
    "solid/prefer-for": "error",
    "solid/reactivity": "error",
    "solid/event-handlers": "error",
    "solid/imports": "error",
    "solid/style-prop": "error",
    "solid/no-react-deps": "error",
    "solid/no-react-specific-props": "error",
    "solid/self-closing-comp": "error",
    "solid/no-array-handlers": "error",
    // prefer-show intentionally OFF: JSX ternaries are allowed — they give TS
    // narrowing that <Show when> children do not. (No-null still bans the
    // `: null` child form; use `: undefined` or <Show> there.)
    "solid/no-proxy-apis": "error",
    "solid/prefer-classlist": "error",
    "solid/removed-api": "error",
    "solid/no-single-arg-create-effect": "error",
    "solid/no-accessor-as-prop": "error",
    "solid/prefer-structured-class": "error",
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
