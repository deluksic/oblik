# oblik-demo

Greenfield paper for Prototype 6. Scenes live in `src/scenes/`; the header picker lists them (like P5). URL: `?scene=<id>`.

```sh
pnpm demo
```

- `src/scenes/*.ts` — scene modules (`defineScene`): shelf, triangle, shared-loop, truss, mounting-plate
- `src/scene-loaders.ts` — `import.meta.glob` for lazy load + HMR
- `src/main.tsx` — mount + catalog HMR
