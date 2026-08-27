# oblik

Geometry construction with **mentionable scopes**: insert and snap print names that are legal in the focused function + invocation.

```sh
pnpm --filter oblik test
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127). Charter: [docs/prototypes/8.md](../../docs/prototypes/8.md).

App imports: `oblik` (eval/geom/source), `oblik/host` (`mountOblik`, scene picker), `virtual:oblik-catalog` + `virtual:oblik-annotations` (annotations + mention analysis) + `scene-loaders.ts` in the demo. The Vite plugin stamps/analyzes all `apps/demo/src/**/*.ts` helpers.

**Pass scene:** Mounting plate. `build` binds `const plate = mountingPlateLayout()`. From that parent, snap `plate.drill` (not private `hLeft`). Select a private or a helper frame in the origin sidebar to dive — insert lands in `src/layout/mounting-plate.ts` before that function’s `return`.
