import { describe, expect, test } from "vitest";

import { EMPTY_SCOPE } from "../euclid2/tools/scope";
import type { TraceNode } from "../eval/context";
import { brushAddHits } from "./pick";

function node(id: string): TraceNode {
  return {
    id,
    occ: 0,
    kind: "point",
    value: { kind: "point", x: 0, y: 0 },
    editable: false,
    stack: [],
  };
}

describe("brushAddHits", () => {
  test("keeps only geom this scope can mention", () => {
    const named = node("o_drill");
    const priv = node("o_edge");
    const scope = {
      ...EMPTY_SCOPE,
      byId: { o_drill: { kind: "ref" as const, name: "plate.drill" } },
    };
    expect(brushAddHits([priv, named], scope).map((n) => n.id)).toEqual(["o_drill"]);
  });

  test("hits nothing without a scope", () => {
    expect(brushAddHits([node("o_drill")])).toEqual([]);
  });
});
