# Hover and selection chrome

Hover and selection are **halos under the geometry**. The ring is not a recolor of the stroke sitting on top of a gap; paint covers the center of the halo.

Each hot item is two passes:

1. **Overlay** — accent outline, and when selected a paper knockout on top of that outline.
2. **Paint** — the geometry, after the overlay so it covers the hole.

## Draw order

Bands stay **fills, then edges, then points**. An item lifts only within its band:

1. Idle siblings (paint only)
2. Hover overlay + hover paint
3. Selected overlay + selected paint

While dragging, skip the overlay passes. Paint (including lifted paint) stays.

`splitChrome()` peels idle / hover / selected. `chromePasses()` expands a band into those draw passes. `chromeLayers()` is the overlay vs paint recipe. All three live under `packages/oblik/src/euclid2/view/`.

## Hover

- Overlay is **outline only**: the same 7px accent band as a selected ring, at 50% opacity, **no knockout / no paper gap**.
- Construction paint goes **cream/white** (`--oblik-selected-paint`) if it is not already. Editable blue points included.
- Figure paint **keeps the style color**.
- Figure **eraser** hover is the same stack with a **red** outline (`--oblik-error`), still under the ink, still not faded.

## Selection

- Overlay is an **opaque** accent outline, then a **thinner knockout** (paper) on top of it. Paint sits on top of both. The knockout is the gap between the stroke and the ring.
- Knockout stays **wider than the paint** (figure ink is often 2.8px or 5.6px). Outline stays **wider than the knockout**.
- Construction selected paint is cream/white. Figure selected paint keeps the style color.

Reference for a 1.5px construction stroke: **7px outline / 4px knockout**. Thicker strokes grow both, keeping 2.5px of paper extra and 3px of ring extra:

```
paper extra = knockout − 1.5
ring extra  = outline − knockout
knockout'   = max(knockout, paint + paper extra)
outline'    = max(outline, knockout' + ring extra)
```

Points use a fixed wider halo instead of this growth: **14px outline / 9px selected knockout**. Construction points: derived `r=3.5` ink, editable `r=5` accent, hover/select cream. The grab handle is an invisible `r=7` hit target (`HANDLE_R`).

A **named** point or glider also carries its bind label beside the mark: `--oblik-muted`, 12px, baseline at **`(x + 10, y − 8)` CSS px** from the mark's screen position, faded to 0.32 opacity unless it is hot or selected. That offset is the contract both views hold to — the SVG view draws it as `<text>`, the WebGPU view as positioned HTML.

## Fills

Regions and CSG fills carry the same weights as edges, but placed differently, and the
two views differ on purpose:

- **SVG** strokes the region path (outer plus holes, even-odd) and clips it to the
  **outside** of the fill — an inverted luminance mask — so the halo sits outside the
  silhouette, _under_ the paint.
- **WebGPU** measures the band **inward from the fill's own edge** and draws it **over**
  the paint: `outlinePx` in the ring color from the edge inward, then `knockoutPx` of
  paper inside that, as one **opaque, paper-backed** band. The outline is therefore
  flush against the silhouette and keeps full strength — hover is a clean 50% accent,
  selection a solid one — instead of being washed by the fill's own cream paint, and
  the paper band is a real hole in the fill. It never spills onto the grid or
  neighbouring geometry; the cost is saturating on shapes thinner than the band.
- The WebGPU band is a distance-field band: the fill pass already has the signed
  distance to the nearest boundary for its antialiasing ramp, so `0 .. outlinePx/2` and
  then `knockoutPx/2` are two clamps of that same value — no restroke geometry, no mask,
  no clip. Round joins, hole boundaries and rounded offsets come free.
- **Every fill also carries its own outline**, the SVG `inkClass` stroke at
  `--oblik-stroke` (1.5px): the SVG view draws it along a fill's boundary with
  `stroke: ink`, accent while editable, `--oblik-selected-paint` while hot. WebGPU draws
  the same line **centred on the boundary**, like that stroke — on the straight runs it
  lands exactly on the edge that defined the region (and under the ink drawn there), so
  it reinforces that edge instead of doubling it with a second line just inside; where
  the boundary pulls away from the ink — an offset's rounded corners, a hole — it shows
  on its own. Its alpha is 0 for a cold fill that should have no outline at all.
  The halo bands below are the opposite: measured **inside** from the edge.
- **Every width in a fill record is CSS px, not world units.** Chrome is a
  screen-space weight (SVG's non-scaling stroke), so the records carry px and the
  shaders convert once, through `worldPerPx(frame.scale)`. Zooming then writes only the
  frame uniform — it reprojects the world and the chrome with it and re-uploads no
  record at all — where baking `px / scale` into the records made one zoom step rewrite
  226 of a 288-record scene. The quad's AA skirt went the same way: `QUAD_PAD_PX` grows
  the box in the vertex shader, so the stored AABB stays pure world geometry.
- **A repeat's seams are not chrome, and both renderers have to be told so.** `polarRepeat`
  folds the query point into one cell, so the field it evaluates is that _cell's_ distance:
  where two copies tile (a gear tooth plus its wedge of root disc) the shared edge is
  interior to the union yet still the cell's boundary, and a fill would draw it — the
  outline band round each seam, the coverage ramping down and up: radial spokes. The fill
  unions in the **hub** disc the cells stand on (`min(hub, fold(cell))`), which covers those
  seams, and the hub itself is inside the copies so it contributes no outline of its own. The
  paint side cannot lean on that: SVG strokes every subpath, so the copies' _shared_ edges
  are dropped in the geometry (`mergeRepeatOutline`) and the surviving edges chain into the
  ring's own loop — one outline, which is what a stroke has to follow.
- **Chrome over a fill is one antialiased layer per pixel, never two blends.** Both the
  paint+outline pair and the band pair are areas of one pixel, so the output is the
  pixel's coverage times the _area-weighted_ mix of the layers: colors mix with the
  coverages, alpha with the coverages, and the color is divided by the total coverage.
  Picking a layer's color from its own coverage instead (the obvious `mix(under, over,
cov)`) cancels the ramp and steps hard at the seam between the knockout and the ring —
  exactly the bug `halo.test.ts`'s profile sweep exists to catch.
- Contract: `gpu/pipelines/halo.ts` (the band and outline math), `halo.test.ts` (pixel
  semantics, including a dense profile sweep with no step over ~0.04 per 0.05px),
  `gpu/frame.ts` (`worldPerPx`, the one px→world conversion, and `QUAD_PAD_PX`),
  `pipelines/wgsl.test.ts` (shader structure and the px unit).

## Other

- Overlay clip to the **outside of fills** in the SVG view (not circles or points).
- Figure Shift-onion draws construction **on top** of faded ink.

## Tokens

On `:root` in `packages/oblik/src/theme.css`. `--oblik-knockout` is the **paper color**, not a width.

| Token                             | Default | Role                          |
| --------------------------------- | ------- | ----------------------------- |
| `--oblik-chrome-outline`          | 7px     | Hover and selected ring       |
| `--oblik-chrome-knockout`         | 4px     | Selected paper gap            |
| `--oblik-chrome-point-outline`    | 14px    | Point ring                    |
| `--oblik-chrome-point-knockout`   | 9px     | Point selected gap            |
| `--oblik-chrome-outline-hover`    | 0.5     | Hover ring opacity            |
| `--oblik-chrome-outline-selected` | 1       | Selected ring opacity         |
| `--oblik-selected-paint`          | cream   | Construction hover/select ink |
| `--oblik-ring`                    | accent  | Hover and selected ring color |
| `--oblik-knockout`                | paper   | Gap fill color                |

The ring color is `--oblik-ring`: it falls back to the accent in the dark
theme, and the light theme declares a lighter blue so the halo does not read
too dark against the near-white paper canvas. The accent token itself is left
alone (it also fills primary buttons and UI text).
