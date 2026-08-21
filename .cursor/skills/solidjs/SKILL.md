---
name: solidjs
description: >-
  Solid 2 UI in this monorepo: shell chrome in packages/shell, Vite plugin,
  JSX/class conventions, lifecycle, and host boundaries. Use when editing
  .tsx under packages/shell, adding Solid components, wiring Vite/TS config,
  or when the user mentions Solid, SolidJS, solid-js, or @solidjs/web.
---

# SolidJS (this repo)

## Stack

- **Solid 2 RC**: `solid-js@2.0.0-rc.0`, `@solidjs/web@2.0.0-rc.0`
- **Vite**: `@solidjs/vite-plugin` in `apps/paper/vite.config.ts` (alongside `sceneDevPlugin`)
- **No SolidStart**, **no React** — do not use React hooks, `classList`, or React patterns
- **TS**: `jsx: "preserve"`, `jsxImportSource: "@solidjs/web"` in shell/paper tsconfigs

## Where Solid lives

| Solid (UI) | Vanilla TS (keep as-is) |
|---|---|
| `packages/shell/src/ui/*` | `packages/hosts/src/paper2.ts`, `paper3.ts` |
| `packages/shell/src/workspace.tsx` | geometry packages, `insert-editor.ts`, `vite-plugin.ts` |

Shell chrome: `App`, `Nav`, `Welcome`, `Viewport`, `Pane`, `Inspect`, `Palette`.
Mount via `startWorkspace(mount, props)` → `render(() => <App {...props} />, mount)`.

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

- **`onSettled`** — run after DOM is ready (replaces `onMount` for ref-dependent work). Return a cleanup.
- **Canvas / host mount** — Solid creates `<canvas>` via `ref`; mount the view host in `onSettled`; `dispose` on cleanup.
- **Refs** — prefer callback refs or `{ current: null as T | null }` if the linter flags unassigned `let` refs.

```tsx
onSettled(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;
  const handle = host.mount(canvas, mod, ctx);
  return () => handle.dispose();
});
```

## Reactivity

- `createSignal`, `createMemo`, `createEffect`, `Show`, `For` from `solid-js`
- Pass reactive inputs as accessors: `activeId: () => string | null`, not bare values when children must re-run
- `createEffect(compute, apply)` — two-arg form when tracking deps explicitly

## Styling

- **CSS modules** per component: `Component.module.css` imported as `styles`
- Global app chrome tokens stay in `apps/paper/src/style.css` (`:root`, `#app`, `#workspace`)
- Do not move canvas/view-pane rules back into global CSS unless shared across apps

## Host boundary (shell ↔ hosts)

Hosts push state; Solid renders it. No raw DOM refs in `PaneContext`.

```ts
// types.ts
onInspect?: (patch: InspectPatch) => void;
onCommandBar?: (state: CommandBarState | null) => void;
```

Gate pushes in hosts with `inspectSnapshotKey` / `commandBarSnapshotKey` (`push-guards.ts`) so rAF loops do not spam the UI.

## Palette pattern

Modes as signals: `"closed" | "picker" | "prompt"`. `filterCommands` stays pure TS in `palette.ts`.

## Adding a component

1. Create `packages/shell/src/ui/MyThing.tsx` + `MyThing.module.css`
2. Import into `App.tsx` (or parent)
3. Use `class={[styles.base, { [styles.active]: cond }]}`
4. Export types from `types.ts` only when crossing package boundaries

## Checklist

- [ ] `class` arrays/objects, not `classList` or template strings
- [ ] Host mount/dispose in `onSettled`, not before canvas exists
- [ ] `min-height: 0` on flex/grid children that should fill height
- [ ] Pane uses `display: flex; flex-direction: column` so canvas `flex: 1` works
- [ ] No React, no SolidStart unless explicitly requested

## More detail

See [reference.md](reference.md) for file map and push-model notes.
