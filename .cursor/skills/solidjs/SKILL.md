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

| Solid (UI)                         | Vanilla TS (keep as-is)                                |
| ---------------------------------- | ------------------------------------------------------ |
| `packages/shell/src/ui/*`          | `packages/hosts/src/paper2.ts`, `paper3.ts`            |
| `packages/shell/src/workspace.tsx` | geometry packages, `editor/*`, `plugin/vite-plugin.ts` |

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
- Pass reactive inputs as plain props in JSX: `focused={focusedId() === id}` — Solid tracks signal reads at the call site. Reserve function props for callbacks and stable local readers (`commands` in `Pane`).
- **Do not read `props` or signals in imperative code** (`For` map bodies, `if` branches before `return`, helper calls). Use JSX expressions, `createMemo`, or a child component whose template reads props.
- **Do not write signals in `createEffect` apply** — derive with `createMemo`; scene-driven reset uses **function-form** `createSignal(() => …)` (writable memo).
- **Async data** — `createMemo(() => loader())`; read it under `<Loading>`. Rejected loads → `<Errored>`.
- **`onSettled` cannot read pending async** (throws `PENDING_ASYNC_FORBIDDEN_SCOPE`). If the owner tree has an async memo (pane loaders), window listeners and host `mount()` go in **`createEffect`**, whose compute is async-aware. `onSettled` is only for purely sync DOM after layout.
- **Host callbacks that write shell state** (`onCommandBar`, `onInspect`, `onLiveChange`) must not run the setter inside effect apply. If `getOwner()` is set, `queueMicrotask` the call. Pointer/DOM handlers have no owner and stay synchronous.
- **Imperative cross-pane refs** (e.g. `handles` `Map` for `refreshOthers`) — plain mutation, no signal bump; palette commands stay **pane-local** via an `ownedWrite` handle signal.
- Internal imports use `@/` → `packages/shell/src/` (e.g. `@/types`, `@/ui/App`). Colocated `.module.css` stays relative.

```tsx
// ❌ imperative props read inside <For> callback
<For each={props.paneIds}>
  {(id) => {
    const slot = resolvePaneSlot(id, props.catalog.get(id), …);
    return <Pane mount={slot.mount} />;
  }}
</For>

// ✅ child component + <Errored>, resolve in JSX (throws → PaneError fallback)
<For each={props.paneIds}>
  {(id) => (
    <Errored fallback={(err) => <PaneError {...paneResolveFallback(err(), id)} />}>
      <Pane mount={resolvePaneSlot(id, props.catalog.get(id), …)} />
    </Errored>
  )}
</For>
```

### `createEffect` (Solid 2)

**Not 1.x.** Single-callback `createEffect(() => { … })` is invalid. Use the **compute / effect** split:

```tsx
createEffect(
  () => {
    const id = sceneId();
    return id == null ? null : { id, title: catalog().get(id)?.title ?? id };
  },
  (row) => {
    if (!row) return;
    document.title = `euclid — ${row.title}`; // DOM side effect — not a signal write
  },
);
```

Scene-driven **signal** resets: function-form `createSignal(() => inspectForScene(sceneId(), …))` — not an effect that writes, not a call in the component body.

- **`compute`** — all reactive reads (`props`, signals, memos) happen here; returns a **stable** value (string/number/tuple of primitives).
- **`effect`** — receives `(value, prevValue)` from compute only. **Do not read `props`, signals, or memos here.** Do not write Solid signals here. DOM / `document.title` / measured layout only.
- **`onCleanup` only works inside `compute`**, not in the effect function.
- **The effect function must `return` its cleanup** (do not call `onCleanup` in the effect).

```tsx
// ✅ window listener: onSettled, not createEffect
onSettled(() => {
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
});

// ❌ dummy effect for the same job
createEffect(() => void 0, () => { window.addEventListener(…); });
```

## Styling

- **CSS modules** per component: `Component.module.css` imported as `styles`
- Global app chrome tokens stay in `apps/paper/src/style.css` (`:root`, `#app`, `#workspace`, `#viewport`)

## Host boundary (shell ↔ hosts)

Hosts push state; Solid renders it. No raw DOM refs in `PaneContext`.

```ts
// types.ts
onInspect?: (patch: InspectPatch) => void;
onCommandBar?: (state: CommandBarState | null) => void;
```

Gate pushes in hosts with `inspectSnapshotKey` / `commandBarSnapshotKey` (`ui/workspace/push-guards.ts`) so rAF loops do not spam the UI.

## Palette pattern

Modes as signals: `"closed" | "picker" | "prompt"`. `filterCommands` stays pure TS in `palette/filter.ts`.

## Adding a component

1. Create `packages/shell/src/ui/MyThing.tsx` + `MyThing.module.css`
2. Import into `App.tsx` (or parent)
3. Use `class={[styles.base, { [styles.active]: cond }]}`
4. Export types from `types.ts` only when crossing package boundaries

## Checklist

- [ ] `class` arrays/objects, not `classList` or template strings
- [ ] `createEffect` — reactive reads in `compute` only; effect uses captured args / snapshots
- [ ] `min-height: 0` on flex/grid children that should fill height
- [ ] Pane uses `display: flex; flex-direction: column` so canvas `flex: 1` works
- [ ] No React, no SolidStart unless explicitly requested

## More detail

See [reference.md](reference.md) for file map and push-model notes.
