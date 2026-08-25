import { describe, expect, test } from "vitest";

import { parseInsert } from "./schema";

describe("parseInsert", () => {
  test("accepts slider args with props", () => {
    const job = parseInsert({
      file: "apps/demo/src/scenes/shelf.ts",
      from: "slider",
      bind: "reach",
      args: [
        { kind: "num", value: 1.8 },
        {
          kind: "props",
          props: {
            min: { kind: "num", value: 0 },
            max: { kind: "num", value: 4 },
            step: { kind: "num", value: 0.05 },
          },
        },
      ],
      id: "o_sl",
    });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job.from).toBe("slider");
    expect(job.args[1]).toEqual({
      kind: "props",
      props: {
        min: { kind: "num", value: 0 },
        max: { kind: "num", value: 4 },
        step: { kind: "num", value: 0.05 },
      },
    });
  });
});
