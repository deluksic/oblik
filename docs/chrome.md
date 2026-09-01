# Hover and selection chrome

Hover and selection are **halos under the geometry**. The ring is not a recolor of the stroke sitting on top of a gap; paint covers the center of the halo.

Each hot item is two passes:

1. **Overlay** — accent outline, and when selected a paper knockout on top of that outline.
2. **Paint** — the geometry, after the overlay so it covers the hole.

## Draw order

Bands stay **profiles, then edges, then points**. An item lifts only within its band:

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

## Other

- Overlay clip to the **outside of profiles only** (not circles or points).
- Figure Shift-onion draws construction **on top** of faded ink.

## Tokens

On `:root` in `packages/oblik/src/theme.css`. `--oblik-knockout` is the **paper color**, not a width.

| Token | Default | Role |
| --- | --- | --- |
| `--oblik-chrome-outline` | 7px | Hover and selected ring |
| `--oblik-chrome-knockout` | 4px | Selected paper gap |
| `--oblik-chrome-point-outline` | 14px | Point ring |
| `--oblik-chrome-point-knockout` | 9px | Point selected gap |
| `--oblik-chrome-outline-hover` | 0.5 | Hover ring opacity |
| `--oblik-chrome-outline-selected` | 1 | Selected ring opacity |
| `--oblik-selected-paint` | cream | Construction hover/select ink |
| `--oblik-knockout` | paper | Gap fill color |
