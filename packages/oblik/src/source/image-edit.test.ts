import { describe, expect, test } from "vitest";

import { patchImageProps } from "./image-edit";

const SRC = `import { image, point } from "oblik";

export default defineScene({
  build() {
    const A = point(0, 0, "o_a");
    image("/assets/gear-9f3a2c11.png", { x: 10, y: 20, w: 40, h: 20, rot: 0, flip: 0, fade: 0.5 }, "o_img");
    return { A };
  },
});
`;

const SHORT = `image("/a.png", { x: 10, y: 20, w: 40, h: 20 }, "o_img");\n`;

describe("patchImageProps", () => {
  test("rewrites only the named properties", () => {
    const out = patchImageProps(SRC, "o_img", { x: 12.5, fade: 0.25 });
    expect(out).toContain(
      'image("/assets/gear-9f3a2c11.png", { x: 12.5, y: 20, w: 40, h: 20, rot: 0, flip: 0, fade: 0.25 }, "o_img")',
    );
  });

  test("every prop has its own property", () => {
    const out = patchImageProps(SRC, "o_img", {
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      rot: 270,
      flip: 1,
      fade: 0,
    });
    expect(out).toContain("{ x: 1, y: 2, w: 3, h: 4, rot: 270, flip: 1, fade: 0 }");
  });

  test("rewrites the source as the first argument", () => {
    const out = patchImageProps(SRC, "o_img", { src: "/assets/other.png" });
    expect(out).toContain('image("/assets/other.png", { x: 10,');
  });

  test("leaves the rest of the file byte for byte", () => {
    const out = patchImageProps(SRC, "o_img", { w: 80 });
    expect(out).toBe(SRC.replace("w: 40", "w: 80"));
  });

  test("keeps authored expressions in the properties it does not touch", () => {
    const src = `image("/a.png", { x: x0, y: y0, w: 40, h: 20 }, "o_img");\n`;
    const out = patchImageProps(src, "o_img", { fade: 1 });
    expect(out).toBe(`image("/a.png", { x: x0, y: y0, w: 40, h: 20, fade: 1 }, "o_img");\n`);
  });

  test("rounds to the two decimals the rest of the source writes", () => {
    expect(patchImageProps(SRC, "o_img", { x: 1 / 3 })).toContain("x: 0.33,");
  });

  test("rewrites the call with the id asked for, not the first image", () => {
    const src = `image("/a.png", { x: 0, y: 0, w: 1, h: 1 }, "o_one");\nimage("/b.png", { x: 0, y: 0, w: 9, h: 9 }, "o_two");\n`;
    const out = patchImageProps(src, "o_two", { w: 5 });
    expect(out).toBe(
      `image("/a.png", { x: 0, y: 0, w: 1, h: 1 }, "o_one");\nimage("/b.png", { x: 0, y: 0, w: 5, h: 9 }, "o_two");\n`,
    );
  });

  describe("inserting a property the call does not carry yet", () => {
    test("single line, no trailing comma", () => {
      expect(patchImageProps(SHORT, "o_img", { fade: 0.4 })).toBe(
        `image("/a.png", { x: 10, y: 20, w: 40, h: 20, fade: 0.4 }, "o_img");\n`,
      );
    });

    test("single line with a trailing comma", () => {
      const src = `image("/a.png", { x: 10, y: 20, w: 40, h: 20, }, "o_img");\n`;
      expect(patchImageProps(src, "o_img", { rot: 90, fade: 0.4 })).toBe(
        `image("/a.png", { x: 10, y: 20, w: 40, h: 20, rot: 90, fade: 0.4 }, "o_img");\n`,
      );
    });

    test("an empty options object", () => {
      const src = `image("/a.png", {}, "o_img");\n`;
      expect(patchImageProps(src, "o_img", { x: 1, y: 2 })).toBe(
        `image("/a.png", { x: 1, y: 2 }, "o_img");\n`,
      );
    });

    test("a multiline object gets one property per line, indented like the last", () => {
      const src = `image("/a.png", {\n  x: 10,\n  y: 20,\n}, "o_img");\n`;
      // Inserted in the props' canonical order, not the caller's argument order.
      expect(patchImageProps(src, "o_img", { fade: 0.4, rot: 90 })).toBe(
        `image("/a.png", {\n  x: 10,\n  y: 20,\n  rot: 90,\n  fade: 0.4,\n}, "o_img");\n`,
      );
    });

    test("a shorthand property is replaced, not duplicated", () => {
      const src = `image("/a.png", { x, y, w: 40, h: 20 }, "o_img");\n`;
      expect(patchImageProps(src, "o_img", { x: 7 })).toBe(
        `image("/a.png", { x: 7, y, w: 40, h: 20 }, "o_img");\n`,
      );
    });

    test("a mix of overwritten and inserted properties", () => {
      expect(patchImageProps(SHORT, "o_img", { x: 1, fade: 0.4 })).toBe(
        `image("/a.png", { x: 1, y: 20, w: 40, h: 20, fade: 0.4 }, "o_img");\n`,
      );
    });
  });

  test("refuses a call it cannot find", () => {
    expect(() => patchImageProps(SRC, "o_nope", { x: 1 })).toThrow(/no image/);
  });

  test("refuses an empty patch", () => {
    expect(() => patchImageProps(SRC, "o_img", {})).toThrow(/no props/);
  });

  test("refuses a props argument that is not an object literal", () => {
    const src = `image("/a.png", opts, "o_img");\n`;
    expect(() => patchImageProps(src, "o_img", { x: 1 })).toThrow(/no options object/);
  });

  test("a patch that leaves the source identical is still a rewrite, not a corruption", () => {
    expect(patchImageProps(SRC, "o_img", { x: 10 })).toBe(SRC);
  });
});
