# Critique: where the plan’s assumptions break

The plan is a stack of bets that each sound reasonable in isolation. Several of them **fight each other**. Existing tools already occupied most of the niches. This note is the adversarial pass: assumption → failure mode → whether a solution actually covers it.

Verdict up front: the idea is not empty, but **“literals are handles + ordinary TypeScript + true SDF all the way to a resin printer + Fusion-replacement graph” is not one product.** It is three products sharing a repo. Something has to be demoted from a principle to a convenience.

---

## The bets, named

1. A TypeScript call graph is a better CAD model than a Fusion timeline.
2. Scenes-as-tests are how you view that graph.
3. Mouse productivity = rewrite numeric literals at the call site (no synthesis).
4. One SDF is the solid, the viewport, and the printer.
5. TypeGPU dual functions make (4) cheap.
6. 2D Euclidean, wrap, 3D, slice are just projections of the same program.
7. Resin printing is the job that makes this worth building.

---

## 1. Literal handles vs composition (the plan fights itself)

**Assumption:** `point(x, 3)` vs `point(3, 4)` is a complete constraint language.

**Hole:** The whole point of a function graph is that interesting values are *not* literals. After a week of real use you have `inner + wall`, `wrap(profile).radius`, `spec.inner`, `stones[i].x`. Under the stated rule those have **zero DOF**. Handles vanish exactly when the design becomes a library — i.e. when the product starts working.

Sketch-n-Sketch and [libfive Studio’s `#1` free variables](https://github.com/libfive/libfive/blob/master/doc/guide.md) exist *because of this*. Libfive lets you drag the surface and a small solver nudges free vars. That is the “fancy manipulation” we refused, and it is also the only known way to keep gizmos on composed geometry.

**Existing evidence:** OpenSCAD has no drag; people live with Customizer sliders (`/* [Hidden] */`). Antimony gizmos bind to **node ports**, not to whatever integer happened to appear in a Python expression. Zoo’s GUI and KCL stay in sync because the language is CAD-shaped, not because they grep literals.

**Covered?** Only if we **abandon “any numeric literal”** as the law.

| Patch | Covers? | Cost |
| --- | --- | --- |
| Wrapper types: `mm(18)`, `point(3,4)`, `deg(30)` are the only tweak sites | Yes, locally | You must type the wrapper; plain `18` is dead. Honest, like CSS colors needing `#` or `rgb()`. |
| Named params object `export const band = { inner: mm(18), … }` imported everywhere | Yes, cross-scene | This *is* a parameter store. We said we would not have one. It should live in source, but it is still a store. |
| Trace inversion of `+` `*` | Partially | Reintroduces Sketch-n-Sketch ambiguity. Do not. |
| Drag surface, solve for free wrappers (libfive) | Yes, on the surface | Real solver, not v1. Separate from click-to-fill. |

**Not covered by hope:** automatic gizmos on `shell(extrude(wrapPolar(p, 19.5), 6), 1.2)` with three literals in three different spaces (radius, height, thickness). Widget *kind* cannot be inferred from “it is a number.” Library authors must declare handles (Antimony’s explicit UI in the node script). The plan’s “the sketch should not know it is being authored” is false for 3D.

---

## 2. “Code is the graph” does not replace a timeline’s UX

**Assumption:** Fusion is bad because history is a linked list; TypeScript is a DAG; therefore Fusion users would rather write modules.

**Hole:** The timeline is not only a bad serialization. It is a **time machine and a blame tool**. Rollback to before the fillet, suppress a feature, see who did what without reading a diff. Feature names are documentation. Non-programmers *replay decisions*. Git + functions replay nothing unless you are already a programmer who writes commits that way.

Spaghetti code is just an invisible Grasshopper definition. Modules help only with discipline. CadQuery/Zoo/OpenSCAD already offer “the graph is code.” None of them ate Fusion. The missing piece was never “TypeScript instead of Python.”

**Existing evidence:** [Zoo](https://zoo.dev/research/zoo-cad-engine-overview) bets on **B-rep + a CAD language (KCL)** with a GUI that writes that language — closest “code is source of truth” CAD, and they *rejected* SDF as the kernel for ordinary parts. CadQuery has VS Code, tests, STEP, and still sits beside SolidWorks, not on top of it.

**Covered?** For an audience that already wants OpenSCAD-with-a-viewport: **yes**. As a Fusion replacement: **no**, and we should stop saying that. Position as “OpenSCAD/libfive/Antimony, with TS modules and several viewers.” Covered by honesty, not by a feature.

---

## 3. Ordinary TypeScript is not a GPU SDF kernel

**Assumption:** write normal functions, mark `'use gpu'`, same `f` on CPU and GPU.

**Hole:** A printable solid is `for (const s of stones) f = union(f, prong(s))` plus imports and data. TypeGPU kernels are a **restricted subset**. A scene that is “just TypeScript” does not automatically become a raymarch shader.

You either:

- **Compile** an SDF AST (combinators record a tree → WGSL), so user code is a DSL that *looks like* TS, or
- **Interpret** a buffer of primitives on the GPU (bounded N, slower, Shadertoy-style), or
- **CPU** sphere-trace / slice, and GPU is optional candy.

The plan pretends these are the same as `import { wrapPolar }`.

**Existing evidence:** Shadertoy and MagicaCSG cap scene complexity in the language. libfive compiles an interval-arithmetic tree (not “any Scheme”). nTop has an explicit implicit graph IR.

**Covered?** Yes, if we **admit an SDF IR**: std combinators (`union`, `transform`, `extrude`, `wrapPolar`) build a tree; loops push instances into arrays of known max length; anything else is CPU-only and cannot go in the viewport kernel. User-defined `function myStone(...)` must be written in the subset or inlined.

**Not covered:** “a normal programmer’s loops and everything” inside the *hot field*. That remains true in *library construction* of the IR (CPU), not inside `f(p)`.

---

## 4. The field is not a distance, so “SDF all the way to print” lies

**Assumption:** one `f` for raymarch, wall thickness, offset/shell, overhang, slice AA.

**Hole:** `min`/`max` CSG and `smin` blends are **not** Euclidean SDFs. Interior/exterior distances break; offset (`f - t`) after a union can change topology; thickness queries lie; slice antialias by `|f|/pixel` is wrong where `f` is only an occupancy field. This is textbook ([CSG on SDFs](https://dl.acm.org/doi/fullHtml/10.1145/3610548.3618170), IQ’s own caveats). Warp/bend/`wrapPolar` also destroy Lipschitz constants; sphere tracing can miss or crawl.

Viewport can look fine (zero set is still the surface) while **manufacturing queries are garbage**. That is the worst class of bug: pretty preview, shorted ring, paper-thin wall.

**Existing evidence:** ForgeCAD documents offset/shell as approximate after twist/smooth boolean. nTop invests heavily in *field-aware* manufacturing, not `f-0.4`. libfive uses interval arithmetic and meshing with feature detection *because* naive marching/offset is insufficient.

**Covered?** Partially:

| Use | Trust `f`? | Patch |
| --- | --- | --- |
| Occupancy slice `f <= 0` | Yes if the zero set is the design | Direct MSLA masks are the one query that *does not need* a true distance |
| Raymarch preview | If Lipschitz-ish / extra steps | Relaxed tracing, bounds, preview quality vs print quality |
| `shell`, `offset`, wall thickness | No, after CSG/warp | Compute offset only from **exact** primitives, or rebuild a better field (slow), or mesh and use mesh offset (ironic) |
| Overhang via `∇f` | Approximate | Still useful as a shader, not as a guarantee |
| Exact CAD fillet / H7 bore | No | Do not offer them. Different kernel (Zoo’s point) |

**Important inversion:** direct slicing **does not need** a true SDF. It needs a consistent inside test. The plan’s manufacturing path is *more* valid than its inspection path. Thickness/shell should be combinators on primitives **before** sloppy CSG, or a second, slower field.

**Not covered:** replacing Fusion dimensioning. Zoo’s writeup is correct that implicit → STEP/B-rep is a research swamp. Do not promise drawings or machine shops.

---

## 5. Two kernels: 2D drawing vs 3D field

**Assumption:** unwrapped 2D and wrapped SDF are the same program.

**Hole:** Designers draw **strokes** (polylines, splines, text). Solids are **fields**. `ringProfile` returning `Sd2` makes the 2D scene an isoline viewer — bad for placing a motif. Returning a polyline makes wrap/extrude a “polyline → SDF” problem (exact SDF of a spline is ugly; `sdPolyLine` is a recipe with caveats).

That conversion **is the product** for the ring example, and it is currently a slogan.

**Existing evidence:** Fusion sketches are B-rep 2D; MagicaCSG is SDF-first with almost no sketch. Tools that do both (CAD + implicit) keep two representations and a one-way compile.

**Covered?** Yes with an explicit contract:

- 2D authoring type = curves (polyline/arc; splines later).
- `offset` / `stroke` / `region` compile to `Sd2` at a boundary you control.
- `wrapPolar` / `extrude` take `Sd2` or a curve+radius, not “any TS value.”
- 3D Euclidean scene is optional debug (the wrap as a grid), not a third kernel.

**Not covered:** treating “2D Euclidean” and “SDF” as interchangeable views of one value without that compile step. They are not.

Inverse wrap (drag on the 3D ring, write 2D `u,v`) is a **separate unproject**. The plan’s “pick gizmos, not the SDF” forbids the most useful 3D edit for that workflow. **Covered** by making 2D the only authoring space for wrap motifs, 3D display-only until we add “place on domain.” Do not pretend both are free.

---

## 6. The hero print job may not want this kernel

**Assumption:** resin printing is why SDF-to-slice matters; a ring is the example.

**Hole:** A smooth ring is a small STL. Lychee/Chitubox will auto-support, raft, hollow, drain, layout, and talk to the printer. Direct PNG-stack interop is vendor soup (CTB, GOO, PWMO…). nTop’s “no mesh” win is **gigantic lattices / heat exchangers**, where meshing is the bottleneck. For a band, we would be a worse print-prep tool with extra steps.

If users export STL “just this once,” the native slice path never gets used, and we are MagicaCSG/libfive with extra scenes.

**Existing evidence:** Jewelry CAD (MatrixGold, Rhino+Grasshopper, JewelCAD) is NURBS, gems, prongs, sprues — not gyroid fields. Mini painters use Nomad/Blender → STL → Lychee. MagicaCSG stays in SDF-land for stylized solids and still meshes out.

**Covered?**

- **Change the hero part** to something mesh-hostile: high-frequency wrap texture, gyroid core, organic engraving, lattice pendant. Then direct slice is the point.
- **Do not do supports/layout.** Hand off a solid (layers or a *fine* mesh) to UVTools/Lychee. Covered as scope. Then we must still win on *geometry* they cannot get elsewhere.
- **STL/3MF export** as compatibility. Covered, but it undermines the speech about meshlessness. Be explicit: mesh is for other people’s software; layers are for *our* high-frequency parts.

**Not covered:** beating Lychee at being a slicer. Do not try.

---

## 7. Code-first CAD is a 15-year niche, on purpose

**Assumption:** modules + mouse + scenes will make this productive like Blender/Fusion.

**Hole:** OpenSCAD, ImplicitCAD, libfive Studio, CadQuery, Cascade Studio, Replicad, Zoo KCL. The remaining pain of OpenSCAD is (a) no direct manip, (b) CGAL mesh, (c) a bad language. We address (a) weakly (literals only), (b) by SDF (new pain), (c) by TypeScript (real win for programmers).

MagicaCSG and Nomad are **SDF-productive without code**. If the user is a designer, they win. If the user is a programmer who already writes OpenSCAD, CadQuery+STEP may be more “real CAD” and Zoo may be more funded.

**Covered?** Only as a **personal/ICP tool**: people who want git, libraries, tests, and fields. That is enough to build. It is not enough to “replace Fusion.” libfive already *is* scripted f-rep + GUI drag of `#` vars + mesh export. Our deltas that might matter:

1. TypeScript / real modules / npm (libfive is Scheme/Python, Studio is a silo).
2. Multiple scene types as first-class tests (libfive is one viewport).
3. Direct MSLA slice of high-frequency fields (libfive → STL).
4. Literal/wrapper gizmos in the editor you already use (VS Code).

If we fail to make (2)+(3) sharp, we are a slower libfive with a bundler.

---

## 8. Scenes-as-tests vs a platform of scene types

**Assumption:** 2D Euclidean, 3D Euclidean, SDF, map, slicer.

**Hole:** Five runtimes. Map alone is GIS + double precision + tiles. 3D Euclidean vs SDF is overlapping. Platform death before one loop works.

**Covered?** Cut to **three**: `euclid2` (curves), `sdf` (volume + gizmos), `slice` (layers). Map is a later library with a mandatory local origin. 3D Euclidean only if SDF overlay cannot show construction frames. **Covered by deletion.**

---

## 9. Toolchain, purity, git, eval

| Risk | Kill? | Cover |
| --- | --- | --- |
| tsover as a `tsc` fork breaks CI, Monaco, collaborators | Can stall months | **v1 without infix.** `std.add` / `.add`. tsover is progressive enhancement. Original TypeGPU wish is optional. |
| WebGPU missing in VS Code webview / Safari | Viewport dies | CPU isolines + few-layer slice preview. GPU optional. |
| General TS: `Date.now()`, fetch, mutation → unreproducible solids | Silent wrong prints | Scene `export default` must be a **pure function of args + imported data**. Lint. No network. OpenSCAD’s DSL was a feature. |
| Drag writes `19.5000001` → filthy git | Annoyance | Quantize to 0.01 mm (jewelry) / 0.001 mm. Format on pointerup only. |
| Cross-file edit: gizmo in scene, literal in `demo.ts` | Mystery meat | Always show “editing `src/jewelry/demo.ts:12`”. Peek. Refuse to edit `node_modules`. |
| Shader recompile every keystroke | Unusable | Shape-stable literal edits patch uniforms; structural edits debounce. Desmos split, recovered. |
| Infinite loop / GPU hang | Crash | Time budget, last good frame. OpenSCAD F5/F6. |

All of these are **engineering**, not conceptual. They are still enough to make a “small plan” never ship.

---

## 10. What the comparison table actually says

| Product | Kernel | Program | Mouse | Out | Why we’re not them |
| --- | --- | --- | --- | --- | --- |
| Fusion / MatrixGold | B-rep | History | Native | STEP, CAM, gems | Different job; we lose on precision jewelry hardware |
| OpenSCAD | CGAL mesh | DSL | Customizer | STL | We can beat language + drag; we must not become CGAL |
| CadQuery / Zoo | B-rep | Python / KCL | Zoo: GUI↔code | STEP | Better *mechanical* code-CAD; we should not compete |
| libfive Studio | f-rep | Scheme | `#` free vars + surface drag | STL | Closest; we need modules + scenes + slice or we lose |
| Antimony | f-rep | Python nodes | Gizmos on ports | STL / heightmap | Closest graph; we need `import` instead of `.node` |
| nTop | implicit | Visual graph | Params | Implicit slice (metal) | Same manufacturing idea; enterprise, not git-TS |
| MagicaCSG / Nomad | SDF | None | Sculpt | Mesh | Faster for one-off shapes; no libraries |
| Desmos | expressions | LaTeX list | Points/sliders | none | 2D interaction to steal, not a CAD |
| Sketch-n-Sketch | SVG | Tiny lang | Synthesis | SVG | Mood, not architecture |

The empty cell we can occupy: **git-native TS libraries of fields, with visual test scenes, and layer output for parts that would mesh into sludge.** Everything else in the plan is either borrowed or in conflict.

---

## 11. What to demote so the rest can be true

Keep as **principles**:

- Source of truth is the repo (no silent sidecar).
- Libraries + scene files (tests).
- Occupancy field → resin layers for mesh-hostile geometry.
- Mouse edits **declared** tweak sites (`mm`, `point`, `deg`), not arbitrary integers.
- No program synthesis.

Demote to **optional / later**:

- tsover
- Map scene
- 3D Euclidean as a separate kernel
- True-distance inspection (thickness as a guaranteed query)
- Fusion-replacement rhetoric
- Click-to-fill holes (delight, not the kernel)
- Surface-drag solver (libfive-style)

Admit as **IR**, not “just TS”:

- Combinator tree + instance buffers for GPU
- Curve → Sd2 compile step

Change the **hero example** from “plain ring” to “ring with a high-frequency wrap or a gyroid-ish core” so slice-without-mesh is a real win. A smooth band should still work, but it will not justify the kernel.

---

## 12. Residual risk after patches

Even with the demotions, the project can still fail because:

1. **libfive + a TypeScript wrapper** might be 80% of the geometry and 20% of the time. Building a new f-rep compiler in TypeGPU is the expensive part; using libfive/WASM for the field and TypeGPU only for display would be the unromantic solution. Not using an existing interval kernel means we relearn meshing/sharp features the hard way.
2. **Nobody runs visual tests.** Scenes-as-tests is a workflow religion. If we do not dogfood a library with three scenes, it becomes a shader toy.
3. **Print interop.** If we cannot drop layers into *one* real MSLA path (even PNG sequence + UVTools), manufacturing is a screenshot.

Those three are not design contradictions. They are “will anyone get a part out.”
