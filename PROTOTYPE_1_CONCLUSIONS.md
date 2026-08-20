# Prototype 1 — conclusions

Built a 2D paper preview: pure library geometry, scene-only widgets, hover/select with identity, drag writes scene literals on pointer-up.

## Pass

- Library code in `apps/paper/src/demo/` has no widget or preview imports.
- Scene files contain explicit `edit*` calls; pointer-up rewrites those literals.
- Hover/select highlights the clicked drawable. `id` is a UUID (pick key); `path` is a human breadcrumb.
- Jump-to-source uses stack provenance (library line for `line()` inside a loop, not the draw loop).
- Last-good-frame on scene throw.

## What failed (usefully)

**String ids as pick keys.** Kind+index (`line[0]`) is a display path, not identity. Two trusses without `group()` still pick correctly once `id` is a UUID. Groups must stay optional.

**Provenance is the call site, not the instance.** Every tick in a library `for` still jumps to the same `beam.ts` line. Distinguishing instances needs an instance counter (or loop index) on provenance — not done.

**Widget writes are order-coupled.** Evaluation index must match AST order. `edit*` inside a helper called twice (`truss()`) produced 16 gizmos and 10 call sites — wrong literals, then missing widgets. Unroll scene widgets. Browser stacks also attributed calls to the import line, so write-back must not use stack line/column.

**Widget args must be numeric literals.** `editPoint(a.x + 2.4, a.y + 1.05)` previews (overrides are in memory) but pointer-up fails: the patcher can only replace numeric tokens. Relative / constrained handles are not expressible as scene widgets today — declare extra `editDistance*` literals and do the offset in a library function instead. See `?scene=relative`.

**Path counters drift.** Adding a ring upstream renames later `line[12]` → `line[14]`. Fine for a breadcrumb; not a stable bind key. A polar array whose **count** is a widget also drops stale picks (UUIDs die when N shrinks); the shell now clears selection when the id is gone.

## Do not

- Put gizmos in domain libraries.
- Use `group()` to paper over pick bugs.
- Infer handles from unmarked numbers.
- Treat stack `file:line` as a write address (Vite lies).

## Next (P2 candidates)

- Instance-aware provenance (`file:line` + occurrence this frame).
- A second scene type / app looking at the same `mark` (or a PNG artifact).
- Click-to-insert `edit*` as a code action (still declared, not inferred).
- Widgets whose degrees of freedom are expressions or constraints (offset from a corner), not only numeric literals.
