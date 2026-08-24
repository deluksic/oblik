import { describe, expect, test } from "vitest";

import {
  buildOriginFrameLines,
  findFunctionHeaderRow,
  originFromStack,
  stackLabel,
  type StackFrame,
} from "./inspect";

const floorPlanSource = `function doorOpen() {
  return segment(a, b);
}
export function scene() {
  const door = doorOpen();
}
`;

const leaf: StackFrame = {
  file: "apps/paper/src/scenes/floor-plan.ts",
  line: 2,
  column: 5,
  name: "doorOpen",
};

const caller: StackFrame = {
  file: "apps/paper/src/scenes/floor-plan.ts",
  line: 5,
  column: 3,
  name: "scene",
};

describe("stackLabel", () => {
  test("empty frames have no origin line", () => {
    expect(stackLabel([])).toBe("");
  });

  test("one frame reads as built in the file", () => {
    expect(stackLabel([{ file: "apps/paper/src/scenes/shelf.ts", line: 4, column: 1 }])).toBe(
      "Built in shelf.ts",
    );
  });

  test("nested helpers name who and where", () => {
    expect(stackLabel([leaf, caller])).toBe("From doorOpen in floor-plan.ts");
  });
});

describe("buildOriginFrameLines", () => {
  test("shows the function header and highlighted site lines", () => {
    const rows = floorPlanSource.split("\n");
    expect(findFunctionHeaderRow(rows, 2, "doorOpen")).toBe(0);
    const lines = buildOriginFrameLines(floorPlanSource, 2, "doorOpen");
    expect(lines[0]).toEqual({ kind: "header", line: 1, text: "function doorOpen() {" });
    expect(lines.some((row) => row.kind === "code" && row.current && row.text.includes("segment"))).toBe(
      true,
    );
  });

  test("inserts an ellipsis when the site is far below the header", () => {
    const source = `function draw() {
  const a = 1;
  const b = 2;
  const c = 3;
  return segment(a, b);
}
`;
    const lines = buildOriginFrameLines(source, 5, "draw");
    expect(lines[0]?.kind).toBe("header");
    expect(lines.some((row) => row.kind === "ellipsis")).toBe(true);
    expect(lines.some((row) => row.kind === "code" && row.current && row.text.includes("segment"))).toBe(
      true,
    );
  });

  test("caller frame shows the parent function and call site", () => {
    const lines = buildOriginFrameLines(floorPlanSource, 5, "scene");
    expect(lines[0]).toEqual({ kind: "header", line: 4, text: "export function scene() {" });
    expect(lines.some((row) => row.kind === "code" && row.current && row.text.includes("doorOpen"))).toBe(
      true,
    );
  });
});

describe("originFromStack", () => {
  test("empty origin is a sentence, not a traceback", async () => {
    const origin = await originFromStack([], new Map());
    expect(origin).toEqual({ kind: "empty", message: "No source location for this object." });
  });

  test("renders one box per stack frame", async () => {
    const cache = new Map([["apps/paper/src/scenes/floor-plan.ts", floorPlanSource]]);
    const origin = await originFromStack([leaf, caller], cache);
    expect(origin.kind).toBe("origin");
    if (origin.kind !== "origin") return;
    expect(origin.frames).toHaveLength(2);
    expect(origin.frames[0]?.file).toBe("floor-plan.ts");
    expect(origin.frames[0]?.lines[0]?.kind).toBe("header");
    expect(origin.frames[1]?.lines.some((row) => row.kind === "code" && row.current)).toBe(true);
  });
});
