import { expect, test } from "vitest";
import * as ts from "typescript";
import {
  insertEditors,
  widgetBindingName,
  widgetInSceneFunction,
} from "./insert-editor.ts";
import { collectEditCalls } from "./patch-widget.ts";

function at(source: string, i = 0): { line: number; column: number } {
  const sf = ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const call = collectEditCalls(sf)[i];
  if (!call) throw new Error(`no edit* at ${i}`);
  const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
  return { line: pos.line + 1, column: pos.character + 1 };
}

const hello = `import { circle } from "@design-scenes/geom";
import { editDistanceToPoint, editPoint } from "@design-scenes/euclid2";

export function scene() {
  const c = editPoint(0, 0);
  const r = editDistanceToPoint(c, 1);
  return circle(c, r);
}
`;

test("inserts editPoint after existing scene widgets", () => {
  const next = insertEditors(hello, [{ kind: "point", x: 1.25, y: -0.4 }]);
  expect(next).toMatch(/^  const __scene = circle\(c, r\);$/m);
  expect(next).toMatch(/^  const p = editPoint\(1\.25, -0\.4\);$/m);
  expect(next).toMatch(/^  return __scene;$/m);
  expect(widgetBindingName(hello, at(hello, 0))).toBe("c");
  expect(widgetInSceneFunction(hello, at(hello, 0))).toBe(true);
});

test("stacked inserts keep two-space indent on every line", () => {
  const once = insertEditors(hello, [{ kind: "point", x: 1, y: 2 }]);
  const twice = insertEditors(once, [
    { kind: "distance", originName: "p", d: 0.5 },
  ]);
  expect(twice.match(/const __scene = /g)?.length).toBe(1);
  expect(twice).toMatch(/const d = editDistanceToPoint\(p, 0\.5\);/);
  const inner = twice.split("export function scene() {\n")[1]?.split("\n}")[0] ?? "";
  for (const line of inner.split("\n")) {
    if (!line.trim()) continue;
    expect(line.slice(0, 2), `bad indent: ${JSON.stringify(line)}`).toBe("  ");
    expect(line.slice(0, 4), `over-indented: ${JSON.stringify(line)}`).not.toBe(
      "    ",
    );
  }
});

test("rewrites return drawPlate so layout widgets still run first", () => {
  const plate = `import { drawPlate } from "../demo/plate.ts";
import { editPoint } from "@design-scenes/euclid2";

export function plateLayout() {
  const min = editPoint(-5, -3);
  return { min };
}

export function scene() {
  return drawPlate(plateLayout());
}
`;
  const next = insertEditors(plate, [{ kind: "point", x: 0, y: 1 }]);
  expect(next).toMatch(/const __scene = drawPlate\(plateLayout\(\)\);/);
  expect(next).toMatch(/const p = editPoint\(0, 1\);/);
  expect(widgetInSceneFunction(plate, at(plate, 0))).toBe(false);
  expect(widgetBindingName(plate, at(plate, 0))).toBe("min");
});

test("point then distance in one write shares the new name", () => {
  const next = insertEditors(hello, [
    { kind: "point", x: 2, y: 1 },
    { kind: "distance", d: 0.75 },
  ]);
  expect(next).toMatch(/const p = editPoint\(2, 1\);/);
  expect(next).toMatch(/const d = editDistanceToPoint\(p, 0\.75\);/);
});

test("adds a named import when euclid2 is missing", () => {
  const src = `import { circle } from "@design-scenes/geom";

export function scene() {
  return circle({ x: 0, y: 0 }, 1);
}
`;
  const next = insertEditors(src, [{ kind: "point", x: 0, y: 0 }]);
  expect(next).toMatch(
    /import \{ editPoint \} from "@design-scenes\/euclid2";/,
  );
});
