# Plan: GPU point/glider discs via `@typegpu/geometry` disk primitive

Prototype 12 — `euclid2-typegpu` pane. Next smallest functional cut after hover/click-pick emission.

## Current state (verified)

- Branch `p12`; baseline commit `b203078` contains the analytic grid + Solid theme work.
- Scene churn `apps/demo/src/layout/csg-tree.ts` (earW 0.58) stays out of commits.
- `packages/oblik/package.json` **already edited** (uncommitted): added
  `"@typegpu/geometry": "github:software-mansion/TypeGPU#558a18aaa3142053bbceceae6a0c3f9385d4eba9&path:/packages/typegpu-geometry"`
  and `pnpm install --no-frozen-lockfile` succeeded (lockfile updated; package resolves to raw `src/*.ts` with `'use gpu'`).
- Demo server runs on 127.0.0.1:43127 serving the working tree; oblik source hot-reloads.
- User chose: points, using the typegpu-geometry **disk primitive** (`circle` + `circleVertexCount`), not the annulus `r0=0` trick.

## Disk primitive contract

Vendored identical copy: `packages/oblik/src/euclid2-typegpu/vendor/typegpu-geometry/circle.ts`.
Upstream usage example: `TypeGPU/apps/typegpu-docs/src/examples/geometry/circles/index.ts`.

- `circle(vertexIndex)` → `d.v2f` unit vector from center; triangle-list subdivided disk.
- Instance draw: `pos = inst.center + circle(vertexIndex) * inst.radius`; `.draw(circleVertexCount(4), instanceCount)` (subdiv 4, as upstream); primitive `triangle-list`, flat color/alpha; 4× MSAA.
- World→clip via the same `k*(p - f.cam)` mapping used by `pipelines/circles.ts` `toClip`.

## SVG ground truth to replicate (do NOT invent)

From `euclid2/view/Hud.tsx PointMark` + `View.module.css` + `chrome.ts` / `pointMark.ts`:

- Radius CSS px: `pointMarkRadius(editable)` = 3.5 (derived) / 5 (editable). Paper outline stroke `POINT_STROKE_PX = 2`.
- Paint fill color: ink (idle) → accent (editable, not hot) → `selectedPaint` (hot/selected).
- Halo chrome `DEFAULT_CHROME_METRICS`: `pointOutlinePx 14`, `pointKnockoutPx 9`; hover outline opacity 0.5, selected 1.0; knockout = paper color. CSS vars: `--oblik-ring`, `--oblik-knockout == --oblik-paper`.
- Muted = opacity 0.32. Points always visible; gliders drawn at `gliderAt(value)`.
- `isDrawnNode` must now admit point/glider nodes — they become pickable (CPU `hitsNear` already ranks points rank 0).

## Implementation steps (one file each, in order)

1. **`packages/oblik/src/euclid2-typegpu/gpu/schemas.ts`**
   Add `PointInst` struct `{ center: vec2f; radius: f32; color: vec3f; alpha: f32 }` (+ `Infer` type) and `MAX_POINTS` (e.g. 4096). No flags yet — muted is alpha.

2. **`packages/oblik/src/euclid2-typegpu/gpu/layout.ts`**
   Add `points: { storage: arrayOf(PointInst, MAX_POINTS) }` and `pointOrder: { storage: arrayOf(u32, MAX_POINTS) }` to `worldLayout`.

3. **`packages/oblik/src/euclid2-typegpu/gpu/pipelines/disks.ts`** (new)
   `createDiskPipelines(root, bindGroup, format)`: vertex reads `worldLayout.$.points[worldLayout.$.pointOrder[instanceIndex]]`, offsets by `circle(vertexIndex) * inst.radius`, culls `radius <= 0` / `alpha <= 0` to a degenerate vertex; export `DISK_VERTEX_COUNT = circleVertexCount(4)`.

   Import source: try `import { circle, circleVertexCount } from "@typegpu/geometry"` first (user wants the installed dep).
   **Risk:** unplugin-typegpu may not transform node_modules `'use gpu'` sources; if typecheck/Vite fails, fall back to `../../vendor/typegpu-geometry` (byte-identical, already transformed via strokes.ts) and note it — do not delete the dep line.

4. **`packages/oblik/src/euclid2-typegpu/gpu/adapter.ts`**
   - Extend `AdapterInput.colors` with `ring` and `paper` (read in TypegpuView).
   - New point feed = finite trace nodes with `n.kind === "point" || isGlider(n.value)` (mirror SVG `points()` memo; exclude sliders).
   - Position: kind `"point"` → value x/y; glider → `gliderAt(value)`. Radius `pointMarkRadius(editable) / scale`.
   - Emit layered concentric disks per node so it reads like the SVG mark: paint disc at mark radius, paper-outline disc slightly larger (`+ POINT_STROKE_PX/2 / scale`) beneath it; halo/knockout rings as first-drawn larger disks (ring color / paper color) under the mark.
   - Reuse `splitChrome` band rest → hover → lifted (already imported); muted alpha 0.32; editable → accent when idle.
   - Add `points` to `TickPatch` as `SlotPatch<PointInstValue>`; per-key diff via a `lastPoint` map like strokes; pool `createSlotPool(MAX_POINTS)` + `sync`.

5. **`packages/oblik/src/euclid2-typegpu/gpu/painter.ts`**
   Create `points` / `pointOrder` buffers, add to the existing bind group, create disk pipelines; in `applyPatch` write points writes/order/count; in `draw` record disks **after circles** (points band topmost, per render model fills → ink → points); destroy buffers/pipelines.

6. **`packages/oblik/src/euclid2-typegpu/TypegpuView.tsx`**
   Pass `ring: readCssColor(el, "--oblik-ring")` and `paper: readCssColor(el, "--oblik-paper")` into adapter colors; relax `isDrawnNode` to include kind `"point"` and gliders (keep slider excluded); update its doc comment. Nothing else changes.

7. **Verify**
   `pnpm --filter oblik typecheck` (exit 0), oxlint clean, then open `Nested circles (typegpu)` in the GUI — the `o_tgpu_nest_twin` point should draw as a disc and be selectable; theme toggle still fine. Then commit (exclude the csg-tree churn).

## Constraints (AGENTS.md + session)

- Stay on `p12`; never open PRs.
- Format with oxfmt, lint with oxlint. Do not use `rg` in bash — use the grep/glob tools.
- Don't treat dev-server rewrites of `apps/demo/src/{scenes,layout}/*.ts` as your work; leave them out of commits.
- Eval layer must not know the renderer — all point data flows CPU-side through the adapter, as today.
- Read the `typegpu` skill's `references/{types,shaders,pipelines}.md` if the disk pipeline hits type/transform errors.
