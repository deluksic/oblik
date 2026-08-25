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

- **`createEffect` (compute / effect)** — subscriptions, window listeners, `ResizeObserver`, focus. **Do not use `onSettled`** — it is forbidden in this repo (oxlint + vitest).
- **Async resource in `createMemo`** — register `onCleanup` **before** the first `await`. If the memo re-runs while awaiting, cleanup still runs.

```tsx
const handle = createMemo(async () => {
  let current: PaneHandle | null = null;
  onCleanup(() => current?.dispose());
  const mod = await mount.loader();
  current = mount.host.mount(canvas, mod, ctx);
  return current;
});
```

Read under `<Loading>`; rejected loads → `<Errored>`. `host.mount()` → `render()` calls `onInspect` (and sometimes `onCommandBar`) while the async memo is still owned — wrap those two in `runWithOwner(null, …)`. `onFocus` / `onLiveChange` / `onHandle` do not write signals from that path.

- **Refs** — use signal refs (`const [el, setEl] = createSignal<HTMLDivElement | null>(null)` + `ref={setEl}`) so `createEffect` can react when the node mounts.

## Reactivity

- `createSignal`, `createMemo`, `createEffect`, `Show`, `For` from `solid-js`
- Pass reactive inputs as plain props in JSX: `focused={focusedId() === id}` — Solid tracks signal reads at the call site. Reserve function props for callbacks and stable local readers (`commands` in `Pane`).
- **Do not read `props` or signals in imperative code** (`For` map bodies, `if` branches before `return`, helper calls). Use JSX expressions, `createMemo`, or a child component whose template reads props.
- **Do not write signals in `createEffect` apply** — derive with `createMemo`; scene-driven reset uses **function-form** `createSignal(() => …)` (writable memo).
- **A memo that returns JSX owns child identity.** If it re-runs, children remount (camera / selection / local signals die). Branch on a **stable** derived value (e.g. `sceneKind` memo of `scene().kind`). Put updating props in JSX (`scene={scene()}`) so they compile to getters on the *existing* instance. Do **not** read `scene()` in that memo’s JS just to pick a kind.
- **`<Loading>` does not remount** because an async memo re-ran. Fallback only when that memo has no resolved value yet. Do not replace an async `createMemo` with an effect that writes a signal.
- **Imperative cross-pane refs** (e.g. `handles` `Map` for `refreshOthers`) — plain mutation; palette commands come from the pane’s async handle memo.
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
// ✅ window listener: createEffect with mount-stable compute
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
