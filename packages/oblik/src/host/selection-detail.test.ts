import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { pinConstructorSite, stackForNode } from "./selection-detail";

const node = {
  id: "o_a",
  occ: 0,
  kind: "point",
  value: { kind: "point", x: 0, y: 0 },
  bind: "A",
  editable: true,
  at: { line: 10, column: 4 },
  module: "apps/demo/src/scenes/shelf.ts",
  stack: [
    { file: "node_modules/.vite/deps/dev-DEjxqSxT.js", line: 99, column: 1 },
    { file: "apps/demo/src/scenes/shelf.ts", line: 12, column: 6, name: "build" },
  ],
} as TraceNode;

describe("stackForNode", () => {
  test("drops vite frames and pins the constructor site", () => {
    const stack = stackForNode(node);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      file: "apps/demo/src/scenes/shelf.ts",
      line: 10,
      column: 4,
    });
  });

  test("uses annotation site when runtime stack is empty", () => {
    const stack = stackForNode({ ...node, stack: [] });
    expect(stack).toEqual([
      { file: "apps/demo/src/scenes/shelf.ts", line: 10, column: 4 },
    ]);
  });

  test("rewrites app-relative stack paths to the module path", () => {
    const stack = stackForNode({
      ...node,
      stack: [
        { file: "src/scenes/shelf.ts", line: 10, column: 4 },
        { file: "src/scenes/shelf.ts", line: 12, column: 6, name: "build" },
      ],
    });
    expect(stack).toHaveLength(2);
    expect(stack.every((f) => f.file === "apps/demo/src/scenes/shelf.ts")).toBe(true);
    expect(stack[0]).toMatchObject({ line: 10, column: 4 });
    expect(stack[1]).toMatchObject({ line: 12, column: 6, name: "build" });
  });
});

describe("pinConstructorSite", () => {
  test("creates a frame from site when stack is empty", () => {
    expect(
      pinConstructorSite([], {
        file: "apps/demo/src/scenes/shelf.ts",
        line: 10,
        column: 4,
      }),
    ).toEqual([{ file: "apps/demo/src/scenes/shelf.ts", line: 10, column: 4 }]);
  });
});
