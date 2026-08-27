import { describe, expect, test } from "vitest";

import { parseExpose, parseInsert } from "./schema";

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

  test("accepts a fillet vertex patch", () => {
    const job = parseInsert({
      file: "apps/demo/src/scenes/fillet.ts",
      from: "fillet",
      args: [{ kind: "ref", name: "r" }],
      patchVertex: { id: "o_fil_mix", index: 1 },
    });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job.patchVertex).toEqual({ id: "o_fil_mix", index: 1 });
    expect(job.from).toBe("fillet");
  });
});

describe("parseExpose", () => {
  test("accepts a return bag field", () => {
    const job = parseExpose({
      file: "apps/demo/src/layout/mounting-plate.ts",
      dest: "mountingPlateLayout",
      bind: "hLeft",
    });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job).toEqual({
      file: "apps/demo/src/layout/mounting-plate.ts",
      dest: "mountingPlateLayout",
      bind: "hLeft",
    });
  });
});
