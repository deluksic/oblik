# SolidJS reference (this repo)

## Package layout

```
packages/shell/src/
  index.ts              # public exports
  types.ts              # shared types
  workspace.tsx         # render(() => <App />, mount)

  ui/                   # Solid chrome
    App.tsx, Nav.tsx, Pane.tsx, …
    workspace/          # workspace UI logic (no components)
      constants.ts
      model.ts
      push-guards.ts
      resolve-pane-slot.ts

  palette/              # command palette (pure filter)
    filter.ts

  editor/               # AST insert/patch (vite + hosts)
    call-sites.ts       # one table: annotator dof, patch, binding names
    insert-editor.ts
    patch-widget.ts
    inject-sites.ts
    edit-names.ts       # re-exports EDIT_NAMES from call-sites

  catalog/              # scene catalog parsing + scaffolding
    catalog.ts
    new-scene.ts

  layout/               # CSS grid area helpers
    grid.ts

  hmr/                  # scene hot-reload helpers
    scene-hmr.ts

  plugin/               # Vite dev plugin
    vite-plugin.ts
```

## Height chain (viewport)

Flex/grid children need `min-height: 0` and a defined row height:

- `#workspace { grid-template-rows: minmax(0, 1fr); }`
- `#viewport` / `.viewport` — flex column, `overflow: hidden`
- `.viewportGrid` — `flex: 1; min-height: 0`
- `.pane` — `height: 100%; display: flex; flex-direction: column`
- `.view` — flex column, `flex: 1; min-height: 0`
- `.canvas` — `flex: 1; min-height: 0`
- `.status` — reserved `flex: 0 0 1.85rem` at the bottom of the pane (always present; error only restyles it)

Pane **must** have module classes applied via `class={[styles.pane, …]}` or flex layout breaks silently.

## Inspect push model

```ts
export type InspectState = {
  crumb: string;
  meta: string;
  sourceHtml: string;
  status: string;
  error: string | null;
};
export type InspectPatch = Partial<InspectState>;
```

Hosts call `ctx.onInspect?.(patch)`. Shell merges into a per-pane signal. The focused pane's patch feeds Identity in the inspect column. **Status and error render in a reserved strip at the bottom of that pane** — not a global banner — so a throw in one view does not shift the workspace or other canvases.

`packages/hosts/src/pane.ts` helpers take `InspectPush` instead of DOM elements:

- `showWidgetInspect(push, …)`
- `showEmptyInspect(push, …)`
- `setPaneStatus(push, status, error)`

## Command bar

Hosts call `ctx.onCommandBar(state | null)`. Shell opens palette prompt mode when state is non-null.

Compare snapshots before pushing; keep `onNumber` / `onNumberDraft` callbacks on the live object even when snapshot keys match (hosts gate on preview fields only).

## Vite entry

```ts
// apps/paper/src/main.ts
const app = document.querySelector("#app")!;
startWorkspace(app, { scenes, loaders, hosts });
```

`apps/paper/index.html` — single `<div id="app"></div>`.

Plugin import: `packages/shell/src/plugin/vite-plugin.ts`.

## Testing

- Pure logic: vitest next to source (`palette/filter.test.ts`, `ui/workspace/resolve-pane-slot.test.ts`, `editor/*.test.ts`)
- UI components: prefer testing pure helpers; Solid component tests only when behavior warrants test utils

## Versions (pin together)

```json
"solid-js": "2.0.0-rc.0",
"@solidjs/web": "2.0.0-rc.0",
"@solidjs/vite-plugin": "^3.0.0-next.28"
```

## `createEffect` cleanup rules (Solid 2)

| Where                          | Cleanup mechanism                               |
| ------------------------------ | ----------------------------------------------- |
| `createEffect` **compute**     | `onCleanup(fn)`                                 |
| `createEffect` **effect**      | `return fn` from the effect function            |
| `onSettled` callback           | `return fn` from the callback (not `onCleanup`) |
| `createTrackedEffect` callback | `return fn` from the callback (not `onCleanup`) |

The effect function is the apply phase — `onCleanup` registered there is ignored. Return a function instead.

**Never read `props`, signals, or memos in the effect callback.** Read them in `compute` and pass captured values (or a snapshot filled during compute) into the effect. Global keyboard handlers can live in a named function that reads signals at event time.

```tsx
function onWorkspaceKeydown(e: KeyboardEvent) {
  if (paletteMode() === "picker") {
    /* … */
  }
}

createEffect(
  () => void 0,
  () => {
    window.addEventListener("keydown", onWorkspaceKeydown);
    return () => window.removeEventListener("keydown", onWorkspaceKeydown);
  },
);
```

```tsx
// Pane host mount: snapshot during compute, stable string key
const mountSnap = { current: null as MountSnap | null };

createEffect(
  () => {
    const el = canvas();
    if (!el) {
      mountSnap.current = null;
      return null;
    }
    mountSnap.current = { el, mount: props.mount };
    return `${props.mount.id}\0${props.mount.entry.file}`;
  },
  (key) => {
    if (!key || !mountSnap.current) return;
    const { el, mount } = mountSnap.current;
    // … mount host, return dispose
  },
);
```
