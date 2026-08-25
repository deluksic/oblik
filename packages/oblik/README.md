# oblik

P6 runtime: `evaluate` + tape, source stamp/patch, euclid2 SVG view.

```sh
pnpm --filter oblik test
pnpm demo
```

Opens [http://127.0.0.1:43127](http://127.0.0.1:43127). Charter: [docs/prototypes/6.md](../../docs/prototypes/6.md).

App imports: `oblik` (eval/geom/source), `oblik/host` (`mountOblik`, scene picker), `virtual:oblik-catalog` + `scene-loaders.ts` in the demo. The Vite plugin is `oblik/plugin` in `package.json` exports; `vite.config.ts` must import the `.ts` file with a relative path because Node loads the config.
