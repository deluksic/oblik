import { describe, expect, test } from "vitest";

import { patchImageProps } from "./image-edit";

const SRC = `import { image, point } from "oblik";

export default defineScene({
  build() {
    const A = point(0, 0, "o_a");
    image(
      "/assets/gear-9f3a2c11.png",
      {
        world: { x: 10, y: 20 },
        imageSize: { width: 40, height: 20 },
        targetSize: { width: 40, height: 20 },
        rot: 0,
        flip: 0,
        style: { opacity: 0.5, saturation: 1 },
      },
      "o_img",
    );
    return { A };
  },
});
`;

/** A one-line call that states only its rect, so every other leaf is missing. */
const SHORT = `image("/a.png", { targetSize: { width: 20 } }, "o_img");\n`;

describe("patchImageProps", () => {
  test("overwrites a leaf nested in the options object", () => {
    const out = patchImageProps(SRC, "o_img", { "world.x": 12.5 });
    expect(out).toContain("world: { x: 12.5, y: 20 }");
  });

  test("overwrites a top-level leaf and a nested one", () => {
    const out = patchImageProps(SRC, "o_img", { "style.opacity": 0.25, rot: 270 });
    expect(out).toContain("rot: 270,");
    expect(out).toContain("style: { opacity: 0.25, saturation: 1 }");
  });

  test("creates the style branch for a call that has none", () => {
    const out = patchImageProps(SHORT, "o_img", { "style.saturation": 0.15 });
    expect(out).toBe(
      `image("/a.png", { targetSize: { width: 20 }, style: { saturation: 0.15 } }, "o_img");\n`,
    );
  });

  test("writes the target size one side at a time", () => {
    const out = patchImageProps(SRC, "o_img", { "targetSize.width": 80 });
    expect(out).toContain("targetSize: { width: 80, height: 20 }");
  });

  test("rewrites the source as the first argument", () => {
    const out = patchImageProps(SRC, "o_img", { src: "/assets/other.png" });
    expect(out).toContain('image(\n      "/assets/other.png",');
  });

  test("leaves the rest of the file byte for byte", () => {
    const out = patchImageProps(SRC, "o_img", { "targetSize.height": 40 });
    expect(out).toBe(
      SRC.replace("targetSize: { width: 40, height: 20 }", "targetSize: { width: 40, height: 40 }"),
    );
  });

  test("keeps authored expressions in the leaves it does not touch", () => {
    const src = `image("/a.png", { world: { x: x0, y: y0 } }, "o_img");\n`;
    const out = patchImageProps(src, "o_img", { "world.y": 7 });
    expect(out).toBe(`image("/a.png", { world: { x: x0, y: 7 } }, "o_img");\n`);
  });

  test("rounds to the two decimals the rest of the source writes", () => {
    expect(patchImageProps(SRC, "o_img", { "world.x": 1 / 3 })).toContain("x: 0.33");
  });

  test("rewrites the call with the id asked for, not the first image", () => {
    const src = `image("/a.png", { rot: 0 }, "o_one");\nimage("/b.png", { rot: 0 }, "o_two");\n`;
    const out = patchImageProps(src, "o_two", { rot: 180 });
    expect(out).toBe(
      `image("/a.png", { rot: 0 }, "o_one");\nimage("/b.png", { rot: 180 }, "o_two");\n`,
    );
  });

  describe("creating the branches a call does not carry yet", () => {
    test("a missing nested branch becomes one inserted tree", () => {
      const out = patchImageProps(SHORT, "o_img", {
        "world.x": 1,
        "world.y": 2,
      });
      expect(out).toBe(
        `image("/a.png", { targetSize: { width: 20 }, world: { x: 1, y: 2 } }, "o_img");\n`,
      );
    });

    test("two missing branches are one insert, not two", () => {
      const src = `image("/a.png", {}, "o_img");\n`;
      const out = patchImageProps(src, "o_img", {
        "world.x": 1,
        "world.y": 2,
        "targetSize.width": 20,
      });
      expect(out).toBe(
        `image("/a.png", { world: { x: 1, y: 2 }, targetSize: { width: 20 } }, "o_img");\n`,
      );
    });

    test("a missing leaf inside an object that is already there", () => {
      const src = `image("/a.png", { world: { x: 1, y: 2 } }, "o_img");\n`;
      const out = patchImageProps(src, "o_img", { "anchor.x": 5, "anchor.y": 6 });
      expect(out).toBe(
        `image("/a.png", { world: { x: 1, y: 2 }, anchor: { x: 5, y: 6 } }, "o_img");\n`,
      );
    });

    test("a multiline object gets one branch per line, indented like the last", () => {
      const src = `image("/a.png", {\n  targetSize: { width: 20 },\n}, "o_img");\n`;
      const out = patchImageProps(src, "o_img", {
        "world.x": 1,
        "world.y": 2,
      });
      expect(out).toBe(
        `image("/a.png", {\n  targetSize: { width: 20 },\n  world: { x: 1, y: 2 },\n}, "o_img");\n`,
      );
    });

    test("a single-line object with a trailing comma keeps one separator", () => {
      const src = `image("/a.png", { rot: 0, }, "o_img");\n`;
      expect(patchImageProps(src, "o_img", { "targetSize.width": 20 })).toBe(
        `image("/a.png", { rot: 0, targetSize: { width: 20 } }, "o_img");\n`,
      );
    });

    test("a shorthand leaf is replaced, not duplicated", () => {
      const src = `image("/a.png", { world: { x, y } }, "o_img");\n`;
      expect(patchImageProps(src, "o_img", { "world.x": 7 })).toBe(
        `image("/a.png", { world: { x: 7, y } }, "o_img");\n`,
      );
    });
  });

  test("refuses a call it cannot find", () => {
    expect(() => patchImageProps(SRC, "o_nope", { "style.opacity": 1 })).toThrow(/no image/);
  });

  test("refuses an empty patch", () => {
    expect(() => patchImageProps(SRC, "o_img", {})).toThrow(/no props/);
  });

  test("refuses a branch that is not an object literal", () => {
    const src = `image("/a.png", { world: somewhere }, "o_img");\n`;
    expect(() => patchImageProps(src, "o_img", { "world.x": 1 })).toThrow(/not an object literal/);
  });

  test("refuses a props argument that is not an object literal", () => {
    const src = `image("/a.png", opts, "o_img");\n`;
    expect(() => patchImageProps(src, "o_img", { "style.opacity": 1 })).toThrow(
      /no options object/,
    );
  });

  test("a patch that leaves the source identical is still a rewrite, not a corruption", () => {
    expect(patchImageProps(SRC, "o_img", { "world.x": 10 })).toBe(SRC);
  });
});
