# oblik-demo

oblik runtime demo. Scenes live in `src/scenes/`; the header picker lists them. URL: `?scene=<id>`.

```sh
pnpm demo
```

- `src/scenes/*.ts` — catalog (`defineScene`): shelf, triangle, shared-loop, truss, mounting-plate
- `src/layout/` — helpers the catalog imports (stamp/analyze/HMR like scenes)
- `src/scene-loaders.ts` — stub; the oblik Vite plugin emits the real `import()` map + HMR accept from catalog scenes and helpers
- `src/main.tsx` — mount + catalog HMR
