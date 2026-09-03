import type { Sdf } from "./tree";
import type { Sdf2 } from "./tree2";


const { max } = Math;
export type SdfUniform =
  | { name: string; kind: "f"; value: number }
  | { name: string; kind: "v2"; value: [number, number] }
  | { name: string; kind: "v3"; value: [number, number, number] };

export type CompiledSdf = {
  /** GLSL expression: map(p) uses this as `return <expr>;` */
  expr: string;
  /** GLSL expression: map2(q) 2D profile, or a far plane if unused. */
  map2: string;
  uniforms: SdfUniform[];
};

/**
 * Compile an SDF tree to a GLSL `map` expression.
 * Numbers live in uniforms so a drag does not recompile the shader
 * unless the tree shape changes.
 */
export function compileSdf(sdf: Sdf): CompiledSdf {
  const uniforms: SdfUniform[] = [];
  let n = 0;
  const u = (kind: SdfUniform["kind"], value: SdfUniform["value"]) => {
    const name = `u${n}`;
    n += 1;
    uniforms.push(
      kind === "f"
        ? { name, kind: "f", value: value as number }
        : kind === "v2"
          ? { name, kind: "v2", value: value as [number, number] }
          : { name, kind: "v3", value: value as [number, number, number] },
    );
    return name;
  };

  let map2 = "1000.0";
  let mapped = false;

  const emit2 = (s: Sdf2): string => {
    switch (s.k) {
      case "circle": {
        const c = u("v2", [s.c.x, s.c.y]);
        const r = u("f", s.r);
        return `sdCircle(q - ${c}, ${r})`;
      }
      case "union":
        return `min(${emit2(s.a)}, ${emit2(s.b)})`;
      case "smoothUnion": {
        const k = u("f", max(s.ksoft, 1e-4));
        return `smin(${emit2(s.a)}, ${emit2(s.b)}, ${k})`;
      }
    }
  };

  const emit = (s: Sdf): string => {
    switch (s.k) {
      case "sphere": {
        const c = u("v3", [s.c.x, s.c.y, s.c.z]);
        const r = u("f", s.r);
        return `sdSphere(p - ${c}, ${r})`;
      }
      case "box": {
        const c = u("v3", [s.c.x, s.c.y, s.c.z]);
        const h = u("v3", [s.half.x, s.half.y, s.half.z]);
        return `sdBox(p - ${c}, ${h})`;
      }
      case "cylinder": {
        const c = u("v3", [s.c.x, s.c.y, s.c.z]);
        const r = u("f", s.r);
        const h = u("f", s.halfH);
        return `sdCappedCylinder(p - ${c}, ${h}, ${r})`;
      }
      case "capsule": {
        const a = u("v3", [s.a.x, s.a.y, s.a.z]);
        const b = u("v3", [s.b.x, s.b.y, s.b.z]);
        const r = u("f", s.r);
        return `sdCapsule(p, ${a}, ${b}, ${r})`;
      }
      case "torus": {
        const c = u("v3", [s.c.x, s.c.y, s.c.z]);
        const R = u("f", s.R);
        const r = u("f", s.r);
        return `sdTorus(p - ${c}, vec2(${R}, ${r}))`;
      }
      case "sweep2": {
        if (!mapped) {
          map2 = emit2(s.profile);
          mapped = true;
        }
        const c = u("v2", [s.c.x, s.c.y]);
        const R = u("f", s.pathR);
        return `map2(vec2(length(p.xy - ${c}) - ${R}, p.z))`;
      }
      case "union":
        return `min(${emit(s.a)}, ${emit(s.b)})`;
      case "smoothUnion": {
        const k = u("f", max(s.ksoft, 1e-4));
        return `smin(${emit(s.a)}, ${emit(s.b)}, ${k})`;
      }
      case "diff":
        return `max(${emit(s.a)}, -(${emit(s.b)}))`;
      case "inter":
        return `max(${emit(s.a)}, ${emit(s.b)})`;
    }
  };

  return { expr: emit(sdf), map2, uniforms };
}

export function sdfMapSignature(compiled: CompiledSdf): string {
  return `${compiled.expr}\n${compiled.map2}`;
}
