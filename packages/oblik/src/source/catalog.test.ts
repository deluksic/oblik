import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  findDuplicateIds,
  parseOblikSceneSource,
  scanAnnotationsBundle,
  scanOblikCatalog,
  sceneLoadersModule,
} from "./catalog";
import { listUserAppSources } from "./user-source";

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
    const e = parseOblikSceneSource(src, "apps/demo/src/scenes/shelf.ts", "shelf.ts");
    expect(e).toEqual({
      id: "shelf",
      file: "shelf.ts",
      path: "apps/demo/src/scenes/shelf.ts",
      title: "Shelf",
      kind: "euclid2",
    });
  });

  test("a nested scene gets a path-based id unique across folders", () => {
    const e = parseOblikSceneSource(src, "apps/demo/src/scenes/gear/tree.ts", `gear${path.sep}tree.ts`);
    expect(e).toEqual({
      id: "gear/tree",
      file: "gear/tree.ts",
      path: "apps/demo/src/scenes/gear/tree.ts",
      title: "Shelf",
      kind: "euclid2",
    });
  });

  test("title stays undefined when the scene declares none", () => {
    const plain = `import { defineScene } from "oblik";
export default defineScene({ kind: "euclid2", build() {} });
`;
    const e = parseOblikSceneSource(plain, "apps/demo/src/scenes/plain.ts", "plain.ts");
    expect(e.title).toBeUndefined();
    expect(e.id).toBe("plain");
  });

  test("reads a figure scene kind", () => {
    const figure = `import { defineScene, paint, style } from "oblik";
export default defineScene({
  kind: "figure",
  title: "Plate figure",
  build() {},
});
`;
    const e = parseOblikSceneSource(figure, "apps/demo/src/scenes/plate-figure.ts", "plate-figure.ts");
    expect(e).toEqual({
      id: "plate-figure",
      file: "plate-figure.ts",
      path: "apps/demo/src/scenes/plate-figure.ts",
      title: "Plate figure",
      kind: "figure",
    });
  });

  test("errors when defineScene is missing", () => {
    const e = parseOblikSceneSource("export const x = 1;", "x.ts", "x.ts");
    expect(e.error).toMatch(/defineScene/);
  });

  test("sceneLoadersModule lists every glob key with HMR accept", () => {
    const keys = ["./scenes/shelf.ts", "./scenes/triangle.ts"];
    const mod = sceneLoadersModule(keys);
    expect(mod).toContain('"./scenes/shelf.ts": () => import("./scenes/shelf.ts")');
    expect(mod).toContain('"./scenes/triangle.ts": () => import("./scenes/triangle.ts")');
    expect(mod).toContain("/* __oblik_scene_hmr */");
    expect(mod).toContain("applyHotScenes");
    expect(mod).not.toContain("notifyHelperHot");
    expect(mod).not.toContain('import "./layout/');
  });
});

describe("scanOblikCatalog", () => {
  test("walks scene subfolders and keeps same-basename scenes distinct", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oblik-scenes-"));
    const sceneDir = path.join(root, "apps", "demo", "src", "scenes");
    fs.mkdirSync(path.join(sceneDir, "gear"), { recursive: true });
    fs.mkdirSync(path.join(sceneDir, "layout"), { recursive: true });
    fs.writeFileSync(path.join(sceneDir, "tree.ts"), src);
    fs.writeFileSync(path.join(sceneDir, "gear", "tree.ts"), src);
    fs.writeFileSync(path.join(sceneDir, "layout", "tree.ts"), src);
    fs.writeFileSync(path.join(sceneDir, "helper.ts"), "export const x = 1;");
    const entries = scanOblikCatalog(sceneDir, root);
    expect(entries.map((e) => e.id)).toEqual(["gear/tree", "layout/tree", "tree"]);
    expect(entries.every((e) => e.error === undefined)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("findDuplicateIds", () => {
  test("reports every constructor site that shares an id", () => {
    expect(
      findDuplicateIds([
        { id: "o_c2", file: "apps/demo/src/layout/mounting-plate.ts", line: 25, column: 13 },
        { id: "o_ok", file: "apps/demo/src/scenes/shelf.ts", line: 4, column: 1 },
        { id: "o_c2", file: "apps/demo/src/scenes/truss.ts", line: 17, column: 15 },
      ]),
    ).toEqual([
      {
        id: "o_c2",
        sites: [
          { file: "apps/demo/src/layout/mounting-plate.ts", line: 25, column: 13 },
          { file: "apps/demo/src/scenes/truss.ts", line: 17, column: 15 },
        ],
      },
    ]);
  });

  test("a for-loop with one call site is not a collision", () => {
    expect(
      findDuplicateIds([
        { id: "o_ring", file: "apps/demo/src/scenes/shared-loop.ts", line: 16, column: 7 },
      ]),
    ).toEqual([]);
  });
});

describe("scanAnnotationsBundle", () => {
  test("demo user sources have unique ids", () => {
    const demo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../apps/demo",
    );
    const workspace = path.resolve(demo, "../..");
    const { collisions } = scanAnnotationsBundle(listUserAppSources(demo), workspace);
    expect(collisions).toEqual([]);
  });
});
