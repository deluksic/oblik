import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));

describe("construction hover paint", () => {
  test("hover reuses selected-paint so ink turns cream/white", () => {
    const ink = fs.readFileSync(path.join(dir, "Ink.tsx"), "utf8");
    const hud = fs.readFileSync(path.join(dir, "Hud.tsx"), "utf8");
    expect(ink).toMatch(/const white = selected \|\| hot/);
    expect(ink).toMatch(/props\.selected \|\| props\.hot/);
    expect(hud).toMatch(/props\.selected \|\| props\.hot/);
  });
});
