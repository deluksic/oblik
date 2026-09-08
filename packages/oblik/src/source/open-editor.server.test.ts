import { describe, expect, test } from "vitest";

import { editorArgv } from "./open-editor.server";

describe("editorArgv", () => {
  test("substitutes {file} and {line} in the default template", () => {
    expect(editorArgv("code --goto {file}:{line}", "/w/a.ts", 42)).toEqual([
      "code",
      "--goto",
      "/w/a.ts:42",
    ]);
  });

  test("keeps quoted tokens with spaces as single args", () => {
    expect(editorArgv('"C:/Program Files/code.exe" --goto {file}:{line}', "/w/a.ts", 7)).toEqual([
      "C:/Program Files/code.exe",
      "--goto",
      "/w/a.ts:7",
    ]);
  });

  test("keeps a file path containing spaces intact", () => {
    expect(editorArgv("code --goto {file}:{line}", "/w/my dir/a.ts", 1)).toEqual([
      "code",
      "--goto",
      "/w/my dir/a.ts:1",
    ]);
  });

  test("throws on an empty command", () => {
    expect(() => editorArgv('""', "/w/a.ts", 1)).toThrow("editor command is empty");
  });
});
