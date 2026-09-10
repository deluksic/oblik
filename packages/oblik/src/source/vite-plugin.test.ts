import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { HotUpdateOptions, Plugin } from "vite";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { oblikPlugin } from "./vite-plugin";

const SCENE_SRC = `import { point, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Alpha",
  build() {
    const A = point(0, 0, "o_a");
    return { A };
  },
});
`;

const BUNDLE_ID = "\0virtual:oblik-annotations-bundle";
const CATALOG_ID = "\0virtual:oblik-catalog";
const LOADERS_ID = "\0virtual:oblik-loaders";

type FakeNode = { id: string; importers: Set<FakeNode> };

function mkNode(id: string): FakeNode {
  return { id, importers: new Set() };
}

/** `importedBy(scene, loaders)` records that `loaders` imports `scene`. */
function importedBy(mod: FakeNode, ...importers: FakeNode[]): void {
  for (const i of importers) mod.importers.add(i);
}

function fakeGraph(nodes: FakeNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byFile = new Map<string, FakeNode[]>();
  for (const n of nodes) {
    const f = n.id.split("?")[0];
    byFile.set(f, [...(byFile.get(f) ?? []), n]);
  }
  return {
    getModuleById: (id: string) => byId.get(id),
    getModulesByFile: (file: string) => byFile.get(file),
  };
}

type Graph = ReturnType<typeof fakeGraph>;

function hotUpdate(
  plugin: Plugin,
  envName: string,
  graph: Graph,
  file: string,
  modules: FakeNode[] = [],
  type: HotUpdateOptions["type"] = "update",
): FakeNode[] | undefined {
  const hook = plugin.hotUpdate;
  if (typeof hook !== "function") throw new Error("oblikPlugin's hotUpdate must be a plain hook");
  const options: HotUpdateOptions = {
    type,
    file,
    timestamp: 0,
    read: () => "",
    server: {} as HotUpdateOptions["server"],
    modules: modules as HotUpdateOptions["modules"],
  };
  // Vite builds the hook's `this` (the plugin context); the test hands it the two
  // fields the plugin reads, through `Reflect.apply` rather than a fake context
  // object typed as the real one.
  return Reflect.apply(hook, { environment: { name: envName, moduleGraph: graph } }, [
    options,
  ]) as FakeNode[] | undefined;
}

let tmp = "";
let appRoot = "";
let sceneDir = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oblik-hmr-"));
  appRoot = path.join(tmp, "apps/demo");
  sceneDir = path.join(appRoot, "src/scenes");
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, "alpha.ts"), SCENE_SRC);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("oblikPlugin hotUpdate", () => {
  test("ignores non-client environments", () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const scene = path.join(sceneDir, "alpha.ts");
    expect(hotUpdate(plugin, "ssr", fakeGraph([]), scene, [mkNode(scene)])).toBeUndefined();
  });

  test("ignores files outside the app", () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const outside = path.join(tmp, "other/src/scenes/alpha.ts");
    expect(hotUpdate(plugin, "client", fakeGraph([]), outside, [mkNode(outside)])).toBeUndefined();
  });

  test("keeps the full reload for the app entry", () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const entry = path.join(appRoot, "src/main.ts");
    expect(hotUpdate(plugin, "client", fakeGraph([]), entry, [mkNode(entry)])).toBeUndefined();
  });

  test("routes a live scene edit to its importer with the bundle/catalog/loaders extras", () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const scene = path.join(sceneDir, "alpha.ts");
    const bundle = mkNode(BUNDLE_ID);
    const catalog = mkNode(CATALOG_ID);
    const loaders = mkNode(LOADERS_ID);
    const sceneNode = mkNode(scene);
    importedBy(sceneNode, loaders);
    const graph = fakeGraph([bundle, catalog, loaders, sceneNode]);
    // First call sees an empty lastCatalog, so the catalog counts as changed.
    expect(hotUpdate(plugin, "client", graph, scene, [sceneNode])).toEqual([
      sceneNode,
      bundle,
      catalog,
      loaders,
    ]);
    // No filesystem change since: catalog/loaders drop out, bundle stays.
    expect(hotUpdate(plugin, "client", graph, scene, [sceneNode])).toEqual([sceneNode, bundle]);
  });

  test("drops a pruned scene module on create/delete events so the update walk cannot dead-end into a full reload", () => {
    const scene = path.join(sceneDir, "alpha.ts");
    const bundle = mkNode(BUNDLE_ID);
    const catalog = mkNode(CATALOG_ID);
    const loaders = mkNode(LOADERS_ID);
    const pruned = mkNode(scene);
    const graph = fakeGraph([bundle, catalog, loaders, pruned]);
    for (const type of ["create", "delete"] as const) {
      // Fresh plugin per event type: catalogChanged() fires once per instance.
      const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
      const result = hotUpdate(plugin, "client", graph, scene, [pruned], type);
      expect(result).not.toContain(pruned);
      expect(result).toEqual([bundle, catalog, loaders]);
    }
  });

  test("propagates a library edit through the scenes that import it", () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const libFile = path.join(appRoot, "src/layout/tools.ts");
    const bundle = mkNode(BUNDLE_ID);
    const lib = mkNode(libFile);
    const sceneNode = mkNode(path.join(sceneDir, "alpha.ts"));
    importedBy(lib, sceneNode);
    const graph = fakeGraph([bundle, lib, sceneNode]);
    expect(hotUpdate(plugin, "client", graph, libFile, [lib])).toEqual([lib, sceneNode, bundle]);
  });

  test("never routes a library update through the app entry", () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const libFile = path.join(appRoot, "src/layout/tools.ts");
    const bundle = mkNode(BUNDLE_ID);
    const lib = mkNode(libFile);
    const entry = mkNode(path.join(appRoot, "src/main.ts"));
    importedBy(lib, entry);
    const graph = fakeGraph([bundle, lib, entry]);
    const result = hotUpdate(plugin, "client", graph, libFile, [lib]);
    expect(result).toEqual([lib, bundle]);
  });
});
