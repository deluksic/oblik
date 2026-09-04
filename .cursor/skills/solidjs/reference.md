# SolidJS reference (this repo)

## File map

```
packages/oblik/src/
  theme.css               # reset + :root --oblik-* tokens; imported by host/Host.tsx
  css-modules.d.ts        # *.css → Record<string,string> ambient typing
  icons.d.ts              # ~icons/* ambient typing (unplugin-icons, Solid 2)

  host/                   # app chrome (Solid)
    Host.tsx              # mountOblik(el, opts) → render(<StoredSignalsProvider><Modal><Host/></Modal></StoredSignalsProvider>);
                          #   scene cache, sceneRev HMR signal, pane memo branches on kind;
                          #   welcome stage (no ?scene=) vs scene stage
    Host.module.css
    TitleBar.tsx          # oblik › scene breadcrumb, scene-switcher menu, muted version, settings gear
    Welcome.tsx           # no-scene picker: searchable scene list with kind icons
    SettingsModal.tsx     # about (version) + reset all local data (two-step confirm, stays open)
    ResizableSidebar.tsx  # stored-width sidebar slot + drag sash (createDragHandler)
    resizable.ts          # pure: SIDEBAR_* constants + clampSidebarWidth (node-testable)
    StoredSignalsContext.tsx / stored-signals.ts   # Context registry of localStorage signals
    SelectionSidebar.tsx  # scope / selection detail (origin file, mentions)
    selection-detail.ts   # pure: scope pick → detail rows
    routing.ts            # currentSceneId / openScene / openWelcome (URL ?scene=, pushState)
    scene-hot.ts          # registerSceneHot — module HMR bridge into the pane cache

  euclid2/                # 2D construction scenes (Solid chrome + SVG view)
    Pane.tsx              # Euclid2Pane: eval/draft/commit wiring, tools, SelectionSidebar
    Palette.tsx           # Space tool palette
    tool.ts, tools/*      # Space verbs (point, circle, line, segment, parallelLine,
                          #   perpendicularLine, fillet, region, roundOffset, slider, length, …)
    pick.ts               # hit testing / ranks
    camera.ts             # NDC viewBox transform (y-up)
    view/                 # View.tsx, Ink.tsx (fills+strokes), FillFace.tsx, RegionInk.tsx,
                          #   Hud.tsx, Grid.tsx, Ghost.tsx, sliderHud.ts, NumberSliders.tsx,
                          #   pointer.ts, createDragHandler.ts, marks.ts, pointMark.ts,
                          #   chrome.ts + chrome-metrics.ts (halo bands), ChromeBand/ChromeClip

  figure/                 # P9 figure (paint) scenes (Solid chrome + SVG)
    Pane.tsx, View.tsx, Palette.tsx, Ink.tsx, BrushDock.tsx,
    FrameEditor.tsx, ExportModal.tsx
    frame.ts, chips.ts, export.ts, pick.ts, tools.ts   # pure logic colocated

  modal/                  # Modal host: Modal.tsx (native <dialog> layer, click-off dismiss),
                          #   ModalContext.ts (useRequestModal), ModalTitleBar.tsx
  source/                 # Vite plugin (vite-plugin.ts) + catalog/analyze/stamp/hoist/insert/patch
  eval/, geom/            # pure TS — the tape model, region/polygon/CSG geometry (no Solid)
```

`apps/demo/` — the runnable app. `src/main.tsx` mounts oblik and owns HMR.

## Mount chain

```tsx
// apps/demo/src/main.tsx
import { mountOblik } from "oblik/host";

const host = mountOblik({
  el: document.getElementById("app")!,
  scenes: initialScenes, // virtual:oblik-catalog
  loaders: sceneLoaders, // ./scene-loaders
  annotations: initialAnnotations, // virtual:oblik-annotations
  mentions: initialMentions,
  collisions: initialCollisions,
});
```

`mountOblik` returns `{ setScenes, setLoaders, setAnnotations, setMentions, setCollisions }`; `main.tsx` calls them from `import.meta.hot.accept(["virtual:oblik-catalog", "virtual:oblik-annotations", "./scene-loaders"], …)`.

Inside `Host`, `entry` memo finds the catalog row by id; `loaded` is an async memo that caches `Scene` per file (`sceneCache`) and reads `sceneRev()` so HMR re-evaluates; `sceneKind` (`"euclid2" | "figure"`) is the **stable** branch for the `pane` memo, which returns `Euclid2Pane` / `FigurePane`. Scene file HMR flows through `registerSceneHot` (an effect with mount-stable compute `() => true`) which mutates `sceneCache` and bumps `sceneRev`.

## Height chain

Flex/grid children need `min-height: 0` to fill:

- `#app` / `.shell` — `height: 100%`, column layout, `overflow: hidden` (index.html inline styles set `html, body, #app { height: 100% }`)
- pane / view modules use `display: flex; flex-direction: column` with the interactive surface (`flex: 1`) and fixed footers (`flex: 0 0 …`)

If a canvas or list stops filling, the first suspect is a missing `min-height: 0` on the flex child.

## Palette / tools

Space verbs are objects in `euclid2/tool.ts` + `tools/*`. Each verb owns click, ghost, preview, Tab fields, Enter. `Palette.tsx` routes them. There is no imperative host session: panes only route keys; `toolSession` state lives in `Euclid2Pane`/`View`.

## Drag / pointer glue

`euclid2/view/pointer.ts` + `createDragHandler.ts` own pointer capture, hover, click-vs-drag, and per-handle drag sessions that call `onDraft` / `onCommit` (scene literal write-back on release). Camera NDC `viewBox` math lives in `camera.ts` — handles move by relative Δ. Sashes reuse the same `createDragHandler`: record `startX`/`startWidth` in `drag.start(...)`, then persist `clampSidebarWidth(startW - (ev.clientX - startX))` on every move (`host/ResizableSidebar.tsx`).

## Testing

- Pure logic colocated: `*.test.ts` next to the source (vitest, `environment: "node"` — see `packages/oblik/vitest.config.ts`). The node env does **not** compile `.tsx`: keep tested logic in `.ts` modules (e.g. `host/stored-signals.ts` with a fake `StorageLike`, `host/resizable.ts`) and never import a `.tsx` component from a test.
- View modules export pure helpers for tests (`figure/Ink.test.ts`, `figure/chips.test.ts`, `euclid2/pick.test.ts`, `geom/*.test.ts`, …).
- `eval/demo-scenes.test.ts` imports and evaluates the real `apps/demo` scenes headlessly — scene edits can break these tests.
- Conventions are enforced by `solid-conventions.test.ts` (no `onSettled`, no `node={…()!}`).

## Versions (pin together)

```json
"solid-js": "2.0.0-rc.0",
"@solidjs/web": "2.0.0-rc.0",
"@solidjs/vite-plugin": "3.0.0-next.31",
"vite": "^8.2.0"
```

`oblik` and `oblik-demo` both carry the solid pins (`packages/oblik/package.json`, `apps/demo/package.json`).

## `createEffect` cleanup rules (Solid 2)

| Where                      | Cleanup mechanism                    |
| -------------------------- | ------------------------------------ |
| `createEffect` **compute** | `onCleanup(fn)`                      |
| `createEffect` **effect**  | `return fn` from the effect function |

`onSettled` is **forbidden** (oxlint `no-restricted-imports` + `solid-conventions.test.ts`) — use `createEffect` with a signal ref instead.

The effect function is the apply phase — `onCleanup` registered there is ignored. **Never read `props`, signals, or memos in the effect callback.** Read them in `compute` and capture (or snapshot) the values there:

```tsx
function onKeydown(e: KeyboardEvent) {
  if (mode() === "picker") {
    /* reads signals at event time — fine */
  }
}

createEffect(
  () => 1,
  () => {
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  },
);
```

## Docs

- Chrome/halo metrics: `docs/chrome.md` (repo root)
- Solid 2 traps and codebase patterns live **in this skill** (SKILL.md "Reactivity" / "Lifecycle & DOM" / "Linting" + reference sections) — agent guidance belongs here, not in prototype docs.
- `docs/prototypes/*.md` are prototype history and product decisions, not agent-facing notes.
