import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import type { HotUpdateOptions, Plugin } from "vite";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { IMAGE_MAX_BYTES } from "./import-image";
import { contentHash } from "./import-image.server";
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
  return Reflect.apply(hook, { environment: { name: envName, moduleGraph: graph } }, [options]) as
    | FakeNode[]
    | undefined;
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

type Middleware = (req: unknown, res: unknown, next: (err?: unknown) => void) => void;

type EndpointResult = { status: number; body: string; nextCalled: boolean };

/** The `url` an upload answered with. */
function storedUrl(res: EndpointResult): string {
  return (JSON.parse(res.body) as { url: string }).url;
}

/**
 * Drive the plugin's own middleware the way Vite does: call `configureServer`
 * with a server that records what gets registered, then hand the last
 * registration a fake request carrying real bytes.
 */
async function callEndpoint(
  plugin: Plugin,
  method: string,
  url: string,
  body: Buffer = Buffer.alloc(0),
): Promise<EndpointResult> {
  const captured: Middleware[] = [];
  const hook = plugin.configureServer;
  if (typeof hook !== "function") {
    throw new Error("oblikPlugin's configureServer must be a plain hook");
  }
  Reflect.apply(hook, {}, [
    {
      config: { root: appRoot, publicDir: path.join(appRoot, "public") },
      middlewares: { use: (fn: Middleware) => captured.push(fn) },
      watcher: { add: () => {}, on: () => {} },
      moduleGraph: fakeGraph([]),
    },
  ]);
  const mw = captured[captured.length - 1];
  if (!mw) throw new Error("the plugin registered no middleware");
  const req = Readable.from(body.length > 0 ? [body] : []) as unknown as {
    method: string;
    url: string;
  };
  req.method = method;
  req.url = url;
  let status = 0;
  let text = "";
  let nextCalled = false;
  await new Promise<void>((resolve) => {
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (chunk?: unknown) => {
        status = res.statusCode;
        text = chunk === undefined ? "" : String(chunk);
        resolve();
      },
    };
    mw(req, res, () => {
      nextCalled = true;
      resolve();
    });
  });
  return { status, body: text, nextCalled };
}

describe("the image endpoints", () => {
  // Deliberately not valid UTF-8: `readBody`'s utf8 decode would mangle 0xff.
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]);
  const other = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01, 0x02, 0x04]);
  const assets = () => path.join(appRoot, "public/assets");

  test("stores the bytes and answers with the URL the node will hold", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const res = await callEndpoint(
      plugin,
      "POST",
      "/__oblik-import-image?slug=Some%20Gear&ext=png",
      PNG,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as {
      ok: boolean;
      url: string;
      name: string;
      deduped: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.url).toBe(`/assets/some-gear-${contentHash(PNG)}.png`);
    expect(body.deduped).toBe(false);
    expect(fs.readdirSync(assets())).toEqual([body.name]);
    expect(fs.readFileSync(path.join(assets(), body.name))).toEqual(PNG);
  });

  test("identical bytes reuse the file; different bytes never collide", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const first = await callEndpoint(
      plugin,
      "POST",
      "/__oblik-import-image?slug=gear&ext=png",
      PNG,
    );
    const again = await callEndpoint(
      plugin,
      "POST",
      "/__oblik-import-image?slug=gear&ext=png",
      PNG,
    );
    const other0 = await callEndpoint(
      plugin,
      "POST",
      "/__oblik-import-image?slug=gear&ext=png",
      other,
    );
    expect(storedUrl(again)).toBe(storedUrl(first));
    expect((JSON.parse(again.body) as { deduped: boolean }).deduped).toBe(true);
    expect(storedUrl(other0)).not.toBe(storedUrl(first));
    expect(fs.readdirSync(assets())).toHaveLength(2);
  });

  test("a format outside the raster list is refused before anything is written", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const res = await callEndpoint(plugin, "POST", "/__oblik-import-image?slug=gear&ext=svg", PNG);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false });
    expect(fs.existsSync(assets())).toBe(false);
  });

  test("a missing extension is refused", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    expect(
      (await callEndpoint(plugin, "POST", "/__oblik-import-image?slug=gear", PNG)).status,
    ).toBe(400);
  });

  test("an empty body is refused", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const res = await callEndpoint(plugin, "POST", "/__oblik-import-image?slug=gear&ext=png");
    expect(res.status).toBe(400);
    expect(fs.existsSync(assets())).toBe(false);
  });

  test("a body over the cap is refused, and still written nowhere", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const big = Buffer.alloc(IMAGE_MAX_BYTES + 1, 7);
    const res = await callEndpoint(plugin, "POST", "/__oblik-import-image?slug=gear&ext=png", big);
    expect(res.status).toBe(413);
    expect(fs.existsSync(assets())).toBe(false);
  });

  test("patches the node's props in the scene source", async () => {
    const scene = path.join(sceneDir, "image.ts");
    const raw = `import { image, defineScene } from "oblik";

export default defineScene({
  kind: "euclid2",
  title: "Ref",
  build() {
    image("/assets/gear-9f3a2c11.png", 0, 0, 40, 20, 0, 0, 0.5, "o_img");
  },
});
`;
    fs.writeFileSync(scene, raw);
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const res = await callEndpoint(
      plugin,
      "POST",
      "/__oblik-image",
      Buffer.from(
        JSON.stringify({
          file: path.relative(tmp, scene),
          id: "o_img",
          props: { x: 5, rot: 90, fade: 1 },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(fs.readFileSync(scene, "utf8")).toContain(
      'image("/assets/gear-9f3a2c11.png", 5, 0, 40, 20, 90, 0, 1, "o_img")',
    );
  });

  test("rejects an empty patch and an id that is not in the file", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const post = (body: object) =>
      callEndpoint(plugin, "POST", "/__oblik-image", Buffer.from(JSON.stringify(body)));
    const file = path.relative(tmp, path.join(sceneDir, "alpha.ts"));
    expect((await post({ file, id: "o_a", props: {} })).status).toBe(400);
    expect((await post({ file, id: "o_missing", props: { x: 1 } })).status).toBe(500);
    expect((await post({ file, id: "o_a", props: { fade: 2 } })).status).toBe(400);
  });

  test("leaves every other route to the next middleware", async () => {
    const plugin = oblikPlugin({ workspaceRoot: tmp, sceneDir });
    const res = await callEndpoint(plugin, "POST", "/__oblik-nope", Buffer.from("{}"));
    expect(res.nextCalled).toBe(true);
  });
});
