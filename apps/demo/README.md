# oblik-demo

Greenfield paper for Prototype 6. Scenes live in `src/scenes/`; the header picker lists them (like P5). URL: `?scene=<id>`.

```sh
pnpm demo
```

- `src/scenes/*.ts` — scene modules (`defineScene`): shelf, triangle, shared-loop, truss, mounting-plate
- `src/scene-loaders.ts` — stub; the oblik Vite plugin emits the real `import()` map + HMR accept from files on disk (new `*.ts` scenes register without restart)
- `src/main.tsx` — mount + catalog HMR
