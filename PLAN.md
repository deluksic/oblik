# Code-first graphing: how Desmos actually works, and what to steal

This is a design note, not an implementation plan with dates. The goal is to understand the interactive core of Desmos well enough to rebuild that core for a different audience: people who want TypeScript, operator-overloaded vectors, and real code reuse instead of a LaTeX expression list.

The motivating scene is small on purpose:

> drop a few points, connect them with lines, add a slider, and have a circle’s radius follow that slider — every dependent piece of geometry updating itself.

That scene is the product. Plotting `y = x²` is a later client of the same engine.

---

## 1. What Desmos actually is

Desmos looks like a graphing calculator. Internally it is closer to a tiny declarative programming language with a live compiler, a dependency graph, and two kinds of interaction: **edit the program** and **nudge its inputs**.

Eli Luberoff’s original insight, from tutoring software, was that *graphs with sliders* were the only part that actually changed how students understood the math. The rest of the product is machinery to make that loop cheap: type something, see the consequence, drag a handle, see everything that depends on it move.

The Geometry tool is not a separate product. It is the same math engine with a construction UI on top. Points, lines, circles, measurements, transformations, and gliders all compile down into the expression graph. That is why a slider can drive a dilation, and why dragging a triangle vertex updates an algebraic measurement of its area.

### 1.1 The expression list is a program

Each row is a statement that can do any combination of:

- **export a symbol** (`a = 3`, `f(x) = x^2`)
- **plot something** (`y = x^2`, `(1, 2)`, `x^2 + y^2 = r^2`)
- **evaluate** (`2 + 2` shows `4`)
- **fail**, with an error attached to that row

Free identifiers that are not yet defined become **sliders**. That is how Desmos invents interactivity from incomplete math: a letter in a number’s place is an input, not a syntax error.

A movable point is the same trick in 2D. `(a, b)` where `a` and `b` are parameters *is* those sliders. Dragging the point writes back into `a` and `b`. Anything that mentioned `a` or `b` is now dirty.

This is the whole magic, stated bluntly:

1. Mutable state lives only in **inputs** (slider numbers, draggable coordinates).
2. Everything else is a **pure function** of those inputs.
3. Drawing is a **view** of the evaluated graph.
4. Direct manipulation never edits derived geometry. It edits the inputs that geometry was computed from.

If you drag a midpoint, Desmos does not solve “which parent should move.” The midpoint is not an input. It is a readout. That restriction is what makes the system feel obvious instead of like a constraint solver.

### 1.2 The keystroke pipeline

From the Desmos engineering post *Pressing a Key in the Calculator* and from Jason Merrill’s 2016 HN walkthrough:

```
keystroke
  → MathQuill (typeset + emit LaTeX)
  → optimistic model update on the main thread (Flux)
  → web worker
       parse LaTeX in three passes
       analyze exports / dependencies
       mark dependent expressions dirty
       substitute a “frame” of concrete values
       constant-fold
       compile to JS via `new Function()`
       plot (sample → polylines)
  → canvas draw
```

The three parse passes exist because LaTeX structure is not math structure:

1. **LaTeX → display tree.** Visual groups (numerator, superscript). Mathematically ignorant.
2. **Display tree → expression tree.** Operator precedence, “surface” nodes.
3. **Lower.** Context-sensitive meaning: is `,` a list or a point? Is this an assignment or an equation to plot?

They split the passes so the same core parser can be reused across calculator, geometry, and different “legal node” configurations, by swapping the `lower` step.

Compilation to `new Function()` rather than an interpreter exists because plotting evaluates the same expression thousands of times per frame of interaction. An AST walker is too slow for that.

### 1.3 The “frame” and dirty tracking

After parsing, identifiers are still abstract. Desmos builds a **frame**: a dictionary of every symbol the expression list currently exports. Substituting the frame produces a **concrete tree**, then constant folding collapses `2 * a` when `a = 4` into `8`.

Because the list is one program, a change to `a` can theoretically affect every other row. They dirty only dependents, then rebuild concrete trees for those rows. Slider drags and point drags are the important special case: **the LaTeX did not change**, only a number in the frame did. Parse and compile can be skipped. Re-substitute, re-evaluate, re-plot.

That split — *edit the source* vs *nudge an input* — is why dragging a slider feels like a different, cheaper path than typing.

### 1.4 How drawing works

All plotters emit the same thing: arrays of tiny line segments, shipped back to the main thread, stroked on an HTML5 canvas.

| Kind | Strategy |
| --- | --- |
| Explicit `y = f(x)` | Uniform samples along x, collapse collinear runs, bisection when neighbors suggest a zero, extremum, or jump |
| Parametric | Same, but two compiled functions and curvature-aware subdivision |
| Polar | Same, plus a periodicity check so they do not redraw the same loop |
| Implicit `f(x, y) = 0` | Quadtree over the plane, sign of `f`, triangles along the +/- boundary, polygonize the zero set |

They know the implicit plotter is more accurate and slower. They keep the specialized plotters because interactivity is the product. SVG was tried for hit-testing (“which curve did I click?”) and abandoned for performance and browser differences. Hit-testing is therefore a separate problem from drawing.

### 1.5 Geometry, sliders, gliders

On top of the same graph:

- **Construction tools** insert expression-graph nodes (point, line, circle, polygon, transform) and give them tokens in a navigator.
- **Gliders** are points whose coordinates are not free in the plane. They are a scalar parameter along another object. A slider on that scalar animates the glider.
- **Measurements** are just more expressions: `distance(A, B)`, angle, area. They recompute when inputs move.
- **Actions / tickers** (later Desmos) are the escape hatch for things that are not a pure DAG: “when this happens, set that.” Skip this until the pure model is solid.

### 1.6 What they optimized for, and what they accepted as limits

Optimized for:

- Immediate consequence of a local change
- Typeset math that non-programmers can enter
- Sharing a graph as a URL of state
- Classroom-safe constraints (readonly expressions, secret folders)

Accepted as limits (exactly the ones this project wants to reject):

- No real functions-as-values / modules / user data structures
- Lists exist, but they are a math-list, not a programming language
- Custom data is painful
- The program is a flat list of LaTeX strings
- Reuse is copy-paste or a folder of expressions

Desmos is a **math notebook that happens to be live**. We want a **small live programming environment that happens to draw math**.

---

## 2. What TypeGPU actually gives us

TypeGPU is not a graphing library. It is a typed WebGPU toolkit whose shader language is a restricted TypeScript. The relevant pieces:

### 2.1 `'use gpu'` functions are dual

A function marked `'use gpu'` is still a normal JS function. `unplugin-typegpu` also serializes its AST (tinyest). At runtime TypeGPU can:

- call it on the CPU
- or transpile it to WGSL and run it on the GPU

That is the CUDA `__host__ __device__` idea. For a graphing tool it means **the formula you drag-test on the CPU is the formula you densely sample on the GPU**, not two copies.

### 2.2 Vectors are real values, not shader-only types

`d.vec2f(1, 2)` is a JS object. It has `.add`, `.mul`, etc., and `typegpu/std` (`std.add`, `std.mul`) with `dualImpl`: a JS implementation plus a WGSL codegen implementation.

So this is already a CPU geometry kernel:

```ts
const mid = a.add(b).mul(0.5);
```

### 2.3 Operator overloading is tsover, not TypeScript

[tsover](https://tsover.swmansion.com/) is Software Mansion’s TypeScript fork. It adds operator overloading to the type checker. TypeGPU’s `vec`/`mat` types define `[Operator.plus]`, `[Operator.star]`, and so on via `tsover-runtime`.

Two different transforms exist:

| Where the `+` is | What makes it run |
| --- | --- |
| Inside `'use gpu'` | `unplugin-typegpu` already lowers infix ops to WGSL / dual calls |
| Inside `'use tsover'` but not `'use gpu'` | You need the **tsover bundler plugin**, or it is a type-level fiction and a JS `+` that stringifies objects |

That distinction matters. Sketch code that computes midpoints on the CPU (dragging, hit-testing, the scene graph) lives outside shaders. For `mid = (a + b) * 0.5` to work in that sketch, we must either:

- run sketches through the tsover plugin, or
- keep sketches inside `'use gpu'` functions that we *call on the CPU* (TypeGPU supports this), or
- accept fluent methods in the first prototype

TypeGPU docs are explicit: without tsover, scalars still use `+`; vectors need `std` or `.add`.

### 2.4 What we should not expect TypeGPU to do

TypeGPU will not give us:

- a dependency graph
- sliders
- hit-testing
- a code editor
- implicit-plot contouring (unless we write it)

It will give us:

- `vec2` math that feels like math
- one function, two backends
- later: dense sampling, SDF drawing (`@typegpu/sdf`), maybe implicit fields as GPU shaders

Use it as the **numeric / shading layer**, not as the **reactive layer**.

---

## 3. The design we actually want

Clone Desmos’s *state model*. Replace its *surface language*.

### 3.1 Three kinds of thing

```
Inputs          Derived values           Draw list
------          --------------           ---------
slider r        mid = (A+B)/2            line(A, B)
point A         radius = distance(A,B)/2 circle(mid, r)
point B         f(x) = ...               plot(f)
table data      ...
```

**Inputs** are the only things the pointer or a slider widget may write.

**Derived values** are ordinary TypeScript. Functions, loops, imported modules, typed arrays, custom structs — this is the whole point of leaving LaTeX.

**Draw list** is collected as the sketch runs: points, polylines, circles, plots. It is not a retained scene graph the user mutates. It is rebuilt from inputs.

### 3.2 Sketch as a function, not a list of rows

Desmos’s list is unordered-ish (a DAG of names). Code has scope. That is the upgrade.

```ts
import { d } from 'typegpu';

export function sketch(g: Graph) {
  'use tsover';

  const r = g.slider('r', 1.5, { min: 0.1, max: 5 });
  const A = g.point('A', d.vec2f(-2, 0));
  const B = g.point('A' /* wait, B */, d.vec2f(2, 0));

  const mid = (A + B) * 0.5;
  const radius = r; // or length(B - A) * 0.5, etc.

  g.line(A, B);
  g.point('M', mid, { draggable: false });
  g.circle(mid, radius);
}
```

`g.slider` / `g.point` **read** named inputs from a store, creating them with defaults on first run. They return plain numbers / `vec2f`. Subsequent math is just math. `g.line` / `g.circle` **append** to this frame’s draw list.

Dragging `A` writes `inputs.A = newVec` and re-runs `sketch`. `mid` and the circle follow because they were never stored.

This is Processing / p5 / Observable, not SolidJS. For the motivating scene, re-running the whole sketch is the correct first model. Desmos’s incremental dirty tracking exists because compiling and sampling plots is expensive. We can add incrementality later, around plots only.

### 3.3 Why named inputs, not raw `let`

```ts
let A = d.vec2f(-2, 0); // cannot drag this; there is nothing to write back to
```

A draggable point needs a stable identity across re-runs (“this is the same A”), a place to store the user’s drag, and a policy for “the code’s default vs the dragged value.”

Named inputs (`'A'`) give:

- identity for hit-testing
- persistence when the sketch is re-run
- a slider panel that can list them
- a serialized state object separate from source (`{ A: [1.2, 0.3], r: 2.1 }`)

If the user edits the default in source, we need a rule. Desmos’s rule is “the latex *is* the state.” Ours should be: **source provides initial values and bounds; the input store wins once the user has touched that handle.** Provide a “reset inputs” action. Do not silently overwrite a dragged point when the user types a comment.

### 3.4 Derived vs input, and what is draggable

| Object | Draggable? | Why |
| --- | --- | --- |
| `g.point('A', …)` | yes | it is an input |
| `mid = (A+B)*0.5` | no | it is derived; drawing it is a labeled readout |
| `g.glider('P', lineAB, t)` | along the line | input is the scalar `t`, not a free `vec2` |
| a plotted curve | no (v1) | sampling output |

Do not invert constraints in v1. GeoGebra-style “drag the circumcenter and have the triangle follow” is a different product (a constraint solver with multiple solutions). Desmos mostly avoided it for graphing; geometry gliders are the one structured exception, and they are still a single scalar input.

### 3.5 Code reuse and custom data

This is the actual product difference.

```ts
function circumcenter(a: d.v2f, b: d.v2f, c: d.v2f): d.v2f {
  'use tsover';
  // real function, importable, testable
}

const samples: d.v2f[] = loadPolyline(json);
for (const p of samples) g.dot(p);
```

Desmos cannot do this without grotesque list comprehensions. We should treat “user functions” and “user arrays” as first-class from day one of the API, even if the editor is still a single file.

### 3.6 Reactivity: two loops, not one

**Loop A — interaction (60+ Hz, must never hitch):**
pointer → hit-test handles → write input store → re-run sketch → upload draw list → GPU/canvas

**Loop B — program edit (on keystroke, can be slower):**
source change → typecheck / transpile (tsover + typegpu) → replace `sketch` function → keep input store → run Loop A

Desmos maps Loop B to MathQuill + parse + compile, and Loop A to frame substitution + plot. We should keep that split even though both loops execute TypeScript.

Heavy plots belong in Loop A only after they are compiled (GPU pipeline or a worker). While a plot is compiling, show the last good polylines plus an “updating” state.

### 3.7 Rendering

v1 drawing is 2D graph paper:

- grid, axes, labels
- points (with a hit halo, like Desmos)
- line segments / polylines
- circles (or discretized)
- slider widgets in a side panel, not on the paper

WebGPU via TypeGPU is justified even for v1 if we want one stack, but a canvas2D fallback for the scene graph is honest: Desmos proved canvas is enough for this density. GPU becomes load-bearing at:

- many thousands of samples
- implicit / SDF fills
- 3D later

`@typegpu/sdf` is a plausible future for “the circle is a true disc with cheap AA,” not a v1 requirement.

### 3.8 Editor

Audience is people who write code. Options, cheapest first:

1. **Sketches as modules in the repo**, hot-reloaded. Best for us while designing the API. Worst as a product.
2. **In-browser TypeScript** (Monaco) + esbuild-wasm / sucrase, with tsover plugin in the worker. Real product. Setup cost is the tsover + TypeGPU transform pipeline in the browser.
3. **Restricted eval** of a sandbox language that looks like TS. Avoid. We would be writing a worse TypeScript.

Recommendation: design the `Graph` API as a library first (1), with one canonical sketch being the points/lines/slider/circle scene. Put Monaco on the roadmap once the API is boring.

In-browser, `'use gpu'` + `'use tsover'` must run through the same transforms as Vite. TypeGPU’s own docs site already does this (Monaco examples). Steal that setup rather than inventing one.

---

## 4. Mapping Desmos concepts onto this system

| Desmos | This project |
| --- | --- |
| Expression row | Statement in `sketch()`, or a helper you call |
| LaTeX parse / lower | TypeScript + tsover + TypeGPU |
| Frame (symbol table) | Input store + local `const`s |
| Slider | `g.slider(name, default, bounds)` |
| Movable point | `g.point(name, defaultVec)` |
| Dependent geometry | Ordinary derived `const`s |
| Plotter | `g.plot(f)` where `f` is `'use gpu'` |
| Web worker math | GPU compute + optional worker for CPU fallback |
| Canvas polylines | Same, or SDF |
| Geometry constructions | Functions in a stdlib (`line`, `circle`, `glider`, `midpoint`) |
| `new Function()` | Bundled / transformed TS. Do not eval user strings until the editor exists |
| MathQuill | Monaco (later) |
| Implicit plot quadtree | Defer. Possible GPU SDF / marching later |
| Actions / ticker | Defer. Breaks the pure DAG |

---

## 5. Suggested stdlib (small, not a platform)

Enough to make the motivating scene and a little more, and to force API decisions:

**Inputs**

- `slider(name, value, { min, max, step? }) → number`
- `point(name, xy, { draggable? }) → vec2f` (also draws itself)
- `angle(name, radians, bounds?) → number` (optional)

**Geometry**

- `line(a, b)`
- `segment` / `ray` if we care
- `circle(center, radius)`
- `polyline(points)`
- `dot(p)` for derived points

**Measure (derived, not inputs)**

- `distance(a, b)`
- `midpoint(a, b)` — sugar over `(a+b)*0.5`

**Plot (phase 2)**

- `plot((x) => y)` explicit
- parametric later
- implicit much later

**Data**

- pass any JS value into the sketch closure, or `g.data(name, array)` if it should be editable later

Resist a full GeoGebra kernel (intersections of two circles as first-class objects with multiplicity). Intersection as a function that returns `vec2f | null` is enough for a long time.

---

## 6. Build order (when we leave the document phase)

Each step should be a usable slice, not scaffolding.

1. **Input store + sketch runner + canvas graph paper.** Hardcoded sketch in TS. Sliders as HTML. Points draggable. Lines and a circle that follow. This is the Desmos lesson, fully present, with no TypeGPU required.

2. **Swap numbers/`{x,y}` for `d.vec2f` and tsover.** The sketch should read `(A + B) * 0.5`. Prove CPU operator overloading in the runner (tsover plugin *or* `'use gpu'` functions called from JS).

3. **Named examples / reset / empty & error states.** Sketch throws → keep last good draw list, show the error. No WebGPU yet is fine.

4. **`g.plot` on CPU** with Desmos-style uniform sampling and collinear collapse. Confirm Loop A still feels like dragging, not like recompiling.

5. **Move sampling into a `'use gpu'` function.** Same `f`, GPU buffer of points, draw as a polyline. This is the first time TypeGPU is load-bearing.

6. **In-browser editor** with the TypeGPU/tsover transform. Persistence of `{ source, inputs, viewport }`.

7. Only then: gliders, implicit plots, SDF fills, 3D.

Do not start with a GPU implicit plotter, a shader editor, or a constraint solver. Those are how this turns into a platform before it is a tool.

---

## 7. Risks and open decisions

**tsover outside shaders.** If we want `A + B` in the sketch body, the runner’s toolchain must include the tsover runtime transform, not just the TypeScript fork for the IDE. Confirm this on a one-file Vite app before designing the in-browser editor around it.

**`'use gpu'` subset.** Sketch code will want `for`, closures, imported helpers, optional objects. TypeGPU functions cannot do all of that. Keep the *sketch* as ordinary TS (plus tsover), and only mark *plot kernels* `'use gpu'`. Do not force the whole sketch through the GPU subset.

**Who owns defaults.** Source vs dragged state, as in §3.3. Pick “inputs win after first touch” and make it visible in the UI (a reset control). Hidden divergence between code and paper will feel like a bug.

**Hit-testing.** Canvas/WebGPU will not tell us which point was clicked. Maintain a CPU list of handles in graph space, with a pixel-space halo. Desmos does this; SVG would have been the alternative they rejected.

**Eval security.** An in-browser sketch is arbitrary JS. Treat it as a local-only playground until there is a reason to sandbox.

**WebGPU availability.** Graph paper + handles must work without GPU. TypeGPU’s experimental WebGL fallback is interesting later, not a v1 bet. CPU canvas is the baseline.

**Incrementality.** Re-run the sketch until plots force otherwise. Measuring that moment is better than building a signal graph first.

---

## 8. Sources

Desmos internals:

- [Pressing a Key in the Calculator](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/) — parse, frame, plotters, workers, canvas
- [Jason Merrill on HN (2016)](https://news.ycombinator.com/item?id=11369540) — dependency dirtying, `new Function()`, why not SVG
- [Sliders and movable points](https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph)
- [Geometry tool on the graphing engine](https://blog.desmos.com/articles/geometry-beta-release/)
- [jaosber/desmos-latex-parser](https://github.com/jaosber/desmos-latex-parser) — four-phase parser extracted from the worker

TypeGPU / tsover:

- [TypeGPU functions](https://docs.swmansion.com/TypeGPU/apis/functions/) — `'use gpu'`, dual CPU/GPU, tsover
- [Data schemas / vector operators](https://docs.swmansion.com/TypeGPU/apis/data-schemas/)
- [tsover](https://tsover.swmansion.com/) and [defining overloads](https://software-mansion.github.io/tsover/docs/defining-overloads)
- [TypeGPU blog](https://docs.swmansion.com/TypeGPU/blog/) — releases, examples, Monaco-based docs site as an existence proof for in-browser TGSL

---

## 9. Bottom line

Desmos’s interactive feel does not come from LaTeX, MathQuill, or clever implicit plotting. It comes from a **pure dataflow with named inputs**, a **fast path that skips parsing when only an input moved**, and **drawing as a throwaway view**.

A TypeGPU-flavored clone should keep that model and change the language:

- TypeScript instead of expression rows
- `vec2` with real `+` / `*` instead of `std.add` soup (via tsover)
- user functions and data instead of a flat symbol table
- GPU only where sampling or shading is actually dense

The first thing to build, when we build, is still that circle on a slider — in code.
