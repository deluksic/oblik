import { describe, expect, test } from "vitest";

import { originFromStack, stackLabel, type StackFrame } from "./inspect";

const leaf: StackFrame = {
  file: "apps/paper/src/scenes/floor-plan.ts",
  line: 2,
  column: 5,
  name: "doorOpen",
};

const caller: StackFrame = {
  file: "apps/paper/src/scenes/floor-plan.ts",
  line: 80,
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

describe("originFromStack", () => {
  test("empty origin is a sentence, not a traceback", async () => {
    const origin = await originFromStack([], new Map());
    expect(origin).toEqual({ kind: "empty", message: "No source location for this object." });
  });

  test("quotes the helper and lists how it was reached", async () => {
    const cache = new Map([
      ["apps/paper/src/scenes/floor-plan.ts", "const south = wallRun();\nconst door = doorOpen();\n"],
    ]);
    const origin = await originFromStack([leaf, caller], cache);
    expect(origin.kind).toBe("origin");
    if (origin.kind !== "origin") return;
    expect(origin.who).toBe("doorOpen");
    expect(origin.file).toBe("floor-plan.ts");
    expect(origin.quote.some((row) => row.current && row.text.includes("doorOpen"))).toBe(true);
    expect(origin.callers).toEqual([{ who: "scene", loc: "floor-plan.ts:80" }]);
  });
});
