import { describe, expect, test } from "vitest";

import { parseOblikSceneSource } from "./catalog";

const src = `import { point, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Shelf",
  build() {
    const A = point(0, 0, "o_a");
    return { A };
  },
});
`;

describe("parseOblikSceneSource", () => {
  test("reads title and kind from defineScene", () => {
    const e = parseOblikSceneSource("/repo/apps/demo/src/scenes/shelf.ts", src, "apps/demo/src/scenes/shelf.ts");
    expect(e).toEqual({
      id: "shelf",
      file: "shelf.ts",
      path: "apps/demo/src/scenes/shelf.ts",
      title: "Shelf",
      kind: "euclid2",
    });
  });

  test("errors when defineScene is missing", () => {
    const e = parseOblikSceneSource("/repo/x.ts", "export const x = 1;", "x.ts");
    expect(e.error).toMatch(/defineScene/);
  });
});
