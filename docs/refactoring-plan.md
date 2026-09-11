# Refactoring plan — geometry kinds, the GPU renderer, and the euclid2 SVG strip

**Status:** plan. Nothing here is started except the strip in §4, which is the current work item.
**Scope:** `packages/oblik`. Three concerns that turned out to be one pattern seen at three scales.
**How to read it:** every item states the evidence, why it matters, the change, and how it is verified. Section 6 lists the doc drift to fix in the same passes. Section 7 is the "do not do this" list.

The plan is ordered so each step is verifiable on its own and none of them requires the next. Steps marked **[mechanical]** are intended to be pure moves with no behaviour change; they are verified by the existing suites, and any semantic slip shows up as a diff in the byte-pinned WGSL tests.

---

## 1. The pattern

The same disease appears at three scales: **one concept re-expressed by hand in N places, where N-1 of them are unchecked.**

| scale            | the concept                                                                        | restated                        | checked by the compiler |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------- | ----------------------- |
| geometry kinds   | "what kinds of geometry exist, and which are fillable / paint-able / operand-able" | ~15 sites, 4 encodings          | 2 of them               |
| field evaluation | "what the signed distance of a node is"                                            | 4 floating-point transcriptions | none numerically        |
| renderer         | "where a world point lands on screen"                                              | 7 copies                        | none                    |

The consequences differ, but the fix is the same shape: make one place the source of truth and let the compiler demand the rest. Feature files (§2.7) are where the per-kind handler bodies should live; the table is how they are found. Neither alone is enough — files without a table leave the silent fallthroughs, a table without files leaves the bodies scattered.

---

## 2. Geometry kinds

### 2.1 The restatement sites

Adding `polarRepeat` touched **12 non-test source files and 7 test files**. Split by whether a missed site is a compile error or a silent wrong render:

| encoding                                                       | sites                                                                                                                                                                                                         | missed →                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| TS union (`CsgOperand` at `geom/types.ts:93`, `Geom` at `:95`) | 2                                                                                                                                                                                                             | compile error ✅                           |
| `kind ===` if-chains                                           | `geom/csg2.ts` (34), `geom/csg-draw.ts` (30), `euclid2/pick.ts` (19), `gpu/field/plan.ts` (15), `figure/export.ts` (12), `gpu/field/eval.ts` (8), `geom/evaluate-regions.ts` (7), `gpu/field/assemble.ts` (6) | silent ❌                                  |
| hand-written string lists                                      | `asOperand` (`csg2.ts:146`), `isFillGeom` (`csg2.ts:53`), `source/mention.ts:331`, `figure/chips.ts:53`                                                                                                       | silent ❌                                  |
| hand-written union aliases                                     | `Region \| Csg2 \| Pick \| PolarRepeat` spelled out at `csg2.ts:392` (`fillAabb`), `csg-draw.ts:444,452,454` (`fillPaint`, its cache, `fillPaintFresh`), `figure/export.ts:159` (`regionToSvg`)               | compile error, but 7 copies of one idea ⚠️ |

Note the asymmetry that makes this expensive: the two _typed_ gates are the cheap ones to satisfy, and the sites a new primitive actually breaks in — paint, plan, pick rank — are the untyped ones.

### 2.2 Silent fallthrough is the dispatch convention

Every chain ends in a default that _means_ something, and the meanings differ:

- `isFiniteOperand` (`csg2.ts`) falls through to `isFiniteCsg2(op)` → `op.of.length`. A new **leaf-shaped** kind throws; a new **wrapper-shaped** kind (one with `of`) returns `true` and is then evaluated as a `csg2` — wrong geometry, no error.
- `planOf` (`field/plan.ts:124`) falls through to `undefined` → the node silently drops to the span path. On a repeat that is the difference between one tooth of work per pixel and a multi-second `evaluateRegions`.
- `stampedPaint` (`csg-draw.ts`) returns `undefined` → silently the CSG compiler (seconds, on every trace tick).
- `fillPaintFresh` falls through to `emptyPaint()` → silently draws nothing.
- `isFillGeom` / `asOperand` string lists → silently not a fill / not an operand.

**Change:** one `Record<Kind, Handler>` (or `switch` + `assertNever`) per layer, and replace the four string lists with sets derived from the kind table. Every one of the above becomes a compile error.

### 2.3 Four transcriptions of the field, and the parity gap

The signed distance of a node exists in four places:

1. `geom/repeat.ts` `foldPolar` — the float64 reference.
2. `geom/csg2.ts` `operandSdf` → `foldIntoCopy` — calls the reference.
3. `gpu/field/eval.ts:33-42` — the fold inlined **on purpose** ("this file is the shader's mirror").
4. `gpu/field/assemble.ts:80-85` — the same expression as WGSL.

The parity apparatus checks the wrong pair: `plan.test.ts` holds #3 to #1 **numerically** (12,690 probes, agreement 1.3e-15), while `wgsl.test.ts` holds #4 to the expected **text**. Nothing runs the shader numerically — which is exactly how the missing `− rotation` in the fold shipped: the two JS copies agreed perfectly and only the screen caught it. The string-pinning test added afterwards is a regression test for that one bug, not a guard on the class.

**Change (either, not both):** delete the middle transcription (`eval.ts` calls `foldPolar`, accepting a weaker mirror) **or** close the numeric gap (#4 vs the reference) with a real check — the device-free `tgpu.resolve` path plus the `shaders` vitest project, or a small CPU evaluator. Keeping three copies and checking two is the actual defect.

### 2.4 Cache-key invariants live in prose

Four hand-built strings decide what is recompiled and what is reused:

| key                                         | where                      | invariant                                                           |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `plan.shape`                                | `field/plan.ts:45,110,122` | must capture _everything_ the emitted WGSL depends on               |
| `nodeKey` = `id:occ`                        | `adapter.ts:179`           | stable exactly when the trace-reuse pass considers a node unchanged |
| `${shape}\|${layer}`                        | `assemble.ts:327`          | fragments                                                           |
| `${shape}\|${layer}\|${format}\|${samples}` | `assemble.ts:351`          | pipelines                                                           |

`nodeKey`'s invariant is documented at the pool (`gpu/slots.ts`). `shape`'s is not enforced anywhere: if a future feature changes the emitted WGSL without extending the shape string, two different shapes share one pipeline and the second one renders wrong. `wgsl.test.ts` checks _same shape ⇒ byte-identical WGSL_, which is the other direction.

**Change:** make the key a total function of the plan — `shapeOf(node: FieldNodePlan)` with an exhaustive `switch` over node kinds, so a new node kind cannot be planned without contributing to the key.

### 2.5 Leaf records are lettered, not typed

`FieldLeafData` (`field/plan.ts:52-61`) reuses `a`, `b`, `r` across kinds: `a` is a circle centre, a half-plane origin, or a repeat axis; `b.y` is "step" for a repeat and "inside normal" for a half-plane; `r` is a radius, a distance, _or_ a count. The comment explains it honestly. The GPU cost of fixing it is zero — the record is 16 B either way.

**Change:** one `d.struct` per leaf kind, or named fields with only the used ones live. Low value on its own; do it while touching the leaf table in §2.7.

### 2.6 Paint special-cases recognize authored idioms

`stampedPaint` (`csg-draw.ts`) does not merely dispatch on the repeat — it shape-matches `diff(union([circle…, repeat]), cuts)` and then _guesses_ whether each circle is a droppable hub via `outlineInnerRadius`. Two consequences:

- The SVG fast path's correctness depends on how scenes happen to be written.
- A semantic requirement of the fold (a hub disc under the cells, or the seams show as spokes) is expressed as a scene-level `union`, so the paint layer has to infer it back.

**Change:** make the hub part of `polarRepeat` — the fold emits `min(hub, fold(cell))` when the cell reaches the axis, which is a property of the cell, not a scene decision. That deletes the idiom matching, `outlineInnerRadius`, the mandatory scene-level `union`, and the "hub must be _inside_ the copies or the SVG paint falls back to a seconds-long boolean" tacit rule. In the same pass, validate the fold's other two preconditions (cell centred on its own sector, cell not straddling the axis) in the constructor instead of in a doc comment.

### 2.7 Target layout: feature files **and** a derived union

`euclid2/tools/` is the house precedent for the feature-file half: one file per verb (`circle.ts`, `tangent.ts`, `roundOffset.ts`, `two-point.ts`, …), a `registry.ts` spine, a shared `types.ts`, and a small required core with optional capabilities (`commit?`, `keys?`). It also shows the trap: `BuiltinToolId` (union) and `BUILTIN_IDS` (`registry.ts:8`) restate the same set, element-checked but **not** completeness-checked, with no test forcing coverage. Same shape as `asOperand`/`isFillGeom`.

So: feature files for the bodies, plus a table that is the _source of truth for the union_:

```ts
// geom/kinds/index.ts — the set is written once
export const operandKinds = { region, circle, halfPlane, offset, pick, csg2, polarRepeat } as const;
export type OperandKind = keyof typeof operandKinds;
export type CsgOperand = KindValue<typeof operandKinds>; // derived, never restated
export const FILL_KINDS = { region, polygon, csg2, pick, polarRepeat } as const; // isFillGeom
```

One feature is **two files, not one**, because `geom/` is self-contained today (verified: no cross-layer imports at all) and `gpu/` imports it. A kind needing both an SDF and a WGSL emit cannot live in one file without `geom` → `typegpu`, which breaks the invariant 12.md locks. The seam is real and already respected:

```
geom/kinds/repeat.ts        foldPolar + isFinite + sdf + aabb + stamp + mergeOutline
gpu/field/kinds/repeat.ts   plan wrap (shape) + leaf packing + WGSL emit + the eval mirror
geom/kinds/index.ts         operandKinds   ← spine 1
gpu/field/kinds/index.ts    leafKinds      ← spine 2
geom/csg2.ts                algebra only: csgSdf, isFiniteCsg2, dispatch via table
geom/evaluate-regions.ts    algebra only: booleanRegions, clipByPlanes
geom/csg-draw.ts            algebra only: diff/union composition, mask merging
```

Three constraints that keep it from sprawling:

1. **The required core stays tiny** (`isFinite`, `sdf`, `aabb`). Everything else is a per-layer capability a kind opts into — paint, field plan/emit, ctor, pick rank (`pick.ts`'s `return 2` is literally a table entry). Forcing nine methods on `circle` is how this pattern becomes stub soup.
2. **Algebra does not move.** The boolean fold, `min`/`max` composition, mask merging and AABB union are not kind behaviour; they stay in the layer modules, which then read as "order of operations" plus a table lookup.
3. **Shared helpers must be exported or relocated.** `unwrapUnary`, `asSolid`, `outlineInnerRadius`, `mergeRepeatOutline` are private in `csg-draw.ts` / `evaluate-regions.ts` and the repeat handler needs them — they want a `kinds/common.ts`.

Payoff beyond tidiness: the four transcriptions of the fold become two locations, with the mirror sitting next to the WGSL it mirrors (the rotation bug was invisible because the reference and the mirror fit on one screen and the shader did not).

### 2.8 Steps

1. **[mechanical]** `geom/kinds/` with the interface and the derived union; move the geometry-side handlers (sdf, aabb, isFinite, paint, stamp, rank). Layer files keep algebra + dispatch.
2. **[mechanical]** `gpu/field/kinds/` with the leaf/node handlers and the mirror.
3. Delete the leftover string lists and guard tails; the compiler names every site.
4. Collapse or check the transcriptions (§2.3).
5. `shapeOf` as a total function (§2.4).
6. Auto-hub + precondition validation (§2.6), then the leaf structs (§2.5).

**Verification:** `field/wgsl.test.ts` pins emitted WGSL byte-for-byte and `plan.test.ts` runs 12,690 probes, so steps 1–2 are unusually safe: any accidental semantic change is a text diff. Steps 4–6 change behaviour and need their own tests (the fold's brute-force oracle in `geom/repeat.test.ts` is the model).

---

## 3. The renderer

Structurally this is the soundest part of p12 and the plan should not disturb it: **one command encoder, one render pass, one submit per frame** (`painter.ts:492-585`), demand-driven rAF with a dirty flag (`renderer.ts:54-56,110-115`), every bind group created once at painter construction, an MSAA texture cached across frames, and keyed slot pools with first-fit reuse (`slots.ts`).

### 3.1 Cross-cutting invariants, transcribed

| invariant    | copies | where                                                                                                                                                                                                                |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| world → clip | **7**  | `toClip` in `pipelines/fills.ts:27`, `disks.ts:11`, `strokes.ts:24`, `circles.ts:11`, `grid.ts:74`, `field/assemble.ts:246`, plus a screen-space variant `markers.ts:52` — each with its own `(scale*2)/max(1,pane)` |
| 4× MSAA      | **9**  | `multisample: { count: 4 }` in 7 pipeline modules, `MSAA_SAMPLES = 4` (`painter.ts:38`), `sampleCount: 4` (`renderer.ts:103`)                                                                                        |
| band order   | **3**  | the comment at `painter.ts:532`, `InkBands` (`adapter.ts:111`), and the draw sequence (`painter.ts:536-570`)                                                                                                         |

`haloWithEdge` / `paintWithEdge` / `spanWalk` prove shared TGSL functions work here; `toClip` is the one that never got the treatment, and a single divergent copy means one band draws at a slightly different camera. MSAA fails loudly when it drifts (validation error at pipeline creation), but only at runtime. **Change:** one exported `RENDER_SAMPLES`; one shared `clipFrom(frame)` `tgpu.fn`. **[mechanical]**

### 3.2 Per-frame waste

- **Pipeline lookup inside the frame loop.** `painter.ts:527` calls `fieldPipeline(...)` per fill run per frame, which builds `` `${plan.shape}|${layer}|${format}|${samples}` `` and does two `Map` lookups (`assemble.ts:329-351`). Pure per-frame string work, forever. **Change:** resolve the pipeline when the adapter emits the `FillDraw` (or memoize by plan object in a `WeakMap`).
- **Order arrays are rewritten wholesale every tick** (`painter.ts:429-462`): 5 stroke bands + 5 circle bands + points + fills + field order. A hover legitimately reshuffles two; a camera pan, a theme change, or a value-only drag changes **none**. `TickPatch` already knows the band partition. **Change:** gate the order writes on a partition generation — the same "rewrite only when the input changed" rule the record diffs already follow. This is the concrete answer to 12.md's open question 2.

### 3.3 Jank on a shape change

`fieldPipeline` creates the pipeline lazily on the first draw of a new shape (`assemble.ts:363`) — a synchronous TGSL → WGSL → `createRenderPipeline` **inside the rAF callback**, i.e. exactly when a tool adds or removes an operand mid-drag. **Change:** build at plan-change time (the adapter tick, outside rAF) or `initAsync()` it ahead. The TypeGPU skill's guidance is explicit about keeping pipeline creation off the interaction path.

### 3.4 Draw-call growth

One draw per fill node per layer (`painter.ts:520-531`) plus 10 ink band draws plus overlay. This is correct as designed — translucent overlap plus halo-under-paint makes order load-bearing — but it is O(fills) draw calls, so it breaks first at scale.

**Change (needs a design note before code):** merge consecutive, same-layer runs whose AABBs are pairwise disjoint. Disjoint regions share no pixels, so alpha compositing between them is order-independent; the merge is safe by construction, not by measurement. This turns N separated fills into O(overlap clusters) draws. Any run-merging must preserve relative order between _overlapping_ nodes, and the same reasoning can extend to ink later.

### 3.5 Capacity caps fail silently

`SlotPool.alloc` returns `undefined` and the adapter skips the node (`slots.ts:94`); the overlay clamps with `Math.min(max, …)` (`painter.ts:469-489`). `fillSpans.test.ts` guards the demo set against the caps, so they cannot drift unnoticed in CI — but a user scene that exceeds one renders a hole with no signal, which is the same failure class as §2.2. **Change:** a dev-only warning per record kind, or a count in the pane status line (which already reports `written/total`).

### 3.6 The diff fast path is an unstated invariant

`writePartial` → `getPatchInstructions` merges _adjacent_ segments into a single `queue.writeBuffer` (`typegpu/core/buffer/buffer.js:208`, `typegpu/data/partialIO.js:99-121`), so a 45-span block costs one call — but only because `pushSegWrites` / `seqWrites` emit ascending contiguous runs. Nothing states or tests that. A future writer emitting out-of-order indices silently degrades to one call per record (still correct, N× the overhead; record size is irrelevant to the cost). **Change:** sort or assert ascending at the patch boundary, and test `instructions ≤ blocks`.

### 3.7 Painter structure

- **656 lines of textual multiplication.** Five chrome bands × two ink kinds = 5 data buffers + 5 order buffers + 5 bind groups + 5 pipeline sets + 5 counts + 5 write blocks + 5 draw blocks + 5 destroy calls, written longhand. **Change:** `const INK_BANDS = [...] as const` with `Record<InkBand, …>`, the pattern `tools/registry.ts` already uses. Collapses ~250 lines and makes the band order data instead of prose in three places.
- **The overlay is a second parallel buffer system** (12 buffers, 12 bind groups, 6 pipeline sets, rewritten every tick via `seqWrites`). Wholesale rewriting is the right call for tiny ghost content, but it should be its own module — buffers, groups, pipelines, writes, and the under/over draw list — leaving `painter.ts` as the world path plus an ordered pair of overlay draws. Ghost rendering is currently spread across `painter.ts` + `overlay.ts` + `adapter.ts`.
- **Grid colours are the last data-that-rebuilds-code.** `setTheme` recreates the grid pipelines because the colours are baked in (`painter.ts:411`), while every other colour rides a record. `GridSpan` is already a uniform — two vec3s there removes a pipeline rebuild per theme toggle.
- **`fragments` is an unevicted module-level `Map`** (`assemble.ts:327`). Harmless at the demo's 9 shapes; noted so it is a decision rather than an oversight.

### 3.8 What to preserve

Single pass/submit; the dirty-flag rAF loop; bind groups built once; the MSAA texture cache and its "let superseded textures be GC'd" rule; keyed pools keyed on `id:occ`; the record-level byte diff; `schemas.ts` as the one home for every record schema; `spanRecords.ts` as the one home for CPU→GPU span translation; `haloWithEdge`/`paintWithEdge` as shared band math.

---

## 4. The euclid2 SVG strip (shipped — `dfc1b86`)

> **Status: done.** This section is the plan for the strip, kept as the record of what was deleted and why; the code it produced is described in [`prototypes/12.md`](./prototypes/12.md) §"One renderer". §4.2 is a completed checklist, not pending work.

Make the WebGPU view the only renderer for `euclid2` scenes: no `SVG | GPU` chip, no per-scene stored choice, no `<Dynamic>` swap. The SVG renderer survived for `figure` scenes and SVG export — this was a strip of the _euclid2_ SVG renderer, not of SVG.

### 4.1 Inventory

**Deleted** (SVG-view-only; no importer outside the view):

| file                                     | lines    | why it can go                                         |
| ---------------------------------------- | -------- | ----------------------------------------------------- |
| `euclid2/view/View.tsx`                  | 512      | `Euclid2View` itself; the only importer is `Pane.tsx` |
| `euclid2/view/View.module.css` + `.d.ts` | 216 + 33 | imported only by the five files in this table         |
| `euclid2/view/Ink.tsx`                   | 380      | SVG ink primitives; SVG view only                     |
| `euclid2/view/Ghost.tsx`                 | 127      | `View.tsx` only                                       |
| `euclid2/view/Hud.tsx`                   | 125      | `View.tsx` only                                       |
| `euclid2/view/Grid.tsx`                  | 50       | `View.tsx` only                                       |
| `euclid2/view/TraceGhost.tsx`            | 58       | `View.tsx` only                                       |
| `euclid2/view/Ink.test.ts`               | 17       | source-text assertions on `Ink.tsx`/`Hud.tsx`         |

**Kept** — the strip's one real surprise: several files under `euclid2/view/` are not part of the euclid2 renderer at all. They are shared contract or SVG components the **figure** kind and the GPU view already depend on:

| file                                                                     | imported by                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `view/chrome.ts`, `view/marks.ts`, `view/pointMark.ts`                   | `gpu/adapter.ts`, `gpu/overlay.ts`, `euclid2-typegpu/BindLabels.tsx`, `pipelines/halo.test.ts` |
| `view/pointer.ts`, `view/chrome-metrics.ts`, `view/createDragHandler.ts` | `figure/View.tsx`, `figure/Ink.tsx`, `host/ResizableSidebar.tsx`, `TypegpuView.tsx`            |
| `view/sliderHud.ts`, `view/SliderDock.tsx`                               | `tools/length.ts`, `TypegpuView.tsx`                                                           |
| `view/FillFace.tsx`, `view/RegionInk.tsx`, `view/ChromeClip.tsx`         | `figure/Ink.tsx` (and `RegionInk` ← `FillFace`)                                                |
| `view/ChromeBand.tsx`                                                    | `figure/View.tsx`                                                                              |

Consequences worth recording:

1. **An SVG component layer survives inside `euclid2/`.** After the strip, `figure/` still imports its fill face, region ink and chrome band from `euclid2/view/`. That is a colocation smell with a natural fix (`figure/` owning its SVG presentation, or a neutral `hud/` module), deliberately left out of this step.
2. **`geom/csg-draw.ts` loses most of its _euclid2_ consumers but not all.** `fillPaint`/`csgPaint` remain live for `figure/export.ts` and `figure/View.tsx`. So the SVG paint layer is no longer hot for the canvas — it is an export/figure path. That changes the cost/benefit of its repeat special-cases (§2.6): after this strip, `stampedPaint`'s hub guessing exists for a canvas that no longer runs it.
3. **The "two interchangeable implementations share one props contract" claim was never enforced.** `Euclid2ViewProps` (`view/View.tsx:54`) and `TypegpuViewProps` (`TypegpuView.tsx:38`) are two independent hand-written types, and `<Dynamic>` is loosely typed, so nothing made them agree. After the strip `TypegpuViewProps` is the only contract — a real simplification, and the reason the props on the pane's view element can now be type-checked.

### 4.2 Steps

1. `Pane.tsx`: drop the `Dynamic` import, the `Euclid2View` import, the `gpu` stored signal, `setRenderer`, and the chip markup; render `<TypegpuView … />` directly **[mechanical]**.
2. Delete the nine files in the table above; remove the dead `Euclid2View` export from `euclid2/index.ts`.
3. Remove the now-unused `.renderSwitch` / `.opt` / `.active` rules from `Pane.module.css` (`figure/Pane.tsx` shares that stylesheet and uses only `.stage`).
4. Let `tsc` name anything missed — it is the authority on the remaining references, including the `RegionInk`/`ChromeClip` cases that a naive "no external importers" grep gets wrong.

**Verification:** `npx vitest run` (unit), `npx tsc -p tsconfig.build.json --noEmit`, `-p tsconfig.test.json --noEmit`, `(cd apps/demo && npx tsc --noEmit)`, `npx oxlint src`. No pixel change is expected: the GPU path is already the default, and the only behavioural change is that a scene cannot be switched back to SVG.

**Pre-existing, unrelated:** `src/eval/demo-scenes.test.ts` ("mounting plate traces constructors from the layout helper") fails from live dev-server scene edits; it is not part of this work. `apps/demo/src/**` churn from the running dev server stays out of commits.

---

## 5. Ordering

| #   | step                                                         | depends on | risk                               |
| --- | ------------------------------------------------------------ | ---------- | ---------------------------------- |
| 0   | SVG strip (§4) — **done, `dfc1b86`**                         | —          | low; compiler-verified             |
| 1   | `RENDER_SAMPLES` + shared `clipFrom` (§3.1)                  | —          | low, mechanical                    |
| 2   | `geom/kinds/` + derived union (§2.8 steps 1–3)               | —          | low, mechanical; byte-pinned tests |
| 3   | `gpu/field/kinds/` (§2.8 step 2)                             | 2          | low, mechanical                    |
| 4   | Pipeline on the `FillDraw`; order-write gating (§3.2)        | —          | low                                |
| 5   | Band table; overlay extraction (§3.7)                        | 1          | medium, structural                 |
| 6   | Transcription collapse + numeric WGSL parity (§2.3)          | 3          | medium; changes what is checked    |
| 7   | `shapeOf`, auto-hub + preconditions, leaf structs (§2.4–2.6) | 3          | medium; changes behaviour          |
| 8   | Disjoint-run merging (§3.4)                                  | 4          | needs a design note first          |

Steps 0–2 are independent and can land in any order; everything else is happier after them.

## 6. Doc drift to fix in the same passes

The four items this section carried are fixed in the P12 close-out, and the record is accurate about them now: the field's leaf kinds read `spans | circle | halfPlane | offset | repeat` (a `region` operand contributes its `spans`, and the list had also never matched the `spans` tag); `12.md` has a `polarRepeat` model paragraph plus rows in its checklist and pass/fail table; `12-gpu-points-plan.md` is marked historical in the file itself; and `README.md` indexes prototypes 1–13 with a status marker on every one.

Open, to fix in the pass that touches it:

- `intent.md`'s "Shape" block lists `packages/geom`, `euclid2`, `euclid3`, `sdf`, `apps/paper` and `packages/shell`. The shipped layout is `packages/oblik` (+ `create-oblik`) and `apps/demo`. The block reads as aspiration, but nothing marks it as such.
- `prototypes/13.md` must gain its postmortem at close — the charter was written from P12's, per `intent.md`.

## 7. Not in this plan

- Compute-pass tile binning for the span walk (12.md open question 1). The walk is still the thing to measure; the record split already halved its bytes.
- Depth or stencil, offscreen caching, OIT, drawIndirect: 12.md's translucency argument still holds and nothing here changes it.
- Renaming `euclid2/view/` now that it is mostly contract rather than view (§4.1 consequence 1) — a follow-up.
- The 3D move, and anything that changes eval or pick semantics.
