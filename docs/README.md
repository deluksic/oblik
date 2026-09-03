# Docs

- [Intent](./intent.md) — programs, pure libraries, declared editors
- [Layout](./layout.md) — packages, import rules, identity, widget write-back
- [Scenes](./scenes.md) — catalog, layouts, marks, Space palette
- [Chrome](./chrome.md) — hover and selection halos (construction + figure)
- [euclid2 graph](./euclid2-graph.md) — 2D constructors, annotator, potential vs actual
- [euclid2 worked example](./euclid2-worked.md) — shelf / reach / beam; where the graph fails intent

Prototypes (charter + what we learned):

- [1 — identity and scene widgets](./prototypes/1.md)
- [2 — catalog and shell layouts](./prototypes/2.md)
- [3 — insert from the canvas](./prototypes/3.md)
- [4 — types, introductions, resolvers](./prototypes/4.md) — closed; Point + Distance slice
- [5 — construction graph](./prototypes/5.md) — closed; constructors + named fields + Space tools
- [6 — oblik: tape, draft, SVG](./prototypes/6.md) — open; greenfield runtime next to paper. [Learned from using it](./prototypes/6.md#learned-from-using-it) (Tab, gliders, length reuse, Solid 2 pane identity). Style sheet was a failed experiment — see P7.
- [7 — Loop, Region, Csg2 on the euclid2 tape](./prototypes/7.md) — shipped (language). `region(cycle, holes, id?)`; Space Region tool; `diff` / `union` / `intersect` / `pick` / `roundOffset`. Horizon: paper inks a sketch.
- [8 — mentionable scopes](./prototypes/8.md) — shipped (learned). Insert and snap print names legal in the focused function + invocation. Pass: `const plate = mountingPlateLayout()`. Remaining: caller-side binding; no remove-from-return.
- [9 — figure](./prototypes/9.md) — building. `paint` ink objects; Brush/Eraser; Shift-onion. Style swatches later. Export later.

[Critique](./critique.md) records why unmarked-literal CAD and a single kernel were dropped.
