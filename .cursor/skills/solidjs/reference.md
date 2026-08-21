# SolidJS reference (this repo)

## File map

```
packages/shell/src/
  workspace.tsx          # render(() => <App />, mount)
  workspace-model.ts     # URL, catalog, createScene (pure TS)
  push-guards.ts         # commandBarSnapshotKey, inspectSnapshotKey
  palette.ts             # filterCommands only (no DOM)
  types.ts               # InspectState, PaneContext, WorkspaceProps
  ui/
    App.tsx              # scene state, keyboard, grid layout
    Nav.tsx
    Welcome.tsx
    Viewport.module.css
    Pane.tsx             # onSettled host mount
    Inspect.tsx
    Palette.tsx
```

## Height chain (viewport)

Flex/grid children need `min-height: 0` and a defined row height:

- `#workspace { grid-template-rows: minmax(0, 1fr); }`
- `#viewport` / `.viewport` — flex column, `overflow: hidden`
- `.viewportGrid` — `flex: 1; min-height: 0`
- `.pane` — `height: 100%; display: flex; flex-direction: column`

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

Hosts call `ctx.onInspect?.(patch)`. Shell merges into a signal; only the focused pane's patches apply.

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

## Testing

- Pure logic: vitest in `packages/shell/src/*.test.ts` (e.g. `palette.test.ts`)
- UI components: prefer testing pure helpers; Solid component tests only when behavior warrants `solid-js` test utils

## Versions (pin together)

```json
"solid-js": "2.0.0-rc.0",
"@solidjs/web": "2.0.0-rc.0",
"@solidjs/vite-plugin": "^3.0.0-next.28"
```
