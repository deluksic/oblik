# oblik-demo

Greenfield paper for Prototype 6. This app is scenes plus a Vite entry that mounts `oblik/host`. The host switches on `scene.kind` (`euclid2` today).

```sh
pnpm demo
```

- `src/scenes/shelf.ts` — the scene
- `src/main.tsx` — mount + HMR (`import.meta.hot.accept` has to live here; Vite accept is relative to the importer)
