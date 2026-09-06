import path from "node:path";

import { describe, expect, test } from "vitest";

import { appSrcImportKey, isUserAppSource } from "./user-source";

describe("isUserAppSource", () => {
  const app = "/repo/apps/demo";

  test("accepts demo src modules", () => {
    expect(isUserAppSource(app, "/repo/apps/demo/src/layout/plate.ts")).toBe(true);
    expect(isUserAppSource(app, "/repo/apps/demo/src/scenes/shelf.ts")).toBe(true);
  });

  test("rejects dts and files outside the app", () => {
    expect(isUserAppSource(app, "/repo/apps/demo/src/vite-env.d.ts")).toBe(false);
    expect(isUserAppSource(app, "/repo/packages/oblik/src/index.ts")).toBe(false);
  });

  test("appSrcImportKey is relative to src/", () => {
    expect(appSrcImportKey(app, path.join(app, "src/layout/plate.ts"))).toBe("./layout/plate.ts");
  });
});
