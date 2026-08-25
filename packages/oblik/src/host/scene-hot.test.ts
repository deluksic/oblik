import { describe, expect, test, vi } from "vitest";

import type { Scene } from "../eval/scene";
import { applyHotScenes, notifyHelperHot, registerSceneHot } from "./scene-hot";

const SHELF = { kind: "euclid2", title: "Shelf", build: () => ({}) } as Scene;
const RING = { kind: "euclid2", title: "Ring", build: () => ({}) } as Scene;

describe("applyHotScenes", () => {
  test("caches every updated module by glob key, not only the active scene", () => {
    const onHot = vi.fn();
    registerSceneHot({ onHot });
    applyHotScenes(
      ["./scenes/shelf.ts", "./scenes/ring.ts"],
      [{ default: SHELF }, undefined],
    );
    expect(onHot).toHaveBeenCalledTimes(1);
    expect(onHot).toHaveBeenCalledWith("./scenes/shelf.ts", SHELF);

    onHot.mockClear();
    applyHotScenes(
      ["./scenes/shelf.ts", "./scenes/ring.ts"],
      [undefined, { default: RING }],
    );
    expect(onHot).toHaveBeenCalledWith("./scenes/ring.ts", RING);
    registerSceneHot(null);
  });

  test("notifyHelperHot runs the helper callback", async () => {
    const onHelperHot = vi.fn();
    registerSceneHot({ onHot: vi.fn(), onHelperHot });
    notifyHelperHot();
    await new Promise((r) => queueMicrotask(r));
    expect(onHelperHot).toHaveBeenCalledTimes(1);
    registerSceneHot(null);
  });
});
