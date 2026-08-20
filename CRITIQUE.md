# Critique (historical)

Written against an earlier plan (SDF-first CAD, literal-AST handles, resin as the kernel). That plan is superseded by [PLAN.md](./PLAN.md).

Kept because it still explains a few decisions:

- Unmarked literals as gizmos fight composition → **declared `edit*` in scenes**.
- A Fusion replacement / true-distance SDF / built-in supports is too many products → **views and converters**, not one kernel.
- libfive / OpenSCAD / Zoo already occupy “code is the model” → **interop and identity**, not another silo kernel.
