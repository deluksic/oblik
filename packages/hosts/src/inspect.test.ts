import { describe, expect, test } from "vitest";

import { renderStackSnippets, stackLabel, type StackFrame } from "./inspect";

const leaf: StackFrame = {
  file: "apps/paper/src/scenes/floor-plan.ts",
  line: 12,
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

describe("renderStackSnippets", () => {
  test("empty origin is a sentence, not a traceback", async () => {
    const html = await renderStackSnippets([], new Map());
    expect(html).toContain("No source location for this object.");
    expect(html).not.toContain("stack-frame");
  });

  test("quotes the helper and lists how it was reached", async () => {
    const cache = new Map([
      ["apps/paper/src/scenes/floor-plan.ts", "const south = wallRun();\nconst door = doorOpen();\n"],
    ]);
    const html = await renderStackSnippets([leaf, caller], cache);
    expect(html).toContain("Built by");
    expect(html).toContain("doorOpen");
    expect(html).toContain("Reached through");
    expect(html).toContain("origin-path");
    expect(html).not.toContain("at ");
  });
});
