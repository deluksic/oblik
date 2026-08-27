import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { analyzeMentions, fnNamed, insertPointNames } from "./mention";

const here = path.dirname(fileURLToPath(import.meta.url));
const plateSrc = fs.readFileSync(
  path.resolve(here, "../../../../apps/demo/src/layout/mounting-plate.ts"),
  "utf8",
);

describe("analyzeMentions", () => {
  test("reads the mounting plate helper bag and once-ids", () => {
    const file = analyzeMentions(plateSrc, "apps/demo/src/layout/mounting-plate.ts");
    const plate = fnNamed(file, "mountingPlateLayout");
    expect(plate).toBeDefined();
    expect(plate!.params).toEqual([]);
    expect(plate!.consts).toEqual(
      expect.arrayContaining(["origin", "opp", "hBottom", "hLeft", "drill", "c0"]),
    );
    expect(plate!.return.kind).toBe("bag");
    if (plate!.return.kind !== "bag") throw new Error("expected bag");
    const fields = Object.fromEntries(plate!.return.fields.map((f) => [f.field, f.id]));
    expect(fields.origin).toBe("o_origin");
    expect(fields.hBottom).toBe("o_in");
    expect(fields.drill).toBe("o_drill");
    expect(fields.c0).toBe("o_c0");
    expect(fields.hLeft).toBeUndefined();
    expect(plate!.onceIds).toEqual(expect.arrayContaining(["o_origin", "o_in", "o_drill", "o_h3"]));
    expect(plate!.ids).toEqual(plate!.onceIds);
    expect(plate!.bindToId.hLeft).toBe("o_inl");
    expect(insertPointNames(plate!).has("hLeft")).toBe(true);
    expect(insertPointNames(plate!).has("hBottom")).toBe(true);
  });

  test("records caller const and destructure bindings", () => {
    const src = `import { mountingPlateLayout } from "../layout/mounting-plate";
import { defineScene } from "oblik";
export default defineScene({
  kind: "euclid2",
  title: "t",
  build() {
    const plate = mountingPlateLayout();
    const { drill, origin: o } = mountingPlateLayout();
    mountingPlateLayout();
  },
});
`;
    const file = analyzeMentions(src, "apps/demo/src/scenes/mounting-plate.ts");
    const build = fnNamed(file, "build");
    expect(build?.calls).toEqual([
      {
        callee: "mountingPlateLayout",
        line: 7,
        column: 19,
        binding: { kind: "const", name: "plate" },
      },
      {
        callee: "mountingPlateLayout",
        line: 8,
        column: 34,
        binding: { kind: "destructure", map: { drill: "drill", origin: "o" } },
      },
      {
        callee: "mountingPlateLayout",
        line: 9,
        column: 5,
        binding: { kind: "none" },
      },
    ]);
    expect(build?.consts).toEqual(["plate", "drill", "o"]);
  });

  test("whole-value return and missing return", () => {
    const src = `import { point } from "oblik";
function one() {
  const p = point(0, 0, "o_p");
  return p;
}
function two() {
  point(1, 1, "o_q");
}
function other() {
  return 1;
}
`;
    const file = analyzeMentions(src, "h.ts");
    expect(fnNamed(file, "one")?.return).toEqual({ kind: "value", bind: "p", id: "o_p" });
    expect(fnNamed(file, "two")?.return).toEqual({ kind: "none" });
    expect(fnNamed(file, "other")?.return).toEqual({ kind: "other" });
  });

  test("looped ids are not once-ids; nested function is a separate scope", () => {
    const src = `import { point, circle } from "oblik";
function plate(origin) {
  const o = point(0, 0, "o_origin");
  for (let i = 0; i < 4; i++) {
    const p = point(i, 0, "o_p");
    circle(p, 0.1, "o_hole");
  }
  function hole(q) {
    circle(q, 0.2, "o_h");
  }
  hole(o);
}
`;
    const file = analyzeMentions(src, "loop.ts");
    const plate = fnNamed(file, "plate");
    expect(plate?.params).toEqual(["origin"]);
    expect(plate?.consts).toEqual(["o"]);
    expect(plate?.onceIds).toEqual(["o_origin"]);
    expect(plate?.ids).toEqual(["o_origin", "o_p", "o_hole"]);
    expect(insertPointNames(plate!).has("p")).toBe(false);
    expect(insertPointNames(plate!).has("origin")).toBe(true);
    const hole = fnNamed(file, "hole");
    expect(hole?.ids).toEqual(["o_h"]);
    expect(hole?.onceIds).toEqual(["o_h"]);
    expect(hole?.params).toEqual(["q"]);
    expect(hole?.closures).toEqual(expect.arrayContaining(["o", "origin"]));
  });

  test("inline ctor in a bag field keeps the trailing id", () => {
    const src = `import { parallelLine, point } from "oblik";
function plate() {
  const bottom = point(0, 0, "o_b");
  return { extra: parallelLine(bottom, 0.4, "o_in") };
}
`;
    const file = analyzeMentions(src, "inl.ts");
    const ret = fnNamed(file, "plate")?.return;
    expect(ret).toEqual({ kind: "bag", fields: [{ field: "extra", id: "o_in" }] });
  });
});
