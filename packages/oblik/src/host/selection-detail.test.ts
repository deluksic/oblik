import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { analyzeMentions } from "../source/mention";
import {
  buildFunctionSourceLines,
  buildOriginFrameLines,
  dedentOriginLines,
  findFunctionHeaderRow,
  functionSourceSpan,
  originFileLabel,
  pinConstructorSite,
  scopeCallerChain,
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
    expect(stack).toEqual([{ file: "apps/demo/src/scenes/shelf.ts", line: 10, column: 4 }]);
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

  test("normalizes raw Vite dev-server stack paths at presentation", () => {
    const stack = stackForNode({
      ...node,
      module: "apps/demo/src/scenes/shelf.ts",
      stack: [
        {
          file: "http://127.0.0.1:43127/src/scenes/shelf.ts",
          line: 12,
          column: 6,
          name: "build",
        },
      ],
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      file: "apps/demo/src/scenes/shelf.ts",
      line: 10,
      column: 4,
    });
  });

  test("drops oblik and vite frames from a raw capture stack at presentation", () => {
    const stack = stackForNode({
      ...node,
      stack: [
        { file: "packages/oblik/src/eval/constructors.ts", line: 82, column: 1, name: "traced" },
        { file: "node_modules/.vite/deps/dev-DEjxqSxT.js", line: 99, column: 1 },
        { file: "apps/demo/src/scenes/shelf.ts", line: 12, column: 6, name: "build" },
      ],
    });
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      file: "apps/demo/src/scenes/shelf.ts",
      line: 10,
      column: 4,
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
    expect(originFileLabel("apps/demo/src/layout/mounting-plate.ts")).toBe(
      "src/layout/mounting-plate.ts",
    );
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
      current: true,
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
    expect(lines[0]).toEqual({
      kind: "header",
      line: 1,
      text: "build() {",
      current: true,
    });
    expect(lines.map((row) => ("text" in row ? row.text : "..."))).toEqual([
      "build() {",
      "  const plate = mountingPlateLayout();",
      "},",
    ]);
    expect(lines[2]).toEqual({ kind: "code", line: 3, text: "}," });
  });
});

describe("dedentOriginLines", () => {
  test("strips indent shared by a nested build() snippet", () => {
    const lines = dedentOriginLines([
      { kind: "header", line: 7, text: "  build() {", current: true },
      { kind: "code", line: 8, text: "    const plate = mountingPlateLayout();" },
      { kind: "code", line: 9, text: "  }," },
    ]);
    expect(lines.map((row) => ("text" in row ? row.text : "..."))).toEqual([
      "build() {",
      "  const plate = mountingPlateLayout();",
      "},",
    ]);
  });

  test("leaves a column-0 helper alone", () => {
    const lines = dedentOriginLines([
      { kind: "header", line: 1, text: "export function mountingPlateLayout() {", current: true },
      { kind: "code", line: 2, text: '  const origin = point(0.13, 0.25, "o_origin");' },
      { kind: "code", line: 3, text: "}" },
    ]);
    expect(lines[0]).toMatchObject({ text: "export function mountingPlateLayout() {" });
    expect(lines[1]).toMatchObject({ text: '  const origin = point(0.13, 0.25, "o_origin");' });
  });

  test("rewrites mixed tabs and spaces to 2-space indent", () => {
    const lines = dedentOriginLines([
      { kind: "header", line: 1, text: "  build() {", current: true },
      { kind: "code", line: 2, text: "\tconst plate = mountingPlateLayout();" },
    ]);
    expect(lines.map((row) => ("text" in row ? row.text : "..."))).toEqual([
      "  build() {",
      "  const plate = mountingPlateLayout();",
    ]);
  });

  test("collapses 4-space indent to 2-space after stripping the shared prefix", () => {
    const lines = dedentOriginLines([
      { kind: "header", line: 7, text: "    build() {", current: true },
      { kind: "code", line: 8, text: "        const plate = mountingPlateLayout();" },
      { kind: "code", line: 9, text: "    }," },
    ]);
    expect(lines.map((row) => ("text" in row ? row.text : "..."))).toEqual([
      "build() {",
      "  const plate = mountingPlateLayout();",
      "},",
    ]);
  });
});

describe("functionSourceSpan", () => {
  test("resolves the header even when mention start/end are present", () => {
    expect(
      functionSourceSpan(plateFn, { startLine: 1, endLine: 7, name: "mountingPlateLayout" }),
    ).toEqual({
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

  test("does not treat a closing-brace-only mention span as the function", () => {
    expect(
      functionSourceSpan(plateFn, { startLine: 7, endLine: 7, name: "mountingPlateLayout" }),
    ).toEqual({
      startLine: 1,
      endLine: 7,
    });
  });
});

describe("buildOriginFrameLines", () => {
  test("pins the header when the site is only a closing curly", () => {
    const src = `export function mountingPlateLayout() {
  const origin = point(0.13, 0.25, "o_origin");
  return { origin };
}
`;
    const lines = buildOriginFrameLines(src, 4, "mountingPlateLayout");
    expect(lines[0]).toEqual({
      kind: "header",
      line: 1,
      text: "export function mountingPlateLayout() {",
      current: true,
    });
    expect(lines.some((row) => row.kind === "code" && row.current)).toBe(false);
  });

  test("keeps the pin on a real constructor site", () => {
    const lines = buildOriginFrameLines(plateFn, 2, "mountingPlateLayout");
    expect(lines[0]).toMatchObject({
      kind: "header",
      text: "export function mountingPlateLayout() {",
    });
    expect(lines[0]).not.toMatchObject({ current: true });
    expect(
      lines.some((row) => row.kind === "code" && row.current && row.text.includes("origin")),
    ).toBe(true);
  });

  test("does not quote scene fields that sit above build()", () => {
    const src = `export default defineScene({
  kind: "euclid2",
  title: "Plate grid",
  camera: { x: 6.2, y: 3.3, scale: 40 },
  build() {
    for (let col = 0; col < 3; col++) {
      mountingPlateLayout(col * 4.15, 0);
    }
  },
});
`;
    const atHeader = buildOriginFrameLines(src, 5, "build");
    const atBrace = buildOriginFrameLines(src, 9, "build");
    for (const lines of [atHeader, atBrace]) {
      const texts = lines.map((row) => ("text" in row ? row.text : "..."));
      expect(texts.some((t) => t.includes("camera"))).toBe(false);
      expect(texts[0]).toBe("build() {");
    }
  });
});

describe("findFunctionHeaderRow", () => {
  test("matches defineScene method shorthand build() {", () => {
    const rows = [
      'import { defineScene } from "oblik";',
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
      expect(detail.origin.frames).toHaveLength(1);
      const texts = detail.origin.frames[0]!.lines.map((row) => ("text" in row ? row.text : "..."));
      expect(texts.some((t) => t.includes("ellipsis") || t === "...")).toBe(false);
      expect(texts).toEqual(["build() {", "  const plate = mountingPlateLayout();", "},"]);
      expect(detail.origin.frames[0]!.lines[0]).toEqual({
        kind: "header",
        line: 7,
        text: "build() {",
        current: true,
      });
      expect(detail.origin.frames[0]!.lines.at(-1)).toEqual({
        kind: "code",
        line: 9,
        text: "},",
      });
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("empty helper selection also shows the parent call site as a jump target", async () => {
    const helperFile = "apps/demo/src/layout/mounting-plate.ts";
    const parentFile = "apps/demo/src/scenes/mounting-plate.ts";
    const helperSrc = plateFn;
    const parentSrc = `import { mountingPlateLayout } from "../layout/mounting-plate";
import { defineScene } from "oblik";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const plate = mountingPlateLayout();
  },
});
`;
    const mentions = [
      analyzeMentions(helperSrc, helperFile),
      analyzeMentions(parentSrc, parentFile),
    ];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const q = decodeURIComponent(url.split("file=")[1] ?? "");
      if (q.includes("layout/mounting-plate")) return new Response(helperSrc, { status: 200 });
      if (q.includes("scenes/mounting-plate")) return new Response(parentSrc, { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    try {
      const detail = await selectionDetailForScope({
        node: null,
        focus: {
          file: helperFile,
          name: "mountingPlateLayout",
          serial: 0,
          callerFile: parentFile,
          callerLine: 7,
        },
        mentions,
      });
      expect(detail.origin.kind).toBe("origin");
      if (detail.origin.kind !== "origin") throw new Error("expected origin");
      expect(detail.origin.frames).toHaveLength(2);
      expect(detail.origin.frames[0]).toMatchObject({
        current: true,
        pick: expect.objectContaining({ name: "mountingPlateLayout" }),
      });
      expect(detail.origin.frames[1]).toMatchObject({
        current: false,
        pick: expect.objectContaining({ name: "build", file: parentFile }),
      });
      const parentTexts = detail.origin.frames[1]!.lines.map((row) =>
        "text" in row ? row.text : "...",
      );
      expect(parentTexts.some((t) => t.includes("mountingPlateLayout()"))).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("a looped invocation quotes the call in build, not camera above it", async () => {
    const helperFile = "apps/demo/src/layout/mounting-plate.ts";
    const parentFile = "apps/demo/src/scenes/mounting-plate-grid.ts";
    const helperSrc = plateFn;
    const parentSrc = `import { defineScene } from "oblik";
import { mountingPlateLayout } from "../layout/mounting-plate";

export default defineScene({
  kind: "euclid2",
  title: "Plate grid",
  camera: { x: 6.2, y: 3.3, scale: 40 },
  build() {
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 2; row++) {
        mountingPlateLayout(col * 4.15, row * 3.2);
      }
    }
  },
});
`;
    const mentions = [
      analyzeMentions(helperSrc, helperFile),
      analyzeMentions(parentSrc, parentFile),
    ];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const q = decodeURIComponent(url.split("file=")[1] ?? "");
      if (q.includes("layout/mounting-plate")) return new Response(helperSrc, { status: 200 });
      if (q.includes("scenes/mounting-plate-grid")) return new Response(parentSrc, { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    try {
      const detail = await selectionDetailForScope({
        node: null,
        focus: {
          file: helperFile,
          name: "mountingPlateLayout",
          serial: 1,
          callerFile: parentFile,
          // Generated stacks land on the caller's `},`, not the helper call.
          callerLine: 14,
        },
        mentions,
      });
      expect(detail.origin.kind).toBe("origin");
      if (detail.origin.kind !== "origin") throw new Error("expected origin");
      expect(detail.origin.frames).toHaveLength(2);
      const parentTexts = detail.origin.frames[1]!.lines.map((row) =>
        "text" in row ? row.text : "...",
      );
      expect(parentTexts.some((t) => t.includes("camera"))).toBe(false);
      expect(parentTexts.some((t) => t.includes("mountingPlateLayout("))).toBe(true);
      expect(
        detail.origin.frames[1]!.lines.some(
          (row) => row.kind === "code" && row.current && row.text.includes("mountingPlateLayout("),
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("offers adding a private local to the return bag", async () => {
    const helperFile = "apps/demo/src/layout/plate.ts";
    const helperSrc = `export function plate() {
  const origin = point(0, 0, "o_origin");
  const hLeft = parallelLine(edge, 0.2, "o_inl");
  return { origin };
}
`;
    const mentions = [analyzeMentions(helperSrc, helperFile)];
    const traceNode = {
      id: "o_inl",
      occ: 0,
      kind: "line",
      value: {
        kind: "parallelLine",
        origin: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        distance: 0.2,
      },
      bind: "hLeft",
      editable: false,
      at: { line: 3, column: 4 },
      module: helperFile,
      stack: [{ file: helperFile, line: 3, column: 4, name: "plate" }],
    } as unknown as TraceNode;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("__peek")) return new Response(helperSrc, { status: 200 });
      if (url.includes("__map-stack"))
        return new Response(JSON.stringify({ frames: traceNode.stack }), { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    try {
      const detail = await selectionDetailForScope({
        node: traceNode,
        focus: { file: helperFile, name: "plate", serial: 0 },
        mentions,
      });
      expect(detail.expose).toEqual({
        kind: "hint",
        bind: "hLeft",
        text: "hLeft is constructed here and not returned. Add it to the return so the caller can refer to it.",
      });
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("blocks adding to a single-value return", async () => {
    const helperFile = "apps/demo/src/layout/plate.ts";
    const helperSrc = `export function plate() {
  const origin = point(0, 0, "o_origin");
  const hLeft = parallelLine(edge, 0.2, "o_inl");
  return origin;
}
`;
    const mentions = [analyzeMentions(helperSrc, helperFile)];
    const traceNode = {
      id: "o_inl",
      occ: 0,
      kind: "line",
      value: {
        kind: "parallelLine",
        origin: { x: 0, y: 0 },
        direction: { x: 1, y: 0 },
        distance: 0.2,
      },
      bind: "hLeft",
      editable: false,
      at: { line: 3, column: 4 },
      module: helperFile,
      stack: [{ file: helperFile, line: 3, column: 4, name: "plate" }],
    } as unknown as TraceNode;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("__peek")) return new Response(helperSrc, { status: 200 });
      if (url.includes("__map-stack"))
        return new Response(JSON.stringify({ frames: traceNode.stack }), { status: 200 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    try {
      const detail = await selectionDetailForScope({
        node: traceNode,
        focus: { file: helperFile, name: "plate", serial: 0 },
        mentions,
      });
      expect(detail.expose).toEqual({
        kind: "blocked",
        text: "This function returns a single value, so it has no return bag to add a field to. Change the return to an object literal first — oblik will not wrap it.",
      });
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("scopeCallerChain", () => {
  test("root build has no parent frame", () => {
    const file = "apps/demo/src/scenes/mounting-plate.ts";
    const src = `export default defineScene({
  build() {
    const plate = mountingPlateLayout();
  },
});
`;
    expect(
      scopeCallerChain({ file, name: "build", serial: 0 }, [analyzeMentions(src, file)]),
    ).toEqual([]);
  });

  test("helper walks to the build() call without a selected node", () => {
    const helperFile = "apps/demo/src/layout/mounting-plate.ts";
    const parentFile = "apps/demo/src/scenes/mounting-plate.ts";
    const parentSrc = `import { mountingPlateLayout } from "../layout/mounting-plate";
export default defineScene({
  build() {
    const plate = mountingPlateLayout();
  },
});
`;
    const mentions = [analyzeMentions(plateFn, helperFile), analyzeMentions(parentSrc, parentFile)];
    const chain = scopeCallerChain(
      { file: helperFile, name: "mountingPlateLayout", serial: 0 },
      mentions,
    );
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({
      name: "build",
      pick: { name: "build", file: parentFile },
    });
    expect(chain[0]!.line).toBeGreaterThan(0);
  });

  test("looped helper call is the parent site even when callerLine is the closing brace", () => {
    const helperFile = "apps/demo/src/layout/mounting-plate.ts";
    const parentFile = "apps/demo/src/scenes/mounting-plate-grid.ts";
    const parentSrc = `export default defineScene({
  camera: { x: 6.2, y: 3.3, scale: 40 },
  build() {
    for (let col = 0; col < 3; col++) {
      mountingPlateLayout(col * 4.15, 0);
    }
  },
});
`;
    const mentions = [analyzeMentions(plateFn, helperFile), analyzeMentions(parentSrc, parentFile)];
    const chain = scopeCallerChain(
      {
        file: helperFile,
        name: "mountingPlateLayout",
        serial: 0,
        callerFile: parentFile,
        callerLine: 7,
      },
      mentions,
    );
    expect(chain).toHaveLength(1);
    expect(parentSrc.split("\n")[chain[0]!.line - 1]).toContain("mountingPlateLayout(");
  });
});
