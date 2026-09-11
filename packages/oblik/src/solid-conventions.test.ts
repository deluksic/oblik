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

  test("does not return a call result from an effect", () => {
    // `createEffect(compute, (v) => fn(v))`: Solid reads a returned value as a
    // cleanup, and a signal setter returns the value it was given — so a concise
    // arrow around a call is a crash waiting for the first camera move.
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (!file.endsWith(".tsx")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/createEffect\([\s\S]{0,200}?,\s*\([^)]*\)\s*=>\s*[A-Za-z_$][\w.$]*\s*\(/.test(src)) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("renders the sidebar inspector inside its sidebar", () => {
    // Removing the `<SelectionSidebar>` wrapper costs the panel its `<aside>` —
    // and with it the padding, the background, the border and the column gap —
    // while every type still checks and no test can see the DOM. So: wherever a
    // pane renders `<SelectionInspector`, it must be inside a
    // `<SelectionSidebar>`.
    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (!file.endsWith(".tsx")) continue;
      const src = fs.readFileSync(file, "utf8");
      // The file that *defines* the sidebar renders its default inspector
      // inside its own `<aside>` — it is the wrapper.
      if (src.includes("export function SelectionSidebar")) continue;
      const inspector = src.indexOf("<SelectionInspector");
      if (inspector < 0) continue;
      const open = src.lastIndexOf("<SelectionSidebar>", inspector);
      const close = src.lastIndexOf("</SelectionSidebar>", inspector);
      if (open < 0 || close > open) offenders.push(path.relative(root, file));
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
