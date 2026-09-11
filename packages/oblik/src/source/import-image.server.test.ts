import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { contentHash, writeImageAsset } from "./import-image.server";

let publicDir = "";

beforeEach(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "oblik-assets-"));
});

afterEach(() => {
  fs.rmSync(publicDir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const OTHER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);

describe("contentHash", () => {
  test("is stable, short, hex, and content-dependent", () => {
    const h = contentHash(PNG);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash(Buffer.from(PNG))).toBe(h);
    expect(contentHash(OTHER)).not.toBe(h);
  });
});

describe("writeImageAsset", () => {
  test("creates the assets directory the demo does not have yet", () => {
    expect(fs.existsSync(path.join(publicDir, "assets"))).toBe(false);
    const stored = writeImageAsset(publicDir, "gear", "png", PNG);
    expect(fs.existsSync(path.join(publicDir, "assets"))).toBe(true);
    expect(fs.readFileSync(stored.path)).toEqual(PNG);
  });

  test("names the file by slug and content hash and returns its served URL", () => {
    const stored = writeImageAsset(publicDir, "gear", "png", PNG);
    expect(stored.name).toBe(`gear-${contentHash(PNG)}.png`);
    expect(stored.url).toBe(`/assets/gear-${contentHash(PNG)}.png`);
    expect(stored.deduped).toBe(false);
  });

  test("identical bytes reuse the file instead of writing twice", () => {
    const first = writeImageAsset(publicDir, "gear", "png", PNG);
    const second = writeImageAsset(publicDir, "gear", "png", Buffer.from(PNG));
    expect(second.url).toBe(first.url);
    expect(second.deduped).toBe(true);
    expect(fs.readdirSync(path.join(publicDir, "assets"))).toEqual([first.name]);
  });

  test("different bytes can never collide or overwrite", () => {
    const a = writeImageAsset(publicDir, "gear", "png", PNG);
    const b = writeImageAsset(publicDir, "gear", "png", OTHER);
    expect(a.url).not.toBe(b.url);
    expect(fs.readdirSync(path.join(publicDir, "assets")).toSorted()).toEqual(
      [a.name, b.name].toSorted(),
    );
    expect(fs.readFileSync(a.path)).toEqual(PNG);
    expect(fs.readFileSync(b.path)).toEqual(OTHER);
  });

  test("the slug the client sends cannot steer the path", () => {
    const stored = writeImageAsset(publicDir, "../../escape", "png", PNG);
    expect(path.dirname(stored.path)).toBe(path.join(publicDir, "assets"));
    expect(stored.name).toBe(`escape-${contentHash(PNG)}.png`);
  });

  test("an empty slug still stores something nameable", () => {
    expect(writeImageAsset(publicDir, "", "png", PNG).name).toMatch(/^image-[0-9a-f]{8}\.png$/);
  });
});
