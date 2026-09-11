import { describe, expect, test } from "vitest";

import { parseExpose, parseImageImport, parseImagePatch, parseInsert, parseOpen } from "./schema";

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

  test("accepts a registered-tool payload", () => {
    const job = parseInsert({
      file: "apps/demo/src/scenes/tool-lab.ts",
      from: "boltCircle",
      args: [
        { kind: "ref", name: "P" },
        { kind: "num", value: 5 },
        { kind: "num", value: 6 },
      ],
      tool: { module: "/src/layout/tools.ts", prefix: "bc" },
    });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job.tool).toEqual({ module: "/src/layout/tools.ts", prefix: "bc" });
  });

  test("rejects a tool payload with an empty module", () => {
    const job = parseInsert({
      file: "apps/demo/src/scenes/tool-lab.ts",
      from: "boltCircle",
      args: [],
      tool: { module: "", prefix: "bc" },
    });
    expect(typeof job).toBe("string");
  });
});

describe("parseOpen", () => {
  test("accepts a file and line", () => {
    const job = parseOpen({ file: "src/layout/csg-tree.ts", line: 42 });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job).toEqual({ file: "src/layout/csg-tree.ts", line: 42 });
  });

  test("rejects an empty file or a non-positive line", () => {
    expect(typeof parseOpen({ file: "", line: 1 })).toBe("string");
    expect(typeof parseOpen({ file: "a.ts", line: 0 })).toBe("string");
    expect(typeof parseOpen({ file: "a.ts", line: "42" })).toBe("string");
  });
});

describe("parseImagePatch", () => {
  const file = "apps/demo/src/scenes/gear.ts";

  test("accepts dotted leaves and keeps only what was sent", () => {
    const job = parseImagePatch({
      file,
      id: "o_img",
      props: {
        "world.x": 1.5,
        "world.y": 2.5,
        "targetSize.width": 20,
        "style.opacity": 0.4,
        rot: 90,
      },
    });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job.props).toEqual({
      "world.x": 1.5,
      "world.y": 2.5,
      "targetSize.width": 20,
      "style.opacity": 0.4,
      rot: 90,
    });
  });

  test("handles keys with dots in them, rather than nesting them again", () => {
    const job = parseImagePatch({ file, id: "o_img", props: { "style.saturation": 0.2 } });
    expect(typeof job).not.toBe("string");
    if (typeof job === "string") throw new Error(job);
    expect(job.props).toHaveProperty("style.saturation", 0.2);
  });

  test("accepts a target size on one side only — the other is inferred", () => {
    expect(
      typeof parseImagePatch({ file, id: "o_img", props: { "targetSize.width": 20 } }),
    ).not.toBe("string");
    expect(
      typeof parseImagePatch({ file, id: "o_img", props: { "targetSize.height": 20 } }),
    ).not.toBe("string");
  });

  test("rejects an empty id and an empty patch", () => {
    expect(typeof parseImagePatch({ file, id: "", props: { "style.opacity": 1 } })).toBe("string");
    expect(typeof parseImagePatch({ file, id: "o_img", props: {} })).toBe("string");
  });

  /**
   * A half-stated pair is the one patch that would make a *created* branch
   * undrawable: the editor would write `world: { x: … }` and the
   * rect would be NaN. The wire refuses it rather than letting the node vanish.
   */
  test("rejects half a pair, for the branches that need both", () => {
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "world.x": 1 } })).toBe("string");
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "imageSize.width": 4 } })).toBe(
      "string",
    );
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "anchor.y": 2 } })).toBe("string");
  });

  test("accepts both of a pair", () => {
    expect(
      typeof parseImagePatch({
        file,
        id: "o_img",
        props: { "world.x": 1, "world.y": 2, "imageSize.width": 4, "imageSize.height": 8 },
      }),
    ).not.toBe("string");
  });

  test("rejects a turn that is not a quarter, and a flip that is not 0 or 1", () => {
    expect(typeof parseImagePatch({ file, id: "o_img", props: { rot: 45 } })).toBe("string");
    expect(typeof parseImagePatch({ file, id: "o_img", props: { rot: "90" } })).toBe("string");
    expect(typeof parseImagePatch({ file, id: "o_img", props: { flip: 2 } })).toBe("string");
  });

  test("rejects a negative target size and a style dial out of range", () => {
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "targetSize.width": -1 } })).toBe(
      "string",
    );
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "style.opacity": 1.2 } })).toBe(
      "string",
    );
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "style.opacity": -0.1 } })).toBe(
      "string",
    );
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "style.saturation": -1 } })).toBe(
      "string",
    );
    expect(typeof parseImagePatch({ file, id: "o_img", props: { "style.contrast": 9 } })).toBe(
      "string",
    );
  });

  test("rejects a leaf it does not know", () => {
    expect(typeof parseImagePatch({ file, id: "o_img", props: { x: 1 } })).toBe("string");
  });

  test("rejects a src that is not a non-empty string", () => {
    expect(typeof parseImagePatch({ file, id: "o_img", props: { src: "" } })).toBe("string");
    expect(typeof parseImagePatch({ file, id: "o_img", props: { src: 7 } })).toBe("string");
  });
});

describe("parseImageImport", () => {
  test("accepts a decodable extension, with or without its dot", () => {
    expect(parseImageImport({ slug: "gear", ext: "png" })).toEqual({ slug: "gear", ext: "png" });
    expect(parseImageImport({ slug: "gear", ext: ".PNG" })).toEqual({ slug: "gear", ext: "png" });
  });

  test("accepts a missing slug — the server has a fallback for it", () => {
    expect(parseImageImport({ ext: "webp" })).toEqual({ ext: "webp" });
  });

  test("rejects a format the browser is not asked to rasterise, and an empty ext", () => {
    expect(typeof parseImageImport({ slug: "x", ext: "svg" })).toBe("string");
    expect(typeof parseImageImport({ slug: "x", ext: "../../etc" })).toBe("string");
    expect(typeof parseImageImport({ slug: "x", ext: "" })).toBe("string");
    expect(typeof parseImageImport({ slug: "x", ext: 7 })).toBe("string");
  });
});
