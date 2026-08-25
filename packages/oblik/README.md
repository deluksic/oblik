# oblik

P6 runtime: `evaluate` + tape, source stamp/patch, euclid2 SVG view.

```sh
pnpm --filter oblik test
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127). Charter: [docs/prototypes/6.md](../../docs/prototypes/6.md).

App imports: `oblik` (eval/geom/source), `oblik/host` (`mountOblik`, scene picker), `virtual:oblik-catalog` + `virtual:oblik-sheet` + `scene-loaders.ts` in the demo. The Vite plugin **replaces** `scene-loaders.ts` on every transform with a disk-scanned `import()` map (plain JS — no `satisfies`) and stamps/analyzes all `apps/demo/src/**/*.ts` helpers, not only catalog scenes. `vite.config.ts` must import the plugin `.ts` file with a relative path because Node loads the config.

Host: async `createMemo` for the scene module; a **`sceneKind` memo** chooses `<Euclid2Pane>` so HMR does not remount it. `scene={scene()}` stays in JSX. Insights: [docs/prototypes/6.md](../../docs/prototypes/6.md#learned-from-using-it).
