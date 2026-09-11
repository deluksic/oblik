import { describe, expect, test } from "vitest";

import { patchImageProps } from "./image-edit";

const SRC = `import { image, point } from "oblik";

export default defineScene({
  build() {
    const A = point(0, 0, "o_a");
    image("/assets/gear-9f3a2c11.png", 10, 20, 40, 20, 0, 0, 0.5, "o_img");
    return { A };
  },
});
`;

describe("patchImageProps", () => {
  test("rewrites only the named arguments", () => {
    const out = patchImageProps(SRC, "o_img", { x: 12.5, fade: 0.25 });
    expect(out).toContain(
      'image("/assets/gear-9f3a2c11.png", 12.5, 20, 40, 20, 0, 0, 0.25, "o_img")',
    );
  });

  test("every prop has its own argument", () => {
    const out = patchImageProps(SRC, "o_img", {
      src: "/assets/other.png",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      rot: 270,
      flip: 1,
      fade: 0,
    });
    expect(out).toContain('image("/assets/other.png", 1, 2, 3, 4, 270, 1, 0, "o_img")');
  });

  test("leaves the rest of the file byte for byte", () => {
    const out = patchImageProps(SRC, "o_img", { w: 80 });
    expect(out).toBe(SRC.replace("40, 20, 0, 0, 0.5", "80, 20, 0, 0, 0.5"));
  });

  test("keeps authored expressions in the arguments it does not touch", () => {
    const src = `image("/a.png", x0, y0, 40, 20, 0, 0, 0.5, "o_img");\n`;
    const out = patchImageProps(src, "o_img", { fade: 1 });
    expect(out).toBe(`image("/a.png", x0, y0, 40, 20, 0, 0, 1, "o_img");\n`);
  });

  test("rounds to the two decimals the rest of the source writes", () => {
    expect(patchImageProps(SRC, "o_img", { x: 1 / 3 })).toContain(", 0.33, 20,");
  });

  test("rewrites the call with the id asked for, not the first image", () => {
    const src = `image("/a.png", 0, 0, 1, 1, 0, 0, 0, "o_one");\nimage("/b.png", 0, 0, 9, 9, 0, 0, 0, "o_two");\n`;
    const out = patchImageProps(src, "o_two", { w: 5 });
    expect(out).toBe(
      `image("/a.png", 0, 0, 1, 1, 0, 0, 0, "o_one");\nimage("/b.png", 0, 0, 5, 9, 0, 0, 0, "o_two");\n`,
    );
  });

  test("refuses a call it cannot find", () => {
    expect(() => patchImageProps(SRC, "o_nope", { x: 1 })).toThrow(/no image/);
  });

  test("refuses an empty patch", () => {
    expect(() => patchImageProps(SRC, "o_img", {})).toThrow(/no props/);
  });

  test("refuses a prop the call has no argument for", () => {
    const short = `image("/a.png", 0, 0, 1, 1, "o_img");\n`;
    expect(() => patchImageProps(short, "o_img", { fade: 1 })).toThrow(/no fade argument/);
  });

  test("a patch that leaves the source identical is still a rewrite, not a corruption", () => {
    expect(patchImageProps(SRC, "o_img", { x: 10 })).toBe(SRC);
  });
});
