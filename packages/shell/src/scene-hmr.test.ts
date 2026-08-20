import assert from "node:assert/strict";
import test from "node:test";
import { sceneLoadersAcceptTail } from "./vite-plugin.ts";

test("accept snippet keeps glob keys as string literals for Vite's HMR lexer", () => {
  const keys = ["./scenes/ring.ts", "./scenes/plate.ts"];
  const snip = sceneLoadersAcceptTail(keys);
  assert.match(snip, /\/\* __scene_hmr_accept \*\//);
  assert.match(
    snip,
    /import\.meta\.hot\.accept\(\["\.\/scenes\/ring\.ts",".\/scenes\/plate\.ts"\],/,
  );
  assert.match(snip, /applyHotScenes\(\["\.\/scenes\/ring\.ts",".\/scenes\/plate\.ts"\], mods\)/);
  assert.doesNotMatch(snip, /\(\) => \{\}/);
});
