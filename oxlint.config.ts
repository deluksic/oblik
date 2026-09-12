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
    // Vendored third-party source (typegpu-geometry for the P12 prototype).
    "**/vendor/**",
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
    // Type-only imports are erased at runtime, so they cannot form a real
    // dependency cycle — `ignoreTypes` keeps this about runtime coupling.
    "import/no-cycle": ["error", { ignoreTypes: true }],
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
    // No debug logging: `console.log` (and its verbosity cousins — `debug`,
    // `info`, `trace`, …) must not ship. `console.warn` / `console.error` stay
    // for real diagnostics. CLI entrypoints opt out below, because there stdout
    // *is* the product. A deliberate one-off (a test dumping a shape census)
    // opts out in place with `// eslint-disable-next-line no-console`.
    "eslint/no-console": ["error", { allow: ["warn", "error"] }],
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
      // The value and evaluation layers are framework-free by construction:
      // `geom/` never imports `eval/`, and `eval/` never imports the view or a
      // UI framework. That seam is what keeps the caching mechanism replaceable
      // without touching scene files. Enforced here, and stated in AGENTS.md.
      // Tests are exempt: an integration test legitimately drives the whole
      // pipeline (e.g. demo-scenes.test.ts renders scenes through the view).
      files: ["packages/oblik/src/geom/**", "packages/oblik/src/eval/**"],
      excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/euclid2/**", "**/figure/**", "**/host/**", "solid-js", "@solidjs/*"],
                message:
                  "geom/ and eval/ are framework-free: no view imports, no solid-js. " +
                  "Keep values pure so a different invalidation strategy can replace eval/memo.ts.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx"],
      plugins: ["vitest"],
      env: {
        vitest: true,
      },
    },
    {
      // Command-line tools (the scaffolder, one-shot codemods): writing to
      // stdout/stderr is their interface, not leftover debug output.
      files: ["scripts/**", "packages/create-oblik/**"],
      rules: {
        "eslint/no-console": "off",
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
