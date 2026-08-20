# Prototype 3 — insert editors from the canvas

Charter. Build step 1, then the visualization step, then write conclusions.

P2 made a scene a file. You still have to **type** `editPoint` to get a coral handle. P3 is UI-created **editors** (measurements), not a sketcher.

## Visual language (already true)

| On screen | Meaning | Writes |
| --- | --- | --- |
| Cream solid | Inert geometry (`circle`, `drawPlate`, SDF fill) | nothing |
| Coral filled dot | `editPoint` / glider | literals |
| Coral dashed ring | `editDistanceToPoint` | `d` |
| HUD slider | `editNumber` | `n` |
| Gold / blue | pick highlight | nothing |

If it is dashed coral, it is an editor. Do not draw inert “reference dimensions” in that style.

## Step 1 (this build)

**Space** opens a command palette on the focused pane. Commands are registered by the **view**, not by each scene file.

Ship two commands on euclid2 and sdf2:

1. **Point** — click empty paper → insert `const p = editPoint(x, y)` into `scene()`.
2. **Distance** — click a coral **point that is already a named `const` in `scene()`**, then click a radius → insert `const d = editDistanceToPoint(p, r)`. Or click empty paper for a new origin, then a radius → insert both.

No cream geometry is added. A new point is a coral dot; a new distance is a dashed ring. `scene()` may not use them yet. That is fine.

Esc cancels. The completed command is one text edit. Undo is the editor.

### Pass

- New scene: Space → Point → click. File contains `editPoint`. Coral handle drags and writes the literal.
- Space → Distance → click empty → click again. File contains `editPoint` + `editDistanceToPoint`. Dashed ring drags.
- Distance from an existing named point in `scene()` reuses that identifier (shared origin).
- Picking a handle declared in `plateLayout()` (not `scene()`) refuses with a status line — do not emit `h0` out of scope, do not shift widget indices by inserting *before* `plateLayout()`.
- Inserting after `return drawPlate(plateLayout())` rewrites to `const __scene = drawPlate(plateLayout()); …; return __scene` so AST order still matches evaluation.
- 3D / SDF field panes: Space says this view has no insert commands yet. Do not insert 2D widgets into `mill.ts`.
- No on-screen tool buttons.

### Fail (stop)

- Command invents a cream `circle()` / `line()`.
- “Radius is that line” snapshots a length or emits an expression.
- Inserting a handle prepends `edit*` so plate’s widget indices shift.
- Space is a global toolbar that ignores the focused pane.

## Step 2 (same prototype, after step 1 works)

Palette verbs that **only consume editors**: `circle(c, r)` from an existing coral point + distance, rewriting `return` into a `group` when needed. Still no “pick a line as a value.”

## Non-goals

- On-screen CAD tool buttons
- Scene-specific `bolt` / `slot` registries
- Nested docking
- Click-to-wrap an unmarked literal (same palette later: `wrap point`)
- SDF pick identity
- Constraints (coincident, equal, tangent)

## Shape

```
shell     palette chrome + /__insert-editor (AST, same sandbox as write-widget)
euclid2   Point / Distance tools (click + ghost)
sdf2      same 2D tools
euclid3 / sdf   empty command list
```
