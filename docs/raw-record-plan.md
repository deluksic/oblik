# Raw record pipeline: one record per node, schema-owned layout

**Branch to start from:** `main`
**Goal:** cut the per-frame CPU cost of the GPU adapter, and delete every place the CPU
hand-computes a schema's byte layout.

This is a handover document. It records what was measured, what went wrong in an earlier
attempt, and the order of work that avoids repeating it. Read the "Guardrails" section
before writing code — it is not optional advice, it is the part that failed last time.

---

## 1. Why

Measured on `main` with a V8 CPU profile of the real `round-offset` scene
(183 nodes: 78 segments, 78 points, 11 regions, 11 `csg2`, 2 circles), driven through the
real eval pipeline (`evaluate(scene)` → `adapter.tick()`), median of 9 runs:

|                                    | ms/frame |
| ---------------------------------- | -------- |
| whole tick                         | **3.37** |
| `emitStrokeLayers` (incl. callees) | **1.65** |
| `emitPointLayers`                  | **0.56** |
| `emitFillBand`                     | 0.22     |

`emitStrokeLayers` was **49% of the tick** and ~21 µs per segment. The cost was not the
adapter's own arithmetic — `encodeStrokes`, `twoPointStroke`, `strokeValue`, `diff` and
`alloc` together were ~0.2 ms. It was TypeGPU's record constructors:

| leaf                                          | ms/frame |
| --------------------------------------------- | -------- |
| `cpuConstruct` (`typegpu/data/vector.js:218`) | 1.72     |
| `structSchema` (`typegpu/data/struct.js:37`)  | 0.79     |
| `get x` / `get y` (`vectorImpl.js`)           | 0.19     |

Isolated per-op costs on `main`'s shapes: one `StrokeCtrl` 690 ns, one `StrokeRun` 975 ns,
one full `StrokeDraw` **6 900 ns**, `strokeInkDiscs` (3 discs) **22 600 ns**.
A `vec2f`/`vec3f` field costs ~390–750 ns inside the wrapper; a scalar ~40 ns.

Per-record sizes on `main`: `StrokeDraw` = 96 B, `StrokeCtrl` = 12 B, `StrokeRun` = 28 B.

The multiplicity is the other half. `emitStrokeLayers` and `emitPointLayers` build **one
record per band** (`INK_DISC_COUNT = 3` for ink, `POINT_DISC_COUNT = 4` for marks), then
byte-diff them to suppress the upload. So a stroke builds and encodes 3 records / frame
(234 for round-offset's 78 segments) and a mark builds 4 (312 for 78 points), to express
what is really _one_ geometry plus a per-band width and colour. The diff only ever saved
the upload, never the construction.

Target: **one record per node**, bands derived on the GPU, records pooled and mutated in
place, only changed records uploaded. A prototype of this shape measured:
steady state **0.37 ms/frame**, `emitStrokeLayers` 0.003 ms, `emitPointLayers` 0.008 ms —
**9.1× on the tick**. Treat that as the target, not a promise; see §5 for the accounting.

---

## 2. Baseline: what `main` does today

- `schemas.ts` defines `StrokeCtrl { position: vec2f, radiusPx: f32 }`,
  `StrokeRun { color: vec3f, alpha: f32, start: u32, count: u32, flags: u32 }`, and
  `StrokeDraw { a, b, c, d: StrokeCtrl, run: StrokeRun }`.
- `adapter.ts` already writes through TypeGPU's writer (`writePartial` with
  `{ idx, value }`), so **there is no hand-managed typed array on `main`.** Do not
  "fix" a problem that is not there. The layout hazard to avoid is the one described in
  §4.
- `painter.ts` holds one bind group per `(pipeline layout × draw-order band)`; the five
  ink bands mirror the SVG chrome pass order (rest, hover halo, hover paint, lifted halo,
  lifted paint), as do the point bands.
- `strokeInkDiscs` / `circleInkDiscs` build the three layered draws; `pointDiscsOf` builds
  the four layered discs.

---

## 3. The work, in order

Each step is independently landable and independently testable. Do not batch them.

### Step 1 — Pooled records with input signatures (host side only)

Keep `main`'s record shapes. Change only how records get built and uploaded.

- Build one record object **per slot**, once, and mutate it in place thereafter.
- Keep a per-slot **signature**: the handful of numbers that determine the record
  (endpoints, half width, state / or centre, radius, state). Compare the signature
  **before** building or encoding anything; if unchanged, do nothing at all.
- Stage only changed slots, and upload them in **one** `write()` call.

Measured justification, on this codebase:

| approach                                   | per frame (78 records) |
| ------------------------------------------ | ---------------------- |
| fresh object per record per frame          | ~10 µs                 |
| pooled record, mutated in place            | **~0.15 µs**           |
| one contiguous `write()` of staged records | ~6 µs                  |
| one `write()` **per** record               | ~**4.7 ms**            |

The last row is why staging must be batched. The third row is for 4096 records; it scales
with the staged count.

### Step 2 — One record per node, bands derived on the GPU

- **Strokes.** Replace `StrokeDraw` with a single record:
  `{ a: vec2f, b: vec2f, halfPx: f32, state: u32, color: vec3f }`.
  The visible run is a two-point segment (`strokeEndpoints` already returns exactly two
  points), so the mirrored-neighbour polyline encoding is pure overhead — the four ctrl
  points are `2b−c, b, c, 2c−b`, and round caps reproduce them exactly. Every layer uses
  `lineVariableWidth`; `polylineVariableWidth` stops being used.
  `state` carries `hot`, `selected`, `editable`, `muted`; `color` is black for scene ink
  (which derives it) and filled for overlay records that set an `explicit` bit.
- **Point marks.** Replace the four discs with one record:
  `{ center: vec2f, markRadiusPx: f32, state: u32, color: vec3f, alpha: f32 }`.
  Each band's radius is the mark's paint radius plus a fixed CSS-px offset that belongs in
  the **frame uniform**, not the record.
- **Frame uniform** carries the band widths and the palette, so a band's radius/colour is
  a function of `(record, band, frame)`. Add: `haloHalfPx`, `knockHalfPx`, `paintHalfPx`,
  and the point offsets `pointRingAddPx`, `pointKnockAddPx`, `pointOutlineAddPx`, plus the
  palette (`ink`, `accent`, `selectedPaint`, `ring`, `paper`, `ghost`).
- **Order lists** address `(slot, layer)`. Keep them `Uint32Array` of packed `u32`s if you
  like — an order list genuinely is a list of `u32`. A `u32` list is fine; what is not
  fine is reinterpreting a record's lanes (§4).
- **One draw-order band per layer**, so a band with no instances issues no draw. A
  2-instance draw for the halo+knockout pair is safe when the pair's layers are adjacent
  and the shader wraps by `LAYER_COUNT`.

Record sizes should come from the schema, never a literal:
`const STRIDE = sizeOf(StrokeNode)`. Nothing in the adapter should compute a field offset.

### Step 3 — One layer enum

`LAYER_HALO`, `LAYER_KNOCKOUT`, `LAYER_OUTLINE`, `LAYER_PAINT`, `LAYER_COUNT` live in
`schemas.ts` and are the **only** layer numbering. A kind that keeps per-layer records
(circles do) maps the shared enum to its own slots through one named function, with the
reason in a comment. Two parallel numberings is how the stroke rest band ended up asking
for layer 0 and drawing nothing.

---

## 4. Guardrails (the part that failed)

An earlier attempt at this work broke rendering repeatedly. Every failure was one of these
four, and each is preventable by a rule plus a test.

**G1 — Never manage a record's layout by hand.**
No packing several fields into one element; no reusing a lane for a second meaning; no
byte offsets computed by hand; no hand-rolled bit codec for a record. Put the fields in
the schema and let TypeGPU's writer place them. Use `sizeOf(schema)` for strides.
_Failures this caused:_ `f32` field carrying a bit-cast `u32`; `state` riding
`radiusPx`; a `(slot << 16) | layer` codec; hand-computed field offsets that silently
stopped matching the schema when fields were reordered.

Typed arrays are fine when the element type **is** a schema primitive — a `u32[]` list is
a `Uint32Array`. They are wrong when they express a record's shape.

**G2 — Never hand-write the offset argument.**
`write(data, { startOffset })` takes a **byte** offset
(`calculateOffsets` → `writeToArrayBuffer(..., {startOffset})` → `Uint8Array.set(src, startOffset)`).
Passing an element index compiles and then fails at `writeBuffer` with
`BufferOffset (N) is not a multiple of 4`, leaving the buffer untouched and the geometry
invisible. Derive it: `slots[0] * sizeOf(schema)`. `batch.test.ts` must assert both the
value and `% 4 === 0`, with a stub that throws on unaligned offsets.

**G3 — Never let a missing value render as "nothing".**
Sentinels that mean _invisible_ fail as a blank canvas, which is indistinguishable from
ten other bugs. Failures this caused: frame band offsets defaulting to `0` so every band
collapsed onto the mark's radius; a negative radius as a cull flag. Prefer:

- required inputs, so omission is a compile error, or
- a zero **width/radius** for a dead band (draws nothing, no flag), or
- a loud debug colour for a missing palette entry.
  No cull path is needed at this scene size; a zero-width run already draws nothing.

**G4 — Validate the generated WGSL, do not merely resolve it.**
`tgpu.resolve()` returning text proves nothing. A type error in the generated shader
(`f32 * i32` from `select(0, 1, …)`) only surfaces at pipeline creation, which is why it
cost a round-trip. At minimum, assert the generated source contains no mixed-type
arithmetic for the expressions you generate, or run a WGSL validator over it. Prefer the
validator.

Beyond G1–G4, four **contract tests** turn the invisible into a failing assertion. Write
them before Step 2, so Step 2 lands behind them:

1. **Byte-offset contract.** Stub device; stub `queue.writeBuffer` that rejects
   unaligned offsets and records `{offset,size}`; assert the batch offset equals
   `firstSlot * sizeOf(schema)`, is `% 4 === 0`, that slots are ascending, and that the
   bytes land where expected.
2. **Band contract.** For a rest / hovered / selected node, assert which layers each band
   queues and which slot each entry names. A rest entry must ask for **paint**, not halo.
   This is exactly the bug that made every rest stroke ask for layer 0.
3. **Signature contract.** A second identical tick stages **zero** records; a moved node
   stages exactly one, at its own slot.
4. **SVG-vs-GPU colour contract.** For every (node kind, band, state), assert the GPU's
   derived colour equals what the SVG view uses. The SVG view is the specification for
   the chrome model — get the mapping from it (`chromeLayers` / `overlayBands` in
   `euclid2/view/chrome.ts`, and the ink class logic in `figure/Ink.tsx`), not from test
   fixtures. Reading it from fixtures is how strokes were given the circle's colour
   mapping.

Finally: **the earlier attempt's real error was having no way to observe the render.**
Before changing a shader, add a way to see its output — a device stub that drives the real
draw path, or a single frame with a constant debug colour. A temporary constant colour
("is the fragment running at all?") distinguished eight possible causes in one step, after
several rounds of reading code had not.

---

## 5. Verification and measurement

Device-free checks the repo already supports:

- `pnpm --filter oblik test` — unit and shader projects (`vitest`).
- `pnpm --filter oblik typecheck` — `tsc -p tsconfig.build.json` and `tsconfig.test.json`.
- `pnpm lint` — `oxlint`.
- Shader tests resolve TGSL to WGSL without a device (`**/wgsl.test.ts`). Extend these
  with G4's validation.
- Browser verification is the user's. `AGENTS.md` forbids browser automation.

Benchmark harness for before/after — the shape used for the numbers in §1:

- Load the real scene: `evaluate(await import("@scenes/round-offset"), { module: "round-offset.ts" })`.
  A `@scenes` alias in `vitest.config.ts` pointing at `apps/demo/src/scenes` makes this
  easy; remove the alias before landing.
- Warm ~60 ticks, then measure the median of 9 runs of 150 ticks. Report ms/frame.
- Profile with `node:inspector/promises` (`Profiler.enable` → `setSamplingInterval` 100 µs
  → `start`/`stop`) and attribute **total** time per function; `self` from `hitCount`
  subtraction is noisy at that interval.
- Measure a drag too: worst case is every node's geometry changing every frame, which
  stages every record.

**Acceptance targets** on `round-offset`: stroke and point emission each `< 0.05 ms`;
whole tick comfortably under `1.0 ms`; steady-state frames staging **zero** records.
Report the final numbers in the PR description. If a target is missed, say so plainly
rather than adjusting the target.

**Expected costs to be honest about:** the pooled-record path was measured at
**0.407 ms/frame** steady and **0.420 ms** under an all-nodes-moving drag, versus
**0.370 ms** for a version that hand-packed bytes (which is now forbidden). Type safety
cost ~9% of the tick and is worth it.

---

## 6. Non-goals

- **Not** a new renderer. The SVG view's chrome model is the specification; the GPU path
  renders the same model.
- **Not** touching fills' span/field split, or `emitField`. Re-measure after Steps 1–3:
  `emitFillBand` was 0.22 ms and may become the next hotspot, which is a separate change.
- **Not** removing `Float64Array` from the byte-diff encoders (`encodeFillRegions`,
  `encodeFieldQuad`, …) in this pass. Those are comparison keys, not layouts; they never
  reach `write()`. Revisit only if a profile says so.
- **Not** a general abstraction over record kinds. Three concrete paths (strokes, point
  marks, circles) sharing a small pool/batch helper is the right amount of sharing.

---

## 7. Branch and process

- Work on `main` (or a fresh branch off it); never open a PR (`AGENTS.md`).
- Commit and push are fine. Keep each step a separate commit so a regression can be
  bisected.
- The dev server (`pnpm demo`, port 43127) rewrites `apps/demo/src/scenes/*` and
  `src/layout/*` while running. Do not commit that churn, and do not treat it as your own
  diff. It used to break `demo-scenes.test.ts`, which evaluated the real scenes and pinned
  the exact shapes they produced — that test is gone, and the scene-shaped seams it covered
  now run against fixtures the tests own (`eval/scene-pipeline.test.ts`, and the fill
  compiler's corpus in `euclid2-typegpu/gpu/fillCorpus.fixture.ts`). No test reads
  `apps/demo` any more, so scene churn cannot regress the suite; confirm with
  `git diff apps/demo/src/scenes` before blaming a code change.
- A prior attempt at this work exists as branch `proto/raw-stroke-records`. It is
  **not** a starting point and should not be merged — it broke rendering. Mine it for the
  measured numbers and for the mistakes listed in §4, then discard it.
