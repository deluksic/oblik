import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const ink = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Ink.tsx"),
  "utf8",
);

describe("figure selection paint", () => {
  test("does not recolor selected or hovered ink with selected-paint", () => {
    expect(ink).not.toContain("oblik-selected-paint");
  });
});

describe("figure eraser chrome", () => {
  test("eraser outline is error red, under the geometry", () => {
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "View.module.css"),
      "utf8",
    );
    expect(css).toMatch(/\.erase\s+\.outline[\s\S]*oblik-error/);
  });
});
