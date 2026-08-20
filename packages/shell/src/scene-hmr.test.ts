import { expect, test } from "vitest";
import { sceneLoadersAcceptTail } from "./vite-plugin.ts";

test("accept snippet keeps glob keys as string literals for Vite's HMR lexer", () => {
  const keys = ["./scenes/ring.scene.ts", "./scenes/plate.scene.ts"];
  const snip = sceneLoadersAcceptTail(keys);
  expect(snip).toMatch(/\/\* __scene_hmr_accept \*\//);
  expect(snip).toMatch(
    /import \{ applyHotScenes, notifyHelperHot \} from "@design-scenes\/shell";/,
  );
  expect(snip).toMatch(
    /import\.meta\.hot\.accept\(\["\.\/scenes\/ring\.scene\.ts",".\/scenes\/plate\.scene\.ts"\],/,
  );
  expect(snip).toMatch(
    /applyHotScenes\(\["\.\/scenes\/ring\.scene\.ts",".\/scenes\/plate\.scene\.ts"\], mods\)/,
  );
  expect(snip).not.toMatch(/\(\) => \{\}/);
});

test("accept snippet wires helper modules to notifyHelperHot", () => {
  const helpers = ["./scenes/plate-layout.ts"];
  const snip = sceneLoadersAcceptTail(["./scenes/plate.scene.ts"], helpers);
  expect(snip).toMatch(/import "\.\/scenes\/plate-layout\.ts";/);
  expect(snip).toMatch(
    /import\.meta\.hot\.accept\(\["\.\/scenes\/plate-layout\.ts"\], \(\) => \{ notifyHelperHot\(\); \}\)/,
  );
  expect(snip).toMatch(
    /import\.meta\.hot\.on\("scene-helper:update", \(\) => \{ notifyHelperHot\(\); \}\)/,
  );
});
