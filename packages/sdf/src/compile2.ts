import type { Sdf2 } from "./tree2";


const { max } = Math;
export type Sdf2Uniform =
  | { name: string; kind: "f"; value: number }
  | { name: string; kind: "v2"; value: [number, number] };

export type CompiledSdf2 = {
  expr: string;
  uniforms: Sdf2Uniform[];
};

/** Compile a 2D SDF tree to a GLSL `map(q)` expression. */
export function compileSdf2(sdf: Sdf2): CompiledSdf2 {
  const uniforms: Sdf2Uniform[] = [];
  let n = 0;
  const u = (kind: Sdf2Uniform["kind"], value: Sdf2Uniform["value"]) => {
    const name = `u${n}`;
    n += 1;
    uniforms.push(
      kind === "f"
        ? { name, kind: "f", value: value as number }
        : { name, kind: "v2", value: value as [number, number] },
    );
    return name;
  };

  const emit = (s: Sdf2): string => {
    switch (s.k) {
      case "circle": {
        const c = u("v2", [s.c.x, s.c.y]);
        const r = u("f", s.r);
        return `sdCircle(q - ${c}, ${r})`;
      }
      case "union":
        return `min(${emit(s.a)}, ${emit(s.b)})`;
      case "smoothUnion": {
        const k = u("f", max(s.ksoft, 1e-4));
        return `smin(${emit(s.a)}, ${emit(s.b)}, ${k})`;
      }
    }
  };

  return { expr: emit(sdf), uniforms };
}

export function sdf2MapSignature(compiled: CompiledSdf2): string {
  return compiled.expr;
}
