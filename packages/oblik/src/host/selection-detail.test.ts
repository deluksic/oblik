import { describe, expect, test } from "vitest";

import { analyzeMentions } from "../source/mention";
import type { TraceNode } from "../eval/context";
import {
  buildFunctionSourceLines,
  findFunctionHeaderRow,
  functionSourceSpan,
  originFileLabel,
  pinConstructorSite,
  selectionDetailForScope,
  stackForNode,
} from "./selection-detail";

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

  test("does not rewrite a helper frame onto a same-named scene", () => {
    const stack = stackForNode({
      ...node,
      module: "apps/demo/src/layout/mounting-plate.ts",
      at: { line: 5, column: 17 },
      stack: [
        { file: "src/layout/mounting-plate.ts", line: 5, column: 17, name: "mountingPlateLayout" },
        { file: "src/scenes/mounting-plate.ts", line: 11, column: 12, name: "build" },
      ],
    });
    expect(stack[0]).toMatchObject({
      file: "apps/demo/src/layout/mounting-plate.ts",
      line: 5,
      column: 17,
    });
    expect(stack[1]).toMatchObject({
      file: "src/scenes/mounting-plate.ts",
      line: 11,
      column: 12,
      name: "build",
    });
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

describe("originFileLabel", () => {
  test("keeps src/… so a helper is distinct from a same-named scene", () => {
    expect(originFileLabel("apps/demo/src/layout/mounting-plate.ts")).toBe("src/layout/mounting-plate.ts");
    expect(originFileLabel("src/scenes/mounting-plate.ts")).toBe("src/scenes/mounting-plate.ts");
  });
});

const plateFn = `export function mountingPlateLayout() {
  const origin = point(0.13, 0.25, "o_origin");
  const opp = point(3.86, 3.02, "o_opp");
  const hBottom = parallelLine(bottom, 0.49, "o_in");
  const drill = circle(c0, 0.18, "o_drill");
  return { origin, opp, hBottom, drill };
}
`;

describe("buildFunctionSourceLines", () => {
  test("emits every line of the function with no ellipsis", () => {
    const lines = buildFunctionSourceLines(plateFn, { startLine: 1, endLine: 7 });
    expect(lines.some((row) => row.kind === "ellipsis")).toBe(false);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual({
      kind: "header",
      line: 1,
      text: "export function mountingPlateLayout() {",
    });
    expect(lines[3]).toEqual({
      kind: "code",
      line: 4,
      text: '  const hBottom = parallelLine(bottom, 0.49, "o_in");',
    });
    expect(lines[6]).toEqual({ kind: "code", line: 7, text: "}" });
  });

  test("keeps a short build() whole, not a snippet around the header", () => {
    const src = `  build() {
    const plate = mountingPlateLayout();
  },
`;
    const lines = buildFunctionSourceLines(src, { startLine: 1, endLine: 3 });
    expect(lines.map((row) => ("text" in row ? row.text : "..."))).toEqual([
      "  build() {",
      "    const plate = mountingPlateLayout();",
      "  },",
    ]);
  });
});

describe("functionSourceSpan", () => {
  test("trusts mention start/end when both are present", () => {
    expect(functionSourceSpan(plateFn, { startLine: 1, endLine: 7, name: "mountingPlateLayout" })).toEqual({
      startLine: 1,
      endLine: 7,
    });
  });

  test("scans braces from the header when mentions omit the span", () => {
    expect(functionSourceSpan(plateFn, { name: "mountingPlateLayout" })).toEqual({
      startLine: 1,
      endLine: 7,
    });
  });
});

describe("findFunctionHeaderRow", () => {
  test("matches defineScene method shorthand build() {", () => {
    const rows = [
      "import { defineScene } from \"oblik\";",
      "export default defineScene({",
      "  build() {",
      "    const plate = mountingPlateLayout();",
      "  },",
      "});",
    ];
    expect(findFunctionHeaderRow(rows, 1, "build")).toBe(2);
  });
});

describe("selectionDetailForScope", () => {
  test("empty selection quotes the full focused build() body", async () => {
    const src = `import { defineScene } from "oblik";
import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "Mounting plate",
  build() {
    const plate = mountingPlateLayout();
  },
});
`;
    const file = "apps/demo/src/scenes/mounting-plate.ts";
    const mentions = [analyzeMentions(src, file)];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("__peek")) return new Response(src, { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    try {
      const detail = await selectionDetailForScope({
        node: null,
        focus: { file, name: "build", serial: 0 },
        mentions,
      });
      expect(detail.crumb).toBe("build");
      expect(detail.origin.kind).toBe("origin");
      if (detail.origin.kind !== "origin") throw new Error("expected origin");
      const texts = detail.origin.frames[0]!.lines.map((row) => ("text" in row ? row.text : "..."));
      expect(texts.some((t) => t.includes("ellipsis") || t === "...")).toBe(false);
      expect(texts).toEqual([
        "  build() {",
        "    const plate = mountingPlateLayout();",
        "  },",
      ]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
