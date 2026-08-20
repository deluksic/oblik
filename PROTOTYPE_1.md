# Prototype 1 — identity and scene widgets (2D)

Charter for the first experiment. Build this, then write conclusions before planning prototype 2.

## Goal

Prove the split: **pure library geometry** plus a **scene-only widget library**, with **hover / select / identity** good enough that a human could bind an editor to something they clicked.

The one interaction that must work:

1. A library function draws several pieces of geometry (at least a polyline or union-like group, not a single circle).
2. In a scene, you pass in values from `editPoint` / `editPointOnLine` / `editDistanceToPoint`.
3. You can hover and select a library-drawn piece on the canvas and see a breadcrumb + jump to its creation site.
4. Dragging a scene widget rewrites **only** that widget’s literals in the scene file; the library output follows.

If (3) falls apart inside groups or `map`, that is a successful failure — record it in the postmortem.

## Non-goals

- TypeGPU, tsover, WASM, SDF, 3D, maps, slicers, PNG converters
- VS Code / Cursor extension (web preview is enough)
- Click-to-insert at the caret, extract-parameter across files
- Inferring handles from unmarked numeric literals
- Auto-inserting `edit*` from a pick (select + breadcrumb only)
- Pretty CAD UX, grid-snapping as a product, export formats

## Pass

- Scene file contains explicit `edit*` calls whose numbers change when you drag.
- Library module has no imports from the widget/preview layer.
- Hover/select highlights the right drawable; breadcrumb is stable across a re-run after a drag.
- Jump-to-source opens the library (or scene) line that *created* the value, not just “the draw loop.”
- Broken scene source keeps the last good frame and shows the error.

## Fail (stop and write conclusions)

- Identity is pointer equality that breaks every frame, or every `line()` looks like every other `line()`.
- The only way to make gizmos work is to put them inside the library.
- Drag requires a hidden input store that is not in the scene source.
- Pick cannot distinguish instances in a small loop (`for i in 0..3`).

## Layout

```
lib/          pure functions; geometry values carry identity
euclid2/      canvas renderer, pick buffer, widget library
scenes/       one or two scene modules (the programs)
shell/        load scene, preview, apply text edits to the scene file
```

Expect to replace `euclid2/` when a second scene type forces a real protocol. Do not abstract that protocol up front.

## Identity (minimum)

Every geometric value the library returns should carry:

- a **stable id** (not a memory address): kind + parent id + local index, or an explicit tag
- **provenance**: file/line of the constructor call if cheap, otherwise the library function name + index
- enough structure for a breadcrumb (`group/seg[2]`)

Picking hits the 2D drawable list, not pixels of a shader. Loops must produce distinct ids per instance.

Untagged internals are still selectable. Widgets are *not* auto-created from selection in this prototype.

## Widgets (scene type library)

Ship only these:

| Widget | Writes | On screen |
| --- | --- | --- |
| `editPoint(x, y)` | two numbers | draggable point |
| `editDistanceToPoint(origin, d)` | `d` | circle around origin |
| `editPointOnLine(line, t)` | `t` | glider on that line |

They return plain data the library understands (`Point`, `number`, …). The widget layer may keep extra handles for drawing gizmos; the library never sees those.

`editPointOnLine` needs a `line` already in scope in the **scene**. Do not recover a line from a pick in P1. The scene author passes it.

## Shell

- Web app, uncommon port, 2D canvas (or SVG) graph paper.
- Scene is TypeScript in-repo, hot-reloaded. Monaco optional; a known `scenes/*.ts` file plus filesystem watch is enough.
- Drag → `TextEdit` on the numeric tokens of that `edit*` call (quantize, e.g. 0.01). Format on pointer-up if at all, not on every move.
- Last-good-frame on compile/runtime error.

## Implementation order

1. Geometry values + ids; draw a hardcoded library result on paper.
2. Hover/select + breadcrumb + jump-to-source (even if source maps are crude).
3. Scene module calling the library with **constants** (no widgets yet).
4. Widget library + drag rewriting scene literals.
5. One scene that uses all three widgets as inputs to the library.
6. A tiny loop in the library; confirm instance pick.

Stop there. Write `PROTOTYPE_1_CONCLUSIONS.md` (or a section) before proposing P2.

## P2 candidates (do not do them now)

Only to show the fence: PNG as an artifact; a second view on the same module; pick → offer to insert `edit*` (code action); TypeGPU field view. P1 should make those *possible to discuss*, not implement them.
