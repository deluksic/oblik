import { expect, test } from "vitest";
import MagicString from "magic-string";

import { originalFromMap, sourceMapFromCode, viteUrlForRepoFile } from "./map-stack";

test("paper demo files map to the Vite app-root URL", () => {
  expect(
    viteUrlForRepoFile("apps/paper/src/demo/floor-plan.ts", "/workspace", "/workspace/apps/paper"),
  ).toBe("/src/demo/floor-plan.ts");
  expect(
    viteUrlForRepoFile(
      "packages/geom/src/geom.ts",
      "/workspace",
      "/workspace/apps/paper",
    ),
  ).toBe("/@fs/workspace/packages/geom/src/geom.ts");
});

test("originalFromMap undoes a transform that inserted lines", () => {
  const original = `function doorLeaf() {
  return segment(hinge, tip);
}
`;
  const ms = new MagicString(original);
  ms.prepend('import { segment } from "geom";\n\n');
  const generated = ms.toString();
  const map = ms.generateMap({ hires: true, source: "floor-plan.ts" });
  const genLine = generated.split("\n").findIndex((l) => l.includes("return segment")) + 1;
  const orig = originalFromMap(map, genLine, 10);
  expect(orig?.line).toBe(2);
});

test("reads an inline sourceMappingURL", () => {
  const original = "export const n = 1;\n";
  const ms = new MagicString(original);
  ms.prepend("/* preamble */\n");
  const map = ms.generateMap({ hires: true, source: "a.ts" });
  const b64 = Buffer.from(JSON.stringify(map)).toString("base64");
  const code = `${ms.toString()}\n//# sourceMappingURL=data:application/json;base64,${b64}\n`;
  const parsed = sourceMapFromCode(code);
  expect(parsed).not.toBeNull();
  expect(originalFromMap(parsed!, 2, 14)?.line).toBe(1);
});
