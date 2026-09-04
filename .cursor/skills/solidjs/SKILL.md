---
name: solidjs
description: >-
  Solid 2 UI in this monorepo: chrome and panes live inside the single oblik
  package (host/, euclid2/, figure/, modal/), Solid + SVG view, Vite plugin,
  JSX/class conventions and lifecycle. Use when editing .tsx under
  packages/oblik, adding Solid components, wiring Vite/TS config, or when the
  user mentions Solid, SolidJS, solid-js, or @solidjs/web.
---

# SolidJS (this repo)

## Stack

- **Solid 2 RC**: `solid-js@2.0.0-rc.0`, `@solidjs/web@2.0.0-rc.0`. Render from `@solidjs/web`; everything else from `solid-js`. Pin together (see reference.md).
- **Vite**: `@solidjs/vite-plugin` + `unplugin-icons` (compiler `"solid"`) in `apps/demo/vite.config.ts`, with the oblik plugin (`packages/oblik/src/source/vite-plugin.ts`).
- **No SolidStart**, **no React** — do not use React hooks, `classList`, or React patterns.
- **TS**: `jsx: "preserve"`, `jsxImportSource: "@solidjs/web"`, `lib: ["ES2023", "DOM"]` in `apps/demo/tsconfig.json` and `packages/oblik/tsconfig*.json`.

## Where Solid lives

The whole UI is one package: `packages/oblik`. Solid chrome and panes are `.tsx`; the geometry/eval/source layers are vanilla TS and stay Solid-free.

```
packages/oblik/src/
  host/       mount + app chrome: Host.tsx (mountOblik), Nav, SelectionSidebar, routing, scene-hot
  euclid2/    Pane, Palette, view/* (View, Ink, FillFace, Hud, Grid, Ghost, chrome, sliderHud), tool + tools/*, pick, camera
  figure/     P9 paint scenes: Pane, View, Palette, Ink, BrushDock, FrameEditor, ExportModal, frame, chips, export, pick, tools
  modal/      Modal root context (mountOblik wraps the app in <Modal>)
  source/     Vite plugin, catalog/analyze/stamp/hoist/insert/patch (editor — not UI)
  eval/, geom/  pure TS — never import Solid here
```

App: `apps/demo` — `src/main.tsx` calls `mountOblik({ el, scenes, loaders, annotations, mentions, collisions })` and wires HMR. Scene modules (`src/scenes/*.ts`) and layout helpers (`src/layout/*.ts`) are Solid-free `defineScene` programs.

## `class` (Solid 2)

`classList` is gone. Use **`class`**. It accepts strings, arrays, and object maps (clsx-style). **Mix them in arrays.**

```tsx
// Base class string + conditional object map
class={[styles.pane, { [styles.paneFocused]: props.focused() }]}

// Multiple conditionals in one object
class={[
  styles.wrap,
  {
    [styles.picker]: mode() === "picker",
    [styles.promptDock]: mode() === "prompt",
  },
]}
```

**Do not** use template-string interpolation for classes:

```tsx
// ❌
class={`${styles.a}${cond ? ` ${styles.b}` : ""}`}

// ✅
class={[styles.a, { [styles.b]: cond }]}
```

Static-only: `class={styles.nav}`.

## Lifecycle & DOM

- **`createEffect` (compute / effect split)** — see below. **Do not use `onSettled`** — forbidden here (oxlint `no-restricted-imports` + `solid-conventions.test.ts`).
- **Async resource in `createMemo`** — register `onCleanup` **before** the first `await`. If the memo re-runs while awaiting, cleanup still runs. Host.tsx's `loaded` memo is the canonical example (module cache + `cancelled` flag + `setSceneRev` on HMR).
- **Refs** — use signal refs (`const [el, setEl] = createSignal<HTMLDivElement | null>(null)` + `ref={setEl}`) so `createEffect` can react when the node mounts.

## Reactivity

- `createSignal`, `createMemo`, `createEffect`, `Show`, `For`, `Switch`/`Match`, `Loading`, `Errored`, `onCleanup` from `solid-js`; `render` from `@solidjs/web`.
- Pass reactive inputs as plain props in JSX: `focused={focusedId() === id}` — Solid tracks signal reads at the call site. Reserve function props for callbacks.
- **Do not read `props` or signals in imperative code** (`For` map bodies, `if` branches before `return`, helper calls). Use JSX expressions, `createMemo`, or a child component whose template reads props.
- **Do not write signals in `createEffect` apply** — derive with `createMemo`; scene-driven reset uses **function-form** `createSignal(() => …)` (writable memo).
- **A memo that returns JSX owns child identity.** If it re-runs, children remount (camera / selection / local signals die). Branch on a **stable** derived value (e.g. `sceneKind` memo of `scene().kind`), then read the changing props in JSX (`scene={scene()}`) so they compile to getters on the _existing_ instance. Host.tsx's `pane` memo does exactly this.
- **`<Loading>` / `<Errored>` do not remount** just because an async memo re-ran. Fallback only when the memo has no resolved value / throws.
- Cross-pane handles are plain imperative mutation (`sceneCache`, `Map`s) driven by memo/effect; HMR bumps a `sceneRev` signal.

### `createEffect` (Solid 2)

**Not 1.x.** Single-callback `createEffect(() => { … })` is invalid. Use the **compute / effect** split:

- **`compute`** — all reactive reads (`props`, signals, memos) happen here; returns a **stable** value (string/number/tuple of primitives). `onCleanup` is registered here.
- **`effect`** — receives `(value, prevValue)` from compute only. **Do not read `props`, signals, or memos here.** Do not write Solid signals here. DOM / `document.title` / listeners / measured layout only. **Return** the cleanup (do not call `onCleanup` in the effect).

```tsx
// ✅ window listener: mount-stable compute, cleanup returned from effect
createEffect(
  () => 1,
  () => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  },
);

// ✅ ResizeObserver on a signal ref
createEffect(
  () => paneEl(),
  (el) => {
    if (!el) return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  },
);

// ❌ onSettled — forbidden
```

## Styling

- **CSS modules** per component: colocated `Component.module.css` imported as `styles`. Ambient typing: `packages/oblik/src/css-modules.d.ts` (`*.css` → `Record<string, string>`).
- Design tokens: `packages/oblik/src/theme.css`, imported once from `host/Host.tsx` (`import "../theme.css"`). Use `--oblik-*` vars from `:root` (paper/knockout/cream, accent, ink, chrome halo widths, strokes). Halo metrics live in `docs/chrome.md` (repo root).
- Flex/grid children that should fill height need `min-height: 0`. Panes and views are `display: flex; flex-direction: column` with the interactive surface as the `flex: 1` child.
- Icons: `import IconX from "~icons/lucide/x";` (unplugin-icons, lucide set). Ambient typing: `packages/oblik/src/icons.d.ts`.

## Paths & imports

- Within `packages/oblik`: prefer relative imports; `@/` → `packages/oblik/src/` also works (oblik tsconfig paths, oblik vitest alias, and `apps/demo` tsconfig/vite alias all map it).
- Cross-package (demo app → runtime): import the oblik subpath exports `oblik`, `oblik/host` (`mountOblik`), `oblik/euclid2`, `oblik/plugin` — see `packages/oblik/package.json`.

## Adding a component

1. Create `packages/oblik/src/<area>/MyThing.tsx` + `MyThing.module.css` (colocated).
2. Import it in the pane that owns that area (euclid2 Pane/View, figure Pane, host Host), or export from that area's `index.ts` when it is part of the public API.
3. Use `class={[styles.base, { [styles.active]: cond }]}` and `--oblik-*` tokens.
4. If the scene kind must render it, branch in `Host`'s `pane` memo on `sceneKind()`.

## Testing

- Vitest colocated next to source: `Component.test.ts(x)` in `packages/oblik/src`, run with `pnpm --filter oblik test`. Test environment is `node` — prefer testing pure helpers exported from view modules over mounting components.
- Scene programs are exercised headlessly: `packages/oblik/src/eval/demo-scenes.test.ts` evaluates `apps/demo` scene modules.
- `packages/oblik/src/solid-conventions.test.ts` greps the tree for banned patterns (e.g. `onSettled`, non-null-asserted live nodes).

## Checklist

- [ ] `class` arrays/objects, not `classList` or template strings
- [ ] `createEffect` — reactive reads in `compute` only; cleanup returned from the effect function; no `onSettled`
- [ ] Async memos register `onCleanup` before `await`
- [ ] `min-height: 0` on flex/grid children that should fill height
- [ ] Tokens from `theme.css`, not hard-coded colors
- [ ] No React, no SolidStart unless explicitly requested

## More detail

See [reference.md](reference.md) for the file map and integration notes. Mirrored to `.dsh/skills/solidjs/` for the DeepSeek Harness — keep both in sync.
