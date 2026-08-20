# Prototype 2 — conclusions

Built a scene catalog and a pane workspace: a file in `scenes/` is the registry, layouts are CSS grid areas named by scene id, view hosts plug in, libraries stay pure.

## Pass

- Adding `scenes/hello.ts` is enough for nav + `?scene=hello`. No `main.ts` branch, no canvas ids in HTML.
- Layout-only files (`rose.ts`, `split.ts`, …) do not import pane modules. Live drag still updates the other panes via widget channels (`"plate"`, `"cylinder"`, `"profile"`).
- Hosts are `euclid2` / `euclid3` / `sdf` / `sdf2`. The shell does not import geometry.

## What failed (usefully)

**Widget write-back looked like a full app refresh.** The catalog fingerprint correctly ignored number patches, but Vite still HMR’d glob-loaded scene modules with no acceptor, so the client did `page reload`. Cameras reset. Fix: swallow HMR when the file still matches the write; `scene-loaders` accepts every scene path so a *real* editor save hot-swaps.

**Channels are still magic strings.** `withoutWidgets(fn, "plate")` must match the catalog id. Wrong channel silently collides on widget index 0.

**Cross-scene `hot.accept("./plate.ts")`** in mill/helix/rose is a second path besides the glob. Needed so `let readPlate = plateLayout` updates on a real save. Do not confuse it with write-back.

## Do not

- Put gizmos in domain libraries.
- Import pane modules from a layout file.
- Treat catalog HMR as “the file changed.”
- Infer handles from unmarked numbers (still).

## Next

P3: the user should not have to type `editPoint` to get a handle. Charter: [PROTOTYPE_3.md](./PROTOTYPE_3.md).
