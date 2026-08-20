# Code-as-graph CAD, with scenes as tests

Sketch-n-Sketch is the right *feeling* (look at the output, nudge it, the program updates) and the wrong *research program* (infer new functions, invert arithmetic traces, synthesize structure from drawing). We keep only the boring half: **numeric literals are handles**. No freeze annotations, no “the canvas introduced a variable for you,” no output-directed refactoring.

The actual product is closer to **Desmos + Blender viewports + Fusion’s parametric idea**, minus Fusion’s timeline, aimed at a job Fusion is bad at: **an SDF solid that you can look at in several ways and send to a resin printer**.

Design is not a linear list of features. It is a **graph of functions**. TypeScript already serializes that graph. Scenes are *projections* of some subgraph — the same way unit tests are projections of a library. That is the Fusion replacement, not a node editor.

---

## 1. What we are building

A TypeScript library ecosystem plus a live preview:

- You write **reusable functions** like a normal programmer (`ringProfile`, `wrapPolar`, `extrude`, `shell`, `drain`).
- You write **scenes** the way you write tests: small files that call those functions and say *how to look at the result*.
- The preview is a viewport (2D paper, 3D gizmos, SDF raymarch, map, slice strip) with **mouse → source literals**.
- The manufacturing object is an **SDF volume**. Viewport raymarches it. The slicer evaluates it. A mesh is an export, not the source of truth.

TypeGPU is the numeric/GPU layer: the same `sdRing` kernel can run on the CPU (tests, slicer, hit-testing) and on the GPU (viewport).

---

## 2. Code is the graph; Fusion’s timeline is a bad serialization

Fusion / SolidWorks / Onshape store a **history**: Sketch1 → Extrude1 → Fillet1 → Pattern1. Order is load-bearing. Rollback is how you edit the past. Reuse is copy-feature or a derived part. The model is a DAG wearing a linked list.

Grasshopper, Blender Geometry Nodes, and [Antimony](https://www.mattkeeter.com/projects/antimony/3/) make the DAG visible as noodles. Antimony is the closest ancestor: f-rep solids, a graph of Python-defined nodes, viewport gizmos that write back into node parameters, STL/heightmap out. Its limitation is the node file format — reuse is a `.node` on disk, not `import { ring } from "./jewelry"`.

A TypeScript module **is** that graph:

```ts
const profile = ringProfile({ inner: 18, outer: 21, wave });
const band = wrapPolar(profile, { radius: 19.5 });
const solid = shell(extrude(band, 6), 1.2);
```

`fillet` is not “step 7 after extrude.” It is a function you can apply to any SDF, in any order, in a helper, in a loop, behind a flag. Changing `inner` does not “break later features”; it re-runs the call graph. Git diffs the program, not a binary feature tree.

We do **not** need to draw the noodles. Call graph visualization can come later as a debug view. The productivity win is ordinary modules + ordinary tests, except the tests are visual scenes.

---

## 3. Libraries and scenes (programmer workflow)

```
src/
  jewelry/
    profile.ts      // 2D unwrapped curve / 2D SDF
    wrap.ts         // 2D → cylindrical / toroidal 3D SDF
    band.ts         // opinionated combination
  sdf/
    ops.ts          // union, subtract, offset, extrude, revolve
  scenes/
    band-unwrapped.ts
    band-3d.ts
    band-slice.ts
```

`jewelry/band.ts` does not know about cameras, printers, or gizmos. A scene picks a **scene type**, calls into the library, and returns something that type knows how to show.

```ts
// scenes/band-unwrapped.ts
import { ringProfile } from "../jewelry/profile";

export default euclid2(() => {
  const inner = 18;
  const outer = 21;
  return ringProfile({ inner, outer, wave: 0.4 });
});
```

```ts
// scenes/band-3d.ts
import { ringProfile } from "../jewelry/profile";
import { wrapPolar, extrude, shell } from "../jewelry/wrap";

export default sdf(() => {
  const profile = ringProfile({ inner: 18, outer: 21, wave: 0.4 });
  return shell(extrude(wrapPolar(profile, 19.5), 6), 1.2);
});
```

```ts
// scenes/band-slice.ts
export default slice(() => sameSolidAsAbove(), {
  layerHeight: 0.05,
  bounds: "auto",
  units: "mm",
});
```

The duplication of `18` / `21` is real. Fix it the programmer way: `export const demoBand = { inner: 18, outer: 21, wave: 0.4 }` and import it. Do **not** invent a global parameter store. Literal handles still work on `demoBand`’s numbers, and every scene that imports them moves together — which is the point of a graph.

Scenes are allowed to be tiny and ugly. Libraries should be the quality bar. That is how you get a **library of functions** instead of a folder of Fusion files.

---

## 4. Scene types

A scene type is a viewer + a value type, not a different language. The same `sdCircle(p, r)` can appear in several of them.

| Kind | Value it displays | Why it exists |
| --- | --- | --- |
| **2D Euclidean** | points, polylines, 2D SDF isolines, gizmos | Desmos paper; unwrapped patterns; sketches |
| **3D Euclidean** | polylines, meshes, frames, gizmos | construction, wrap preview as a curve, debug |
| **SDF** | `Sd3` (or `Sd2` as a flat object in 3D) | the design as a volume; raymarch; the “is this printable?” look |
| **Map** | geographic features in a local tangent frame | geo; special because of precision |
| **Slicer** | occupancy / contours per Z | resin preview and the manufacturing path |

An SDF scene *is* often “just an object in 3D”: a camera, a raymarcher, a bounding box, overlay gizmos. It is a separate type because the **query** is `f(p) → float`, not a mesh, and because the slicer will use that same `f`.

Switching scene type on the same value is a default: if you exported an `Sd3`, you can open it as SDF viewport *or* slicer without rewriting the library. The scene file is only needed when you want a specific camera, a cutaway, a 2D unwrapping, or fixtures (build plate, mandrel, map origin).

### 4.1 Map / geo

GPU `f32` is about 1 m of precision at Earth radius. A map scene always:

- picks a local origin (ENU / stereographic / UTM)
- does authoring and SDF in meters around that origin
- stores *source* coordinates however the library prefers (lon/lat in f64 on CPU, or already-projected)

Do not raymarch WGS84 in float32. This is why map is a scene type, not a camera preset.

### 4.2 Slicer (resin)

Resin MSLA wants a **stack of binary (or greyscale) masks**, not an STL. Evaluating an SDF on z-slices is the honest path:

- for each layer `z = z0 + i * layerHeight`, sample `f(x, y, z)` on a grid matching pixel pitch (e.g. 35–50 µm)
- `f <= 0` is cured resin (or the inverse, depending on convention)
- optional: extract contours for preview, antialias by `|f| / pixelSize`

That is what nTop sells as “implicit to print without a mesh.” Mesh (marching cubes / dual contouring → STL/3MF) remains an export for Lychee/Chitubox people, and it is lossy. Direct slice is the native output.

Useful slicer overlays, all SDF queries, not mesh heuristics:

- **wall thickness** — `f` offset until topology dies, or sample along the normal
- **overhang** — angle between `∇f` and gravity
- **islands** — 2D connected components per layer
- **drain / vent** — library functions that subtract cylinders, visible in the same slice view

---

## 5. The ring, as a graph with several views

Unwrapped 2D is the comfortable Desmos-like place to design a repeating motif (`wave`, stone seats, engraving). `wrapPolar` is a change of domain, not a “feature in the timeline”:

```
(u, v) in the strip  →  (θ, z) on a cylinder  →  f₃(x,y,z)
```

`extrude` / `revolve` / `shell` are more domain maps. A 3D Euclidean scene can show the wrap as a surface grid for sanity. The SDF scene shows the volume. The slicer shows what the printer will cure.

If wrap is wrong, you fix `wrapPolar`, not “rollback to sketch 4.” Every scene that imported it updates.

---

## 6. Mouse productivity (the part that is like Desmos / Blender)

Still the CSS-color-picker model, not Sketch-n-Sketch synthesis.

- `point(3, 4)` → 2 DOF; `point(x, 3)` → vertical only; identifiers are frozen.
- Caret in `line(` + click inserts a literal (or picks `A`).
- 3D: translate/rotate gizmos on literal vec3/tuples, construction plane when placing.
- Overlay on top of raymarched SDF; picking hits gizmos/planes, not the volume (unless “place on surface” is an explicit SDF ray).

During drag, either patch tokens at 60 Hz or use a transient pose and commit on pointerup. Source remains the truth. Undo is the editor.

Ranges (`min`/`max` for a slider) are the one thing a bare `18` does not encode. A small wrapper (`mm(18, { min: 10, max: 30 })`) is fine. Do not auto-promote free identifiers to sliders; in a real language that is a `ReferenceError`.

This is Desmos’s “nudge an input, dependents follow” and Blender’s “gizmo in the viewport,” pointed at **function arguments that happen to be literals**.

---

## 7. SDF as the solid kernel

F-rep / SDF is the geometry engine (Antimony, libfive, nTop, Inigo-style modeling):

- booleans, offsets, shells, lattices, smooth blends — cheap and stable
- the same `f` for viewport, measure, and slice
- TypeGPU `'use gpu'` for raymarch and for slice-plane occupancy

Conventions to lock early:

- units in **millimeters**
- `f < 0` inside (or document the opposite and never flip)
- Lipschitz-ish primitives so raymarch and thickness mean something
- every solid carries a **bounds** (needed by slicer and camera)

B-rep (Fusion’s NURBS kernel) is out of scope. If someone needs STEP in, it becomes a mesh or a sampled field, not a second kernel.

---

## 8. TypeGPU’s job

| Layer | Runs |
| --- | --- |
| Library math (`wrapPolar`, `sdCapsule`, `opSmoothUnion`) | dual: CPU tests + GPU kernels |
| SDF viewport | GPU raymarch |
| Slicer | GPU compute per layer, or CPU for small parts |
| 2D/3D Euclidean overlay, gizmos, map CPU projection | CPU |
| Authoring (AST tweak sites) | editor / TS compiler API |

Do not mark whole scene files `'use gpu'`. Mark the field functions. Scenes stay ordinary TS so they can import data, loop, and fail with real stack traces.

tsover: `+` `*` on `vec2`/`vec3` in library code. Needs the bundler transform outside shaders.

---

## 9. Neighbors (steal jobs, not architectures)

| Tool | Steal | Leave |
| --- | --- | --- |
| **Desmos** | immediate dependents, 2D paper, 1-axis freedom | LaTeX list, no modules |
| **Blender** | viewports, gizmos, shading modes | mesh-as-truth, operator stack |
| **Fusion** | parametric dimensions, manufacturing intent | history timeline, B-rep |
| **Antimony / libfive** | f-rep graph, gizmos → parameters, personal fab | Python `.node` graph UI |
| **nTop** | implicit → slice without mesh | proprietary graph, no git-native TS |
| **Sketch-n-Sketch** | “drag output, small constants change” | synthesis, trace inversion, freeze `!` |
| **OpenSCAD** | code-first CSG | no mouse, mesh round-trip |
| **Grasshopper / geo nodes** | visible DAG | visual language instead of libraries |

---

## 10. What we are explicitly not building

- Output-directed **program synthesis** (inserting functions / loops from canvas gestures).
- General **constraint solvers** (drag the midpoint, parents move). GeoGebra/Fusion sketch constraints are a different product.
- A **node-noodle editor** as the main UI. Code is the graph.
- A **sidecar parameter file** that can drift from source.
- B-rep CAD or a Fusion plugin.
- A hosted multiplayer canvas. Executing the open file is local, like a test runner.

---

## 11. Build order

North star of the first *useful* loop: **one library function, two scenes, a volume that could be sliced.**

1. **2D Euclidean scene + literal handles.** `point` / polyline / 2D isoline. Drag rewrites tokens. This is still the Desmos lesson and the authoring kernel.
2. **`Sd2` in the same 2D scene** (isolines or cheap 2D raymarch). Library function `sdRingProfile(...)`.
3. **Second scene type: SDF 3D** on `extrude(profile)` or `sdSphere`. Same literals, different viewer. Overlay gizmos on the raymarch.
4. **A real domain map:** `wrapPolar` (unwrapped 2D scene + wrapped SDF scene). This proves “the program is the graph.”
5. **Slicer scene:** one part, layer height, mask preview, PNG/raw layer export. Direct `f(x,y,z)` sampling. No mesh required.
6. **Mesh export** (optional, lossy) for other people’s slicers.
7. **Place-mode click-to-insert**, named pick vs place.
8. **Map scene** only when a geo library exists; local origin from day one of that type.
9. **VS Code / Cursor extension** wrapping the same packages (preview was a web app until the API was boring).

Printability helpers (shell, drain, overhang shader) attach to the slicer scene once (5) works. They are library functions + overlays, not a new kernel.

---

## 12. Risks

- **Lipschitz / raymarch quality** vs **slice accuracy**. A cheap polynomial smooth-union can be a bad distance. Viewport can look fine while wall-thickness and slice AA lie. Prefer true SDF ops in the print path; keep cheap aesthetics in a preview-only combinator if needed.
- **Kernel vs scene compile.** Literal-only edits should patch uniforms / re-run CPU, not rebuild the raymarch pipeline.
- **Precision.** mm-scale jewelry on GPU is fine. City-scale map is not. Keep them in different scenes.
- **Resin software interop.** Native output = layer stack (PNG zip / `.pwma` / vendor later). STL is compatibility, not the design.
- **tsover + TypeGPU in the preview toolchain** must work for library code, not only `'use gpu'` blocks.

---

## 13. Bottom line

Treat Sketch-n-Sketch as a mood board for *nudge the output*. Treat Antimony/nTop as the geometry and manufacturing mood board. Treat Desmos/Blender as the viewport mood board. Treat Fusion’s timeline as the thing to replace with **modules**.

You write a library. You look at it through scenes (unwrapped, wrapped, sliced). The mouse only edits numbers the program left as numbers. The solid is an SDF all the way to the printer.

---

## Sources

- [Sketch-n-Sketch](https://ravichugh.github.io/sketch-n-sketch/) — output-directed programming (we take live constants, not synthesis)
- [Antimony](https://www.mattkeeter.com/projects/antimony/3/) — f-rep graph CAD, gizmos write parameters
- [nTop: implicit to print without a mesh](https://www.ntop.com/resources/product-updates/from-implicit-to-print/)
- [Pressing a Key in the Calculator](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/) — Desmos nudge vs reparse
- [TypeGPU functions](https://docs.swmansion.com/TypeGPU/apis/functions/), [tsover](https://tsover.swmansion.com/)
