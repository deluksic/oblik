# Critique (historical)

Written against an earlier plan: SDF-first CAD, literal-AST handles, resin as the kernel. [Intent](./intent.md) replaced it.

Why a few decisions stuck:

- Unmarked literals as gizmos fight composition → **declared `edit*` in scenes**.
- A Fusion replacement / true-distance SDF / built-in supports is too many products → **views and converters**.
- libfive / OpenSCAD / Zoo already occupy “code is the model” → **interop and identity**.
