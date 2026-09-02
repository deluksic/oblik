import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import {
  hitTest,
  hitsNear,
  namedStrokesThrough,
  snapBoundPoint,
  snapLineCarrier,
  snapProfile,
  snapStrokeCarrier,
} from "./pick";

const A = {
  id: "o_a",
  occ: 0,
  kind: "point",
  value: { kind: "point", x: 0, y: 0 },
  bind: "A",
  editable: true,
  stack: [{ file: "scene.ts", line: 10, column: 4, name: "build" }],
} as TraceNode;

const SEG = {
  id: "o_s",
  occ: 0,
  kind: "segment",
  value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
  editable: false,
  stack: [{ file: "scene.ts", line: 16, column: 4 }],
} as TraceNode;

const camera = { x: 0, y: 0, scale: 48 };
const size = { w: 800, h: 600 };

describe("snapBoundPoint", () => {
  test("snaps to a named point within range", () => {
    const s = snapBoundPoint([A], { x: 0.1, y: 0 }, 0.3);
    expect(s?.bind).toBe("A");
  });

  test("ignores unbound and far points", () => {
    const far: TraceNode = { ...A, bind: "B", value: { kind: "point", x: 9, y: 9 } };
    const anon: TraceNode = { ...A, bind: undefined, id: "o_z" };
    expect(snapBoundPoint([far, anon], { x: 0, y: 0 }, 0.3)).toBeNull();
  });

  test("keys restrict snap and print the mention", () => {
    const hidden: TraceNode = {
      ...A,
      id: "o_hid",
      bind: "hidden",
      value: { kind: "point", x: 0.05, y: 0 },
    };
    const keys = new Set(["o_a:0"]);
    const s = snapBoundPoint([A, hidden], { x: 0, y: 0 }, 0.3, {
      keys,
      print: (n) => (n.id === "o_a" ? "plate.origin" : n.bind),
    });
    expect(s).toMatchObject({ bind: "plate.origin", id: "o_a" });
    expect(snapBoundPoint([hidden], { x: 0.05, y: 0 }, 0.3, { keys })).toBeNull();
  });
});

describe("hitTest", () => {
  test("prefers points over segments at the same location", () => {
    const hit = hitTest([SEG, A], { x: 0, y: 0 }, camera, size);
    expect(hit?.kind).toBe("point");
  });

  test("picks a nearby segment", () => {
    const hit = hitTest([SEG], { x: 2, y: 0.05 }, camera, size);
    expect(hit?.id).toBe("o_s");
  });

  test("keeps endpoint points in range when the click is closer to the stroke", () => {
    const hit = hitTest([SEG, A], { x: 0.09, y: 0.04 }, camera, size);
    expect(hit?.kind).toBe("point");
  });

  test("prefers points over overlapping circle and line", () => {
    const P = {
      ...A,
      id: "o_p",
      bind: "P",
      value: { kind: "point", x: 2, y: 0 },
    } as TraceNode;
    const CIRCLE = {
      id: "o_c",
      occ: 0,
      kind: "circle",
      value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
      editable: false,
      stack: [{ file: "scene.ts", line: 14, column: 4 }],
    } as TraceNode;
    const LINE = {
      id: "o_l",
      occ: 0,
      kind: "line",
      value: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      editable: false,
      stack: [{ file: "scene.ts", line: 12, column: 4 }],
    } as TraceNode;
    const hits = hitsNear([CIRCLE, LINE, P], { x: 2, y: 0 }, camera, size);
    expect(hits[0]?.id).toBe("o_p");
  });
});

describe("snapLineCarrier", () => {
  test("snaps to the nearest named line-like stroke", () => {
    const ground = {
      id: "o_g",
      occ: 0,
      kind: "line",
      bind: "ground",
      value: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      editable: false,
      stack: [],
    } as TraceNode;
    const hit = snapLineCarrier([ground, A], { x: 1, y: 0.05 }, camera, size);
    expect(hit).toEqual({ bind: "ground", geom: ground.value });
  });

  test("snaps to parallel offset lines as carriers", () => {
    const ground = {
      id: "o_g",
      occ: 0,
      kind: "line",
      bind: "ground",
      value: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      editable: false,
      stack: [],
    } as TraceNode;
    const shelf = {
      id: "o_par",
      occ: 0,
      kind: "parallelLine",
      bind: "shelf",
      value: {
        kind: "parallelLine",
        line: { kind: "line", origin: { x: 0, y: 1.8 }, direction: { x: 1, y: 0 } },
        distance: 1.8,
      },
      editable: true,
      stack: [],
    } as TraceNode;
    expect(snapLineCarrier([shelf], { x: 2, y: 1.85 }, camera, size)).toEqual({
      bind: "shelf",
      geom: shelf.value,
    });
    const hit = snapLineCarrier([ground, shelf], { x: 2, y: 0.05 }, camera, size);
    expect(hit).toEqual({ bind: "ground", geom: ground.value });
  });
});

describe("profile pick", () => {
  const Pa = { x: 0, y: 0 };
  const Pb = { x: 4, y: 0 };
  const Pc = { x: 0, y: 3 };
  const ab = { kind: "segment" as const, a: Pa, b: Pb };
  const bc = { kind: "segment" as const, a: Pb, b: Pc };
  const ca = { kind: "segment" as const, a: Pc, b: Pa };
  const AB = {
    id: "o_ab",
    occ: 0,
    kind: "segment",
    bind: "ab",
    value: ab,
    editable: false,
    stack: [],
  } as TraceNode;
  const BC = {
    id: "o_bc",
    occ: 0,
    kind: "segment",
    bind: "bc",
    value: bc,
    editable: false,
    stack: [],
  } as TraceNode;
  const CA = {
    id: "o_ca",
    occ: 0,
    kind: "segment",
    bind: "ca",
    value: ca,
    editable: false,
    stack: [],
  } as TraceNode;
  const FACE = {
    id: "o_pr",
    occ: 0,
    kind: "region",
    bind: "face",
    value: {
      kind: "region",
      outer: [
        { a: Pa, b: Pb, carrier: ab },
        { a: Pb, b: Pc, carrier: bc },
        { a: Pc, b: Pa, carrier: ca },
      ],
      holes: [],
    },
    editable: false,
    stack: [],
  } as TraceNode;

  test("fill is last behind a point and a stroke", () => {
    const hits = hitsNear([FACE, SEG, A], { x: 0.05, y: 0.04 }, camera, size);
    expect(hits[0]?.kind).toBe("point");
    expect(hits[hits.length - 1]?.kind).toBe("region");
  });

  test("fill is last behind a stroke in the interior-adjacent edge", () => {
    const hits = hitsNear([FACE, SEG], { x: 2, y: 0.04 }, camera, size);
    expect(hits[0]?.kind).toBe("segment");
    expect(hits[hits.length - 1]?.kind).toBe("region");
  });

  test("empty interior still picks the profile", () => {
    const hit = hitTest([FACE], { x: 1, y: 1 }, camera, size);
    expect(hit?.id).toBe("o_pr");
  });

  test("namedStrokesThrough keeps only strokes that pass the vertex", () => {
    expect([...namedStrokesThrough([AB, BC, CA], Pa, camera)].toSorted()).toEqual(["ab", "ca"]);
    expect([...namedStrokesThrough([AB, BC, CA], Pb, camera)].toSorted()).toEqual(["ab", "bc"]);
  });

  test("namedStrokesThrough with keys uses that invocation, not occ 0", () => {
    const ab0 = { ...AB, occ: 0 };
    const ab1 = {
      ...AB,
      occ: 1,
      value: { kind: "segment" as const, a: { x: 10, y: 0 }, b: { x: 14, y: 0 } },
    };
    const at = { x: 10, y: 0 };
    expect([...namedStrokesThrough([ab0, ab1], at, camera)]).toEqual(["ab"]);
    expect([
      ...namedStrokesThrough([ab0, ab1], at, camera, undefined, {
        keys: new Set(["o_ab:1"]),
        print: (n) => n.bind,
      }),
    ]).toEqual(["ab"]);
  });

  test("snapStrokeCarrier ignores a nearby stroke that misses the vertex", () => {
    const throughA = snapStrokeCarrier([AB, BC], { x: 2, y: 1.5 }, camera, size, { through: Pa });
    expect(throughA).toBeNull();
    const onAb = snapStrokeCarrier([AB, BC], { x: 2, y: 0.02 }, camera, size, { through: Pa });
    expect(onAb?.bind).toBe("ab");
    const onBc = snapStrokeCarrier([AB, BC], { x: 2, y: 1.5 }, camera, size);
    expect(onBc?.bind).toBe("bc");
  });

  test("snapProfile picks a fill and ignores a nearby point", () => {
    expect(snapProfile([FACE, A], { x: 1, y: 1 }, camera, size)?.bind).toBe("face");
    expect(snapProfile([FACE, A], { x: 1, y: 1 }, camera, size)?.id).toBe("o_pr");
    expect(snapProfile([FACE, A], { x: 0, y: 0 }, camera, size)?.bind).toBe("face");
    expect(snapProfile([A], { x: 1, y: 1 }, camera, size)).toBeNull();
  });

  test("region fill picks before the stock profile", () => {
    const FACE_REGION = {
      id: "o_face",
      occ: 0,
      kind: "csg2",
      bind: "face",
      value: {
        kind: "csg2",
        op: "union",
        of: [FACE.value],
      },
      editable: false,
      stack: [{ file: "scene.ts", line: 40, column: 4 }],
    } as TraceNode;
    const hits = hitsNear([FACE, FACE_REGION], { x: 1, y: 1 }, camera, size);
    expect(hits[0]?.id).toBe("o_face");
    expect(hits.some((n) => n.id === "o_pr")).toBe(true);
  });

  test("snapProfile with keys uses that invocation, not occ 0", () => {
    const face1 = {
      ...FACE,
      occ: 1,
      value: {
        kind: "region" as const,
        outer: [
          {
            a: { x: 10, y: 0 },
            b: { x: 14, y: 0 },
            carrier: { kind: "segment" as const, a: { x: 10, y: 0 }, b: { x: 14, y: 0 } },
          },
          {
            a: { x: 14, y: 0 },
            b: { x: 10, y: 3 },
            carrier: { kind: "segment" as const, a: { x: 14, y: 0 }, b: { x: 10, y: 3 } },
          },
          {
            a: { x: 10, y: 3 },
            b: { x: 10, y: 0 },
            carrier: { kind: "segment" as const, a: { x: 10, y: 3 }, b: { x: 10, y: 0 } },
          },
        ],
        holes: [],
      },
    };
    const at = { x: 11, y: 1 };
    expect(snapProfile([FACE, face1], at, camera, size)?.id).toBe("o_pr");
    expect(
      snapProfile([FACE, face1], at, camera, size, undefined, {
        keys: new Set(["o_pr:1"]),
        print: (n) => n.bind,
      })?.id,
    ).toBe("o_pr");
  });
});
