import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { normalizeSceneRelPath } from "./scene-path";
import { resolveSceneFileAbs } from "./scene-path.server";

describe("normalizeSceneRelPath", () => {
  test("maps app-relative vite paths onto catalog module path", () => {
    expect(normalizeSceneRelPath("src/scenes/shelf.ts", "apps/demo/src/scenes/shelf.ts")).toBe(
      "apps/demo/src/scenes/shelf.ts",
    );
  });

  test("does not confuse a helper with a scene that shares the basename", () => {
    expect(
      normalizeSceneRelPath(
        "src/layout/mounting-plate.ts",
        "apps/demo/src/scenes/mounting-plate.ts",
      ),
    ).toBe("src/layout/mounting-plate.ts");
    expect(
      normalizeSceneRelPath(
        "src/layout/mounting-plate.ts",
        "apps/demo/src/layout/mounting-plate.ts",
      ),
    ).toBe("apps/demo/src/layout/mounting-plate.ts");
  });
});

describe("resolveSceneFileAbs", () => {
  test("falls back to sceneDir basename lookup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oblik-"));
    const sceneDir = path.join(root, "apps/demo/src/scenes");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(path.join(sceneDir, "shelf.ts"), "export default null;\n");
    const abs = resolveSceneFileAbs(root, sceneDir, "src/scenes/shelf.ts");
    expect(abs).toBe(path.join(sceneDir, "shelf.ts"));
  });

  test("does not peek a same-named scene for a helper path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oblik-"));
    const sceneDir = path.join(root, "apps/demo/src/scenes");
    const layoutDir = path.join(root, "apps/demo/src/layout");
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.mkdirSync(layoutDir, { recursive: true });
    fs.writeFileSync(path.join(sceneDir, "mounting-plate.ts"), "scene\n");
    fs.writeFileSync(path.join(layoutDir, "mounting-plate.ts"), "helper\n");
    expect(resolveSceneFileAbs(root, sceneDir, "src/layout/mounting-plate.ts")).toBe(
      path.join(layoutDir, "mounting-plate.ts"),
    );
    expect(resolveSceneFileAbs(root, sceneDir, "apps/demo/src/layout/mounting-plate.ts")).toBe(
      path.join(layoutDir, "mounting-plate.ts"),
    );
  });
});
