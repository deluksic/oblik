import { describe, expect, it } from "vitest";

import type { SceneEntry } from "@/types";

import { resolvePaneSlot, sceneViewportError } from "./resolve-pane-slot";

const entry = (overrides: Partial<SceneEntry> & Pick<SceneEntry, "id">): SceneEntry => ({
  file: `${overrides.id}.scene.ts`,
  title: overrides.id,
  view: "euclid2",
  hasScene: true,
  ...overrides,
});

describe("resolvePaneSlot", () => {
  it("errors for unknown layout id", () => {
    const slot = resolvePaneSlot("missing", undefined, undefined, {}, {});
    expect(slot).toEqual({
      kind: "error",
      id: "missing",
      label: "missing",
      message: 'Unknown scene id "missing" in layout.',
    });
  });

  it("errors when entry has catalog error", () => {
    const slot = resolvePaneSlot(
      "bad",
      entry({ id: "bad", error: "parse failed", hasScene: false }),
      undefined,
      {},
      {},
    );
    expect(slot).toEqual({
      kind: "error",
      id: "bad",
      label: "bad",
      message: "parse failed",
    });
  });

  it("returns live mount when provided", () => {
    const mount = {
      id: "beam",
      entry: entry({ id: "beam" }),
      host: { mount: () => ({ refresh: () => {}, dispose: () => {} }) },
      loader: async () => ({}),
    };
    const slot = resolvePaneSlot("beam", entry({ id: "beam" }), mount, {}, {});
    expect(slot).toEqual({ kind: "live", mount });
  });
});

describe("sceneViewportError", () => {
  it("reports missing catalog entry", () => {
    expect(sceneViewportError("foo", undefined)).toBe('No scene file for "foo".');
  });

  it("reports catalog error", () => {
    expect(sceneViewportError("foo", entry({ id: "foo", error: "nope" }))).toBe("nope");
  });
});
