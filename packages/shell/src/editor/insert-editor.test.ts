import * as ts from "typescript";
import { expect, test } from "vitest";

import {
  applyScenePatch,
  bindLineAt,
  bindingNameError,
  distanceOriginName,
  evalDerivedScenePoints,
  evalSceneLines,
  insertEditors,
  isBindingName,
  namedSceneLineBindings,
  namedScenePointNear,
  nextBindingName,
  promoteInlineLineBinding,
  resolveLineBindingName,
  widgetBindingName,
  widgetCallName,
  widgetInSceneFunction,
} from "./insert-editor";
import { injectSceneSites } from "./inject-sites";
import { collectEditCalls } from "./patch-widget";

function at(source: string, i = 0): { line: number; column: number } {
  const sf = ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const call = collectEditCalls(sf)[i];
  if (!call) throw new Error(`no writable call at ${i}`);
  const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
  return { line: pos.line + 1, column: pos.character + 1 };
}

const hello = `import { circle, point } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  const r = circle(c, 1);
  return circle(c, r);
}
`;

test("inserts point after existing scene widgets", () => {
  const next = insertEditors(hello, [{ kind: "point", x: 1.25, y: -0.4 }]);
  expect(next).toMatch(/^  const p = point\(1\.25, -0\.4\);$/m);
  expect(next).toMatch(/^  return circle\(c, r\);$/m);
  expect(widgetBindingName(hello, at(hello, 0))).toBe("c");
  expect(widgetInSceneFunction(hello, at(hello, 0))).toBe(true);
});

test("stacked inserts keep two-space indent on every line", () => {
  const once = insertEditors(hello, [{ kind: "point", x: 1, y: 2 }]);
  const twice = insertEditors(once, [{ kind: "distance", originName: "p", d: 0.5 }]);
  expect(twice).toMatch(/const d = circle\(p, 0\.5\);/);
  const inner = twice.split("export function scene() {\n")[1]?.split("\n}")[0] ?? "";
  for (const line of inner.split("\n")) {
    if (!line.trim()) continue;
    expect(line.slice(0, 2), `bad indent: ${JSON.stringify(line)}`).toBe("  ");
    expect(line.slice(0, 4), `over-indented: ${JSON.stringify(line)}`).not.toBe("    ");
  }
});

test("inserts into scene() before return drawPlate", () => {
  const plate = `import { drawPlate } from "../demo/plate";
import { point } from "@design-scenes/geom";

export function plateLayout() {
  const min = point(-5, -3);
  return { min };
}

export function scene() {
  return drawPlate(plateLayout());
}
`;
  const next = insertEditors(plate, [{ kind: "point", x: 0, y: 1 }]);
  expect(next).toMatch(/const p = point\(0, 1\);/);
  expect(next).toMatch(/return drawPlate\(plateLayout\(\)\);/);
  expect(widgetInSceneFunction(plate, at(plate, 0))).toBe(false);
  expect(widgetBindingName(plate, at(plate, 0))).toBe("min");
});

test("point then distance in one write shares the new name", () => {
  const next = insertEditors(hello, [
    { kind: "point", x: 2, y: 1 },
    { kind: "distance", d: 0.75 },
  ]);
  expect(next).toMatch(/const p = point\(2, 1\);/);
  expect(next).toMatch(/const d = circle\(p, 0\.75\);/);
});

test("adds a named import when point is missing from geom", () => {
  const src = `import { circle } from "@design-scenes/geom";

export function scene() {
  return circle({ x: 0, y: 0 }, 1);
}
`;
  const next = insertEditors(src, [{ kind: "point", x: 0, y: 0 }]);
  expect(next).toMatch(/import \{ circle, point \} from "@design-scenes\/geom";/);
});

test("circle inserts as a statement", () => {
  const next = insertEditors(hello, [{ kind: "circle", center: { name: "c" }, radius: "r" }]);
  expect(next).toMatch(/^  circle\(c, r\);$/m);
  expect(next).toMatch(/^  return circle\(c, r\);$/m);
  expect(next).toMatch(/from "@design-scenes\/geom"/);
});

test("stacked circle adds another call", () => {
  const grouped = `import { circle } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  const r = circle(c, 1);
  circle(c, r);
}
`;
  const next = insertEditors(grouped, [{ kind: "circle", center: { name: "c" }, radius: "r" }]);
  expect(next.match(/circle\(c, r\);/g)?.length).toBe(2);
});

test("segment inserts as a statement", () => {
  const src = `import { circle } from "@design-scenes/geom";
import { point } from "@design-scenes/geom";

export function scene() {
  const a = point(0, 0);
  const b = point(1, 0);
  circle(a, 1);
}
`;
  const next = insertEditors(src, [{ kind: "segment", a: { name: "a" }, b: { name: "b" } }]);
  expect(next).toMatch(/^  segment\(a, b\);$/m);
  expect(next).toMatch(/^import \{ circle, segment \} from "@design-scenes\/geom";$/m);
});

test("rect inserts points, derived corners, and four segments", () => {
  const src = `export function scene() {}
`;
  const next = insertEditors(src, [
    { kind: "rect", a: { x: 0, y: 0 }, b: { x: 2, y: 1 } },
  ]);
  expect(next).toMatch(/const p = point\(0, 0\);/);
  expect(next).toMatch(/const p2 = point\(2, 1\);/);
  expect(next).toMatch(/const bl = point\(Math\.min\(p\.x, p2\.x\), Math\.min\(p\.y, p2\.y\)\);/);
  expect(next).toMatch(/const tr = point\(Math\.max\(p\.x, p2\.x\), Math\.max\(p\.y, p2\.y\)\);/);
  expect(next).toMatch(/const tl = point\(bl\.x, tr\.y\);/);
  expect(next).toMatch(/const br = point\(tr\.x, bl\.y\);/);
  expect(next).toMatch(/segment\(bl, tl\);/);
  expect(next).toMatch(/segment\(tl, tr\);/);
  expect(next).toMatch(/segment\(tr, br\);/);
  expect(next).toMatch(/segment\(br, bl\);/);
});

test("mixed editor and constructor inserts in one write", () => {
  const src = `import { circle } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  const r = circle(c, 1);
  return circle(c, r);
}
`;
  const next = insertEditors(src, [
    { kind: "point", x: 3, y: 4 },
    { kind: "segment", a: { name: "c" }, b: { name: "p" } },
  ]);
  expect(next).toMatch(/const p = point\(3, 4\);/);
  expect(next).toMatch(/segment\(c, p\);/);
});

test("multiple constructors append in one write", () => {
  const src = `import { point } from "@design-scenes/geom";

export function scene() {
  const a = point(0, 0);
  const b = point(1, 0);
  return a;
}
`;
  const next = insertEditors(src, [
    { kind: "segment", a: { name: "a" }, b: { name: "b" } },
    { kind: "infiniteLine", a: { name: "a" }, b: { name: "b" } },
  ]);
  expect(next).toMatch(/segment\(a, b\);/);
  expect(next).toMatch(/line\(a, b\);/);
});

test("distanceOriginName reads the first argument", () => {
  expect(distanceOriginName(hello, at(hello, 1))).toBe("c");
});

test("point insert before grouped return does not rebind __scene", () => {
  const src = `import { circle, group } from "@design-scenes/geom";
import { point } from "@design-scenes/geom";

export function scene() {
  const a = point(0, 0);
  const __scene = circle(a, 1);
  return group(() => [__scene, circle(a, 1)]);
}
`;
  const next = insertEditors(src, [{ kind: "point", x: -1, y: 2 }]);
  expect(next.match(/const __scene = /g)?.length).toBe(1);
  expect(next).toMatch(/^  const p = point\(-1, 2\);$/m);
  expect(next).toMatch(/^  return group\(\(\) => \[__scene, circle\(a, 1\)\]\);$/m);
});

test("namedScenePointNear matches a derived point()", () => {
  const src = `import { point } from "@design-scenes/geom";
import { vector } from "@design-scenes/euclid2";

export function scene() {
  const a = point(1, 1);
  const d = vector(a, 1, 2);
  const b = point(a.x + d.x, a.y + d.y);
  return point(0, 0);
}
`;
  const known = [
    { name: "a", x: 1, y: 1 },
    { name: "d", x: 1, y: 2 },
  ];
  const derived = evalDerivedScenePoints(src, known);
  expect(derived).toEqual([{ name: "b", x: 2, y: 3 }]);
  expect(namedScenePointNear(src, 2.02, 2.97, [...known, ...derived], 0.25)?.name).toBe("b");
});

test("evalDerivedScenePoints resolves lineIntersection from scene lines", () => {
  const src = `import { line, segment } from "@design-scenes/geom";
import { point } from "@design-scenes/geom";

export function scene() {
  const a = point(0, 0);
  const b = point(2, 0);
  const c = point(0, 2);
  const h = segment(a, b);
  const v = line(a, c);
  const x = lineIntersection(h, v);
  return x;
}
`;
  const known = [
    { name: "a", x: 0, y: 0 },
    { name: "b", x: 2, y: 0 },
    { name: "c", x: 0, y: 2 },
  ];
  const derived = evalDerivedScenePoints(src, known);
  expect(derived).toEqual([{ name: "x", x: 0, y: 0 }]);
  expect(namedSceneLineBindings(src).get("h")).toBe("segment");
  expect(namedSceneLineBindings(src).get("v")).toBe("line");
  const env = new Map(known.map((k) => [k.name, { x: k.x, y: k.y }]));
  expect(resolveLineBindingName(src, { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, env)).toBe("h");
  expect(evalSceneLines(src, env).map((l) => l.name)).toEqual(["h", "v"]);
});

test("promoteInlineLineBinding hoists group-return segment to const", () => {
  const src = `import { circle, group, segment } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  const p = point(5, 0);
  const r = circle(c, 1);
  const __scene = circle(c, r);
  return group(() => [__scene, segment(c, p)]);
}
`;
  const env = new Map([
    ["c", { x: 0, y: 0 }],
    ["p", { x: 5, y: 0 }],
  ]);
  const match = (line: { a?: { x: number; y: number }; b?: { x: number; y: number } }) =>
    line.a?.x === 0 && line.a?.y === 0 && line.b?.x === 5 && line.b?.y === 0;
  const promoted = promoteInlineLineBinding(src, match, env);
  expect(promoted?.name).toBe("s");
  expect(promoted?.source).toMatch(/const s = segment\(c, p\);/);
  expect(promoted?.source).toMatch(/return group\(\(\) => \[__scene, s\]\);/);
});

test("promoteInlineLineBinding works for rect edges with derived point() corners", () => {
  const src = `import { circle, group, segment, point } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  const r = circle(c, 2.87);
  const __scene = circle(c, r);
  const p = point(5, 2.96);
  const bl = point(Math.min(c.x, p.x), Math.min(c.y, p.y));
  const tr = point(Math.max(c.x, p.x), Math.max(c.y, p.y));
  const tl = point(bl.x, tr.y);
  const br = point(tr.x, bl.y);
  const p2 = point(0.02, 2.95);
  return group(() => [__scene, segment(c, p), segment(bl, tl), segment(tl, tr), segment(tr, br), segment(br, bl), segment(c, p2)]);
}
`;
  const known = [
    { name: "c", x: 0, y: 0 },
    { name: "p", x: 5, y: 2.96 },
    { name: "p2", x: 0.02, y: 2.95 },
  ];
  const env = new Map(
    [...known, ...evalDerivedScenePoints(src, known)].map((k) => [k.name, { x: k.x, y: k.y }]),
  );
  const promoted = promoteInlineLineBinding(
    src,
    (line) =>
      line.a?.x === 0 &&
      line.a?.y === 0 &&
      line.b?.x === 5 &&
      Math.abs(line.b.y - 2.96) < 0.01,
    env,
  );
  expect(promoted?.name).toBe("s");
});

test("bindLineAt hoists inline segment at injected construction site", () => {
  const src = `import { group, segment } from "@design-scenes/geom";
import { point } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  const p = point(5, 0);
  return group(() => [segment(c, p)]);
}
`;
  const injected = injectSceneSites(src, "apps/paper/src/scenes/plate.scene.ts");
  const m = injected.match(
    /segment\(c, p, \{ __annotations__: \{ file: .+, at: \[(\d+), (\d+)\], editable: false \} \}/,
  );
  expect(m).toBeTruthy();
  const bound = bindLineAt(src, { line: Number(m![1]), column: Number(m![2]) });
  expect(bound?.name).toBe("s");
  expect(bound?.source).toMatch(/const s = segment\(c, p\);/);
  const next = applyScenePatch(src, {
    hoistAt: [{ line: Number(m![1]), column: Number(m![2]) }],
    imports: { "@design-scenes/geom": ["offsetLine"] },
    statements: ["const off = offsetLine(s, 1.2);"],
  });
  expect(next).toMatch(/const s = segment\(c, p\);/);
  expect(next).toMatch(/const off = offsetLine\(s, 1\.2\);/);
});

test("bindLineAt hoists a line() statement in a void scene", () => {
  const src = `import { line } from "@design-scenes/geom";
import { point } from "@design-scenes/geom";

export function scene() {
  const a = point(0, 0);
  const b = point(1, 0);
  line(a, b);
}
`;
  const injected = injectSceneSites(src, "apps/paper/src/scenes/new-scene.scene.ts");
  const m = injected.match(
    /line\(a, b, \{ __annotations__: \{ file: .+, at: \[(\d+), (\d+)\], editable: false \} \}/,
  );
  expect(m).toBeTruthy();
  const bound = bindLineAt(src, { line: Number(m![1]), column: Number(m![2]) });
  expect(bound?.name).toBe("l");
  expect(bound?.source).toMatch(/const l = line\(a, b\);/);
  expect(bound?.source).not.toMatch(/^\s+line\(a, b\);$/m);
});

test("applyScenePatch inserts statements and geom imports", () => {
  const src = `import { point } from "@design-scenes/geom";

export function scene() {
  const c = point(0, 0);
  return c;
}
`;
  const next = applyScenePatch(src, {
    imports: {
      "@design-scenes/geom": ["circle"],
    },
    statements: ["const d = circle(c, 1.5);"],
  });
  expect(next).toMatch(/circle/);
  expect(next).toMatch(/const d = circle\(c, 1\.5\);/);
});

test("applyScenePatch inserts constructor statements", () => {
  const src = `import { point } from "@design-scenes/geom";

export function scene() {
  const a = point(0, 0);
  const b = point(1, 0);
}
`;
  const next = applyScenePatch(src, {
    imports: { "@design-scenes/geom": ["line"] },
    exprs: ["line(a, b)"],
  });
  expect(next).toMatch(/line\(a, b\);/);
});

test("evalSceneLines accepts offsetLine numeric literals and .distance", () => {
  const src = `import { line, offsetLine, point } from "@design-scenes/geom";

export function scene() {
  const A = point(0, 0);
  const B = point(4, 0);
  const ground = line(A, B);
  const shelf = offsetLine(ground, 1.8);
  const cellar = offsetLine(ground, -shelf.distance);
}
`;
  const env = new Map([
    ["A", { x: 0, y: 0 }],
    ["B", { x: 4, y: 0 }],
  ]);
  const lines = evalSceneLines(src, env);
  expect(lines.map((l) => l.name)).toEqual(["ground", "shelf", "cellar"]);
  expect(lines[1]!.origin.y).toBeCloseTo(1.8);
  expect(lines[2]!.origin.y).toBeCloseTo(-1.8);
});

test("evalDerivedScenePoints resolves circleLineIntersection(+1)", () => {
  const src = `import { circle, circleLineIntersection, line, offsetLine, point } from "@design-scenes/geom";

export function scene() {
  const A = point(0, 0);
  const B = point(6, 0);
  const ground = line(A, B);
  const shelf = offsetLine(ground, 0);
  const reach = circle(A, 2.5);
  const P = circleLineIntersection(reach, shelf.line, +1);
}
`;
  const known = [
    { name: "A", x: 0, y: 0 },
    { name: "B", x: 6, y: 0 },
  ];
  const derived = evalDerivedScenePoints(src, known);
  const p = derived.find((d) => d.name === "P");
  expect(p?.x).toBeCloseTo(2.5);
  expect(p?.y).toBeCloseTo(0);
});

test("widgetBindingName names constructor and intersection consts", () => {
  const src = `export function scene() {
  const A = point(0, 0);
  const reach = circle(A, 2.5);
  const P = circleLineIntersection(reach, shelf.line, +1);
}
`;
  const loc = (name: string) => {
    const sf = ts.createSourceFile("s.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let call: ts.CallExpression | undefined;
    const visit = (node: ts.Node) => {
      if (
        !call &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name
      ) {
        call = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!call) throw new Error(name);
    const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    return { line: pos.line + 1, column: pos.character + 1 };
  };
  expect(widgetBindingName(src, loc("point"))).toBe("A");
  expect(widgetBindingName(src, loc("circle"))).toBe("reach");
  expect(widgetBindingName(src, loc("circleLineIntersection"))).toBe("P");
  expect(widgetCallName(src, loc("circle"))).toBe("circle");
  expect(widgetInSceneFunction(src, loc("circleLineIntersection"))).toBe(true);
});

test("bindingNameError rejects invalid identifiers but allows empty and valid names", () => {
  expect(bindingNameError(undefined)).toBeNull();
  expect(bindingNameError("")).toBeNull();
  expect(bindingNameError("  ")).toBeNull();
  expect(bindingNameError("shelf")).toBeNull();
  expect(bindingNameError("_a1")).toBeNull();
  expect(isBindingName("shelf")).toBe(true);

  expect(bindingNameError("my point")).not.toBeNull();
  expect(bindingNameError("1bad")).not.toBeNull();
  expect(bindingNameError("bad-name")).not.toBeNull();
});

test("nextBindingName disambiguates valid duplicate prefixes", () => {
  const src = `export function scene() {
  const p = point(0, 0);
  const p2 = point(1, 0);
}`;
  expect(nextBindingName(src, "p")).toBe("p3");
  expect(nextBindingName(src, "shelf")).toBe("shelf");
});
