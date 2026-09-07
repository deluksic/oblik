import path from "node:path";

import { describe, expect, test } from "vitest";

import { moduleRefToSpecifier, relativeModuleSpecifier, toolModuleAbs } from "./tool-path";

const root = path.resolve("/work/app");
const scene = path.join(root, "src/scenes/tool-lab.ts");
const layout = path.join(root, "src/layout/tools.ts");

describe("tool path mapping", () => {
  test("maps a vite-root pathname to an fs path", () => {
    expect(toolModuleAbs("/src/layout/tools.ts", root)).toBe(layout);
  });

  test("maps /@fs/ urls to absolute paths", () => {
    expect(toolModuleAbs(`/@fs${layout}`, root)).toBe(layout);
  });

  test("computes a relative specifier from the dest file", () => {
    expect(moduleRefToSpecifier(scene, "/src/layout/tools.ts", root)).toBe(
      "../layout/tools",
    );
  });

  test("same-file modules yield no specifier", () => {
    expect(relativeModuleSpecifier(scene, scene)).toBe("");
    expect(relativeModuleSpecifier(layout, layout)).toBe("");
  });

  test("sibling modules get a ./ specifier", () => {
    const a = path.join(root, "src/things/a.ts");
    const b = path.join(root, "src/things/b.ts");
    expect(relativeModuleSpecifier(a, b)).toBe("./b");
  });
});
