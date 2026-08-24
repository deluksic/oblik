import { expect, test } from "vitest";

import { layoutNumberSliders } from "./hud";
import type { NumberGizmo } from "./widgets";

function num(n: number, site = "f.ts:1:1"): NumberGizmo {
  return {
    kind: "number",
    site,
    id: `${site}#0`,
    at: { file: "f.ts", line: 1, column: 1 },
    n,
    label: "reach",
    min: 0,
    max: 10,
    step: 0.1,
  };
}

test("number sliders stack from the top-left", () => {
  const a = num(1, "f.ts:1:1");
  const b = num(2, "f.ts:2:1");
  const layouts = layoutNumberSliders([a, b], 800, 600);
  expect(layouts[0]?.panel.x).toBe(12);
  expect(layouts[0]?.panel.y).toBe(12);
  expect(layouts[1]?.panel.y).toBeGreaterThan(layouts[0]!.panel.y);
  expect(layouts[1]!.panel.y + layouts[1]!.panel.h).toBeLessThan(300);
});
