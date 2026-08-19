# Code-first designs with mouse-written source

The interesting product is not a Desmos clone with a better expression language. It is a **live coding environment for geometric / GPU designs** where:

- you write real TypeScript (functions, loops, modules, custom data)
- some kernels run on the GPU (TypeGPU, raymarched SDFs, dense plots)
- the mouse is a second caret: clicks **insert** values at the cursor, drags **rewrite numeric literals** already in the file

Source stays the source of truth. There is no hidden input store that can drift from the code. Desmos already works this way for LaTeX (`(3, 4)` dragged becomes `(3.2, 4.1)`). We want that, for TypeScript, in an editor people already live in.

---

## 1. The interaction, stated as rules

### 1.1 Degrees of freedom are a property of the AST, not of the object

```ts
const A = point(3, 4);     // 2 DOF — both args are numeric literals
point(x, 3);               // 1 DOF — only Y; drag is vertical
point(x, y);               // 0 DOF — display-only marker
translate(0, 1, 0);        // 3 DOF — 3D move gizmo
translate(0, y, 0);        // 1 DOF — only the Y arrow
```

A handle exists only where a **call site** (or array literal) has one or more **tweakable numeric leaves**. An identifier is bound; we do **not** chase `x` back to `const x = 5` and rewrite that. If you want the X of this point free, write a literal here. That is the whole constraint language, and it is already on screen in the code.

This is stricter than Sketch-n-Sketch, which tries to invert `x0 + sep` with heuristics and freeze annotations (`40!`). Those heuristics feel magical until they edit the wrong constant. Local literals only: dragging is never ambiguous.

Unary minus counts as a literal (`-3`). `3 + 1` does not. First drag on a compound expression can *promote* it to a single literal if we want a later escape hatch; v1 just refuses the handle.

### 1.2 Click-to-fill is type-directed insertion at the caret

You type `line(` and stop. The language service knows the next argument is a point. The preview is now in **place mode**:

1. Click empty graph paper → insert `3.2, 4.1` (or `point(3.2, 4.1)`, matching the signature) and a comma if another arg remains.
2. Second click fills the next hole.
3. Prettier / the formatter owns commas and wrapping. The inserter should emit a small, boring fragment, not pretty-print the whole file.

Clicking an **existing named handle** while filling a hole inserts the **identifier** (`A`), not a duplicate literal. Place vs pick:

| Click target | Inserts |
| --- | --- |
| empty space / construction plane | a fresh literal (or `point(…)`) |
| existing 0+ DOF marker with a name in scope | that name |
| existing anonymous literal point | that expression if we can recover it; otherwise a new literal |

Cursor not in a hole → click is camera / selection / start of a drag, not insertion.

### 1.3 Drag writes a `TextEdit`, not a uniform

Dragging `point(3, 4)` replaces the `3` and `4` tokens in the buffer. Undo is the editor’s undo. The file on disk (once saved) *is* the design. Reload never needs a sidecar of slider state.

During a drag we will fire many edits. Two practical constraints:

- Edit **only the numeric tokens**, preserve surrounding trivia (don’t reformat the line on every pointermove).
- Optionally debounce format-on-drop, not on-move.

If the runtime cannot keep up with “edit buffer → transpile → re-run sketch” at 60 Hz, keep a **transient overlay** of the dragged pose and commit text on pointerup. The committed path must still be source; the overlay is a gesture, not state.

### 1.4 GPU content and gizmos are two layers

A 3D raymarched SDF can be a `'use gpu'` function of some uniforms. Those uniforms are **the same literals** (or small structs of literals) in the TS file. The GPU never owns them.

```
┌─────────────────────────────────────┐
│  GPU: raymarched SDF / dense plot   │  ← beauty, expensive, no picking required
├─────────────────────────────────────┤
│  CPU overlay: handles, gizmos,      │  ← authoring
│  construction plane, hover rings    │
└─────────────────────────────────────┘
```

Picking hits the overlay (and maybe a ground plane), not the SDF — unless we later add “click the surface to place a point,” which is an SDF ray and a construction-plane fallback, not gizmo logic.

3D placement needs an explicit plane: ground, view-aligned, or last hit. Show it while in place mode. A transform gizmo on `translate(0, 1, 0)` is the 3D cousin of the 2D point handle: same DOF rule, different widget.

---

## 2. What this is, among existing systems

| System | Relation |
| --- | --- |
| **Desmos** | Same *idea* (drag updates the program). Wrong *surface* (LaTeX rows, no functions/loops/data). Geometry tool still isn’t a codebase. |
| **VS Code CSS color decorator** | The mundane analog: a literal in source grows a widget; the widget writes the literal. We want that for `vec2` / `vec3` / nested number lists. |
| **Sketch-n-Sketch** | Academic cousin ([output-directed programming](https://ravichugh.github.io/sketch-n-sketch/)). Live mode inverts traces and will rewrite *any* constant that could explain the drag. We explicitly do not. |
| **OpenSCAD customizer / shader uniform GUIs** | Sidecar parameters (`// {min:0}`) separate from “real” code. Useful for ranges; not the primary handle model. |
| **r3f TransformControls + Leva** | Runtime gizmos bound to JS objects. State lives in memory; code is a snapshot at best. We invert that. |
| **Processing / p5 / Shadertoy** | Code-first, weak mouse→source. |
| **GeoGebra** | Mouse-first, generates constructions, not your functions. |

The product sits in the Sketch-n-Sketch / Bret Victor slot, with TypeScript+TypeGPU as the language and **local literal DOF** as the interaction law — closer to the CSS color picker than to program synthesis.

---

## 3. Runtime vs authoring (keep them apart)

Two programs run on the same file.

**The sketch** is ordinary TypeScript the user meant: helpers, loops, data, `'use gpu'` kernels, `A + B` via tsover. It produces a frame (meshes, SDF scene, 2D draw list). It should not know it is being authored.

**The authoring pass** is a compiler plugin / TS checker extra:

1. Parse the file (and follow imports later).
2. Find *tweak sites*: call arguments and array elements whose type is `number` / `vec2` / `vec3` / `mat` and whose expr is a literal (or a tuple of literals).
3. After the sketch runs, map those sites to **world-space widgets** (where did this `point(3,4)` actually appear? where is this `translate` in the scene graph?).
4. Draw overlay gizmos. On drag/click, produce `{ uri, range, newText }`.

Step 3 is the only delicate one. `point(3, 4)` is easy: the return value *is* the widget origin. `translate(0,1,0)` inside a stack of transforms needs the runtime to expose a **transform frame** for that call (instrumentation, or a convention like `gizmo("body", { translate: [0,1,0] })`). Prefer convention over magic tracing.

Loops are a feature, not a bug:

```ts
for (let i = 0; i < 5; i++) point(i, 3);
```

Five markers, **one** Y literal. Drag any of them vertically, all five move. That is the code telling the truth. If you want independent Ys, put independent literals in a data array:

```ts
const ys = [3, 3.2, 2.8, 3, 4];
ys.forEach((y, i) => point(i, y));
```

Now each `ys[k]` is its own site. Data-as-literals is how you get “custom data” and mouse editing at once.

---

## 4. TypeGPU’s job

TypeGPU is the **numeric and GPU language**, not the editor.

- Sketch / scene-graph math on CPU: `d.vec2f`, `d.vec3f`, `+` `*` via tsover (needs the tsover *bundler* plugin outside `'use gpu'`).
- Heavy work in `'use gpu'` functions: SDF evaluate, raymarch, plot sampling. Dual CPU/GPU so a kernel can be tested on CPU and dispatched on GPU.
- `@typegpu/sdf` is a plausible stdlib for the 3D beauty layer.

Do not run the whole sketch through the GPU subset. Loops over JS arrays, imports, optional objects, and the authoring overlay all want real TS. Mark kernels, not the file.

---

## 5. Shell: VS Code extension, but not first

A VS Code / Cursor extension is the right *product shape*:

```
[text editor]  ← WorkspaceEdit / SnippetTextEdit
      ↑                 ↓
[extension host]  ← TS AST + language service (expected type at cursor)
      ↑                 ↓  postMessage
[webview preview]  ← WebGPU scene + overlay, pointer events
```

Clicks in the webview become inserts at the **actual** editor selection (keep `preserveFocus` so the caret doesn’t vanish). Drags become ranged replacements. Buffer changes re-evaluate the preview.

Caveats that make “extension first” a slow way to discover the interaction:

- Webview WebGPU works on desktop VS Code but is fiddly (retainContextWhenHidden, Electron version).
- The tsover + unplugin-typegpu pipeline has to run in the extension host or a bundled worker, not Vite’s happy path.
- This Cloud Agent preview is a browser, not VS Code.

**Prototype as a web app with Monaco** (same three actors: editor, AST pass, WebGPU view). The extension wraps the same packages. TypeGPU’s own docs already run Monaco + TGSL in a browser; copy that, don’t start from `yo code`.

---

## 6. API taste (library, not a platform)

The user-facing library should look like code they would write anyway, with a small set of names the authoring pass knows.

```ts
'use tsover';
import { point, line, circle, length } from 'graph';
import { d } from 'typegpu';

const A = point(3, 4);
const B = point(x, 2);          // x from somewhere; only Y is a handle
line(A, B);

const r = 1.5;                  // a bare number literal: slider if annotated, or if used as radius
circle((A + B) * 0.5, r);
```

Open questions, in order of how much they affect the feel:

1. **Is `point` a drawing primitive, a constructor, or both?** Drawing on construct is Desmos-like and good for 2D. In 3D you want `point` for a gizmo origin without always splatting a sphere into the SDF. Probably: constructors register authoring sites; `draw` / the scene return value is separate. A 2D default can auto-draw registered points.
2. **Bare `1.5` vs `slider(1.5, { min, max })`.** Ranges are the one thing literals don’t encode. Tiny annotation (`slider(1.5, { min: 0, max: 5 })` or a comment) is fine; don’t invent `a = 1.5` ⇒ auto slider like Desmos letters. In code, a free letter is a ReferenceError, not a widget.
3. **`line(` insertion shape.** `line(point(1,2), point(3,4))` vs `line(1,2, 3,4)` vs `line(d.vec2f(1,2), …)`. Pick one signature and generate only that. Operator-overloaded `vec2` literals should match tsover style (`d.vec2f(1, 2)`).
4. **Precision.** Drag writes `3.21` not `3.2100000002`. Quantize to view scale / a user snap.

Stdlib stays small: `point`, `line`, `circle`, `polyline`, `translate`/`rotate`/`scale` (or one `transform`), `slider`, and later `sdf` / `raymarch`. User functions are just functions. Intersections return `vec2 | null`; no GeoGebra kernel.

---

## 7. Two loops, revised

**Loop A — caret / pointer in the preview (must feel instant)**  
hit-test overlay → (place: insert at caret) or (drag: rewrite literals, possibly via a transient pose) → re-run sketch or update GPU uniforms that *mirror* those literals.

**Loop B — typing in the editor (can hitch a little)**  
buffer change → parse tweak sites → transpile (tsover, typegpu) → replace sketch module → rebuild GPU pipelines if kernels changed → refresh overlay.

If only literals changed and the AST shape is identical, Loop B can skip pipeline rebuild and patch uniforms / CPU uniforms. That is Desmos’s “nudge vs reparse” split, recovered from diffing the token stream instead of from a parallel store.

Broken source: keep last good frame, squiggle the editor, overlay frozen. Empty hole (`line(` unclosed) is not an error in place mode; it is the prompt.

---

## 8. Pitfalls

**Formatting vs token identity.** Edits must target character ranges of the literals, then re-resolve ranges after each document version. Don’t pretty-print on pointermove.

**Call-site vs value identity.** `const A = point(3,4); line(A, A)` is one handle, two uses. Overlay one gizmo at `A`’s position. `line(point(3,4), point(3,4))` is two sites that happen to coincide.

**Imports.** v1: single file. Multi-file means mapping sites across the module graph; do it when single-file is boring.

**3D unproject.** Place mode without a plane is a bug. Always show the plane / snap.

**GPU/CPU numeric mismatch.** Dual functions should match; gizmos sit in the same world space the shader uses. If they drift, the overlay is lying.

**Security.** Executing the open file is eval. Local-only, like a VS Code task, not a hosted multiplayer canvas.

**tsover in Monaco / the extension.** Type-level `A + B` needs workspace TypeScript = tsover. Runtime `A + B` needs the transform. Both must be true or people will believe the types and get `NaN`.

---

## 9. What we are no longer proposing

The previous revision recommended a **named input store** (`g.point('A', …)` + sidecar `{ A: [1.2, 0.3] }`) that wins after first drag. That is the right model for a hosted widget, and the wrong model for “I am writing a program.” It creates a second source of truth, fights undo, and fights git.

Desmos can afford source-as-state because the latex *is* a tiny AST. We can afford it because TypeScript *is* the AST.

Keep from Desmos only:

- derived geometry is not draggable
- nudge (literal edit, same tree) is cheaper than structural edit
- drawing is a view
- one scalar of freedom (glider / `point(x, 3)`) is a first-class, obvious case

---

## 10. Build order

Each step is a usable slice of the *authoring* loop, not a prettier renderer.

1. **Web preview + Monaco (or a hardcoded file) + 2D paper.** Parse `point(number, number)` call sites. Drag rewrites those two tokens. Dependent `circle` / `line` in ordinary TS update because the module re-runs. No GPU, no extension.
2. **Partial DOF.** `point(x, 3)` grows a vertical-only handle. `point(x, y)` is a ghost marker.
3. **Place mode.** Caret inside `line(`; clicks insert args; clicking a named point inserts the name. Formatter on idle.
4. **tsover `vec2`.** `(A + B) * 0.5` in user code. Authoring pass still keys off `point` / literals, not off every `+`.
5. **Literal arrays as data.** Drag a vertex of a polyline stored as `[[0,0],[1,1],…]`.
6. **One `'use gpu'` kernel** (2D SDF fill or a plot) with literals as uniforms, gizmos still CPU overlay.
7. **3D:** construction plane, translate gizmo, raymarch overlay. Same DOF rule.
8. **Wrap as a VS Code / Cursor extension** sharing the library. WorkspaceEdit instead of Monaco `executeEdits`.

Do not start with the extension, with trace-inversion, or with a constraint solver.

---

## 11. Sources

Authoring / bidirectional:

- [Sketch-n-Sketch](https://ravichugh.github.io/sketch-n-sketch/) — output-directed SVG; live mode vs structural inference
- VS Code [Webview](https://code.visualstudio.com/api/extension-guides/webview) + `WorkspaceEdit` / `SnippetTextEdit` — the extension seam
- VS Code CSS color preview — literal-as-widget

Desmos (why derived ≠ handle; nudge vs reparse):

- [Pressing a Key in the Calculator](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)
- [Jason Merrill on HN (2016)](https://news.ycombinator.com/item?id=11369540)
- [Sliders and movable points](https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph)

TypeGPU:

- [Functions / `'use gpu'`](https://docs.swmansion.com/TypeGPU/apis/functions/)
- [tsover](https://tsover.swmansion.com/)
- [TypeGPU blog](https://docs.swmansion.com/TypeGPU/blog/)

---

## 12. Bottom line

Write designs as programs. Let the mouse edit only what the program left as numbers. The shape of an expression (`point(x, 3)` vs `point(3, 4)`) *is* the rig. GPU is for the picture; a thin overlay is for the rig; the file is the source of truth.

The first thing to prove is not a raymarcher and not a VS Code skeleton. It is: drag a `point(3, 4)` in a preview and watch the TypeScript in the editor change, with a circle in the same file following along.
