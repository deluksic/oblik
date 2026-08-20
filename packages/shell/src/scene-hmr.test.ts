import { expect, test } from "vitest";
import { sceneLoadersAcceptTail } from "./vite-plugin.ts";

test("accept snippet keeps glob keys as string literals for Vite's HMR lexer", () => {
  const keys = ["./scenes/ring.ts", "./scenes/plate.ts"];
  const snip = sceneLoadersAcceptTail(keys);
  expect(snip).toMatch(/\/\* __scene_hmr_accept \*\//);
  expect(snip).toMatch(
    /import \{ applyHotScenes \} from "@design-scenes\/shell";/,
  );
  expect(snip).toMatch(
    /import\.meta\.hot\.accept\(\["\.\/scenes\/ring\.ts",".\/scenes\/plate\.ts"\],/,
  );
  expect(snip).toMatch(
    /applyHotScenes\(\["\.\/scenes\/ring\.ts",".\/scenes\/plate\.ts"\], mods\)/,
  );
  expect(snip).not.toMatch(/\(\) => \{\}/);
});
