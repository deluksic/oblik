import { describe, expect, test } from "vitest";

import { normalizeSceneRelPath } from "./scene-path";
import { resolveSceneFileAbs } from "./scene-path.server";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("normalizeSceneRelPath", () => {
  test("maps app-relative vite paths onto catalog module path", () => {
    expect(
      normalizeSceneRelPath("src/scenes/shelf.ts", "apps/demo/src/scenes/shelf.ts"),
    ).toBe("apps/demo/src/scenes/shelf.ts");
  });

  test("leaves unrelated paths unchanged", () => {
    expect(normalizeSceneRelPath("lib/util.ts", "apps/demo/src/scenes/shelf.ts")).toBe("lib/util.ts");
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
});
