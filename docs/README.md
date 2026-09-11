# Docs

- [Intent](./intent.md) — programs, pure libraries, declared editors
- [Chrome](./chrome.md) — hover and selection halos (construction + figure)
- [Refactoring plan](./refactoring-plan.md) — geometry kinds, the GPU renderer, and what the SVG strip left behind
- [euclid2 graph](./euclid2-graph.md) — P5-era history: 2D constructors, annotator, potential vs actual
- [euclid2 worked example](./euclid2-worked.md) — P5-era history: shelf / reach / beam; where the graph fails intent

Prototypes (charter + what we learned):

- [1 — identity and scene widgets](./prototypes/1.md) — closed (early shape: Asked / Learned / Keep)
- [2 — catalog and shell layouts](./prototypes/2.md) — closed (early shape: Asked / Learned / Keep)
- [3 — insert from the canvas](./prototypes/3.md) — shipped
- [4 — types, introductions, resolvers](./prototypes/4.md) — closed; Point + Distance slice
- [5 — construction graph](./prototypes/5.md) — closed; constructors + named fields + Space tools
- [6 — oblik: tape, draft, SVG](./prototypes/6.md) — open; greenfield runtime next to paper. [Learned from using it](./prototypes/6.md#learned-from-using-it) (Tab, gliders, length reuse, Solid 2 pane identity). Style sheet was a failed experiment — see P7.
- [7 — Loop, Region, Csg2 on the euclid2 tape](./prototypes/7.md) — shipped (language). `region(cycle, holes, id?)`; Space Region tool; `diff` / `union` / `intersect` / `pick` / `roundOffset`. Horizon: paper inks a sketch.
- [8 — mentionable scopes](./prototypes/8.md) — shipped (learned). Insert and snap print names legal in the focused function + invocation. Pass: `const plate = mountingPlateLayout()`. Remaining: caller-side binding; no remove-from-return.
- [9 — figure](./prototypes/9.md) — building. `paint` ink objects; Brush/Eraser; Shift-onion. Style swatches later. Export later.
- [10 — user composite functions as Space tools](./prototypes/10.md) — building. `defineTool` registers one function as a palette verb.
- [11 — incremental evaluation](./prototypes/11.md) — building. Site memoization, user `memo()`, pick prefilter.
- [12 — a WebGPU 2D canvas renderer (`euclid2-typegpu`)](./prototypes/12.md) — shipped; closed. Fills, fields, chrome, picking — and the SVG view is gone (`dfc1b86`), so this is the only euclid2 renderer. [Points plan](./prototypes/12-gpu-points-plan.md) (historical).
- [13 — tracing a raster reference](./prototypes/13.md) — built. An `image(...)` trace node drawn as a textured quad, import by paste / drop / picker / dropped path, and the inspector: rotate in 90° steps, flip, position, target size, and the style dials (opacity, saturation, contrast). Built: the node and its patch endpoint, the pick arms, the GPU layer (quad, style dials, region-style selection chrome), all four import paths, the inspector, and previews that write once per gesture rather than once per pointer event. Cut from it: scaling from a known distance, and canvas drag-to-move — both later slices.

[Critique](./critique.md) records why unmarked-literal CAD and a single kernel were dropped.
