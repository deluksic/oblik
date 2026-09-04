import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (/\.(tsx?)$/.test(name)) out.push(abs);
  }
  return out;
}

describe("solid conventions", () => {
  test("does not import onSettled from solid-js", () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, "utf8");
      if (/\bonSettled\b/.test(src) && /from\s+["']solid-js["']/.test(src)) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("does not pass live nodes with non-undefined assertions", () => {
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (!file.endsWith(".tsx")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/node=\{[^}]*\(\)!/.test(src)) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
  });
});
