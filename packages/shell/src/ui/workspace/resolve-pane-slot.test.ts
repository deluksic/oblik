import { describe, expect, it } from "vitest";

import type { SceneEntry } from "@/types";

import {
  PaneResolveError,
  paneResolveFallback,
  resolvePaneSlot,
  sceneViewportError,
} from "./resolve-pane-slot";

const entry = (overrides: Partial<SceneEntry> & Pick<SceneEntry, "id">): SceneEntry => ({
  file: `${overrides.id}.scene.ts`,
  title: overrides.id,
  view: "euclid2",
  hasScene: true,
  ...overrides,
});

describe("resolvePaneSlot", () => {
  it("throws for unknown layout id", () => {
    expect(() => resolvePaneSlot("missing", undefined, undefined, {}, {})).toThrow(
      PaneResolveError,
    );
    expect(() => resolvePaneSlot("missing", undefined, undefined, {}, {})).toThrow(
      'Unknown scene id "missing" in layout.',
    );
  });

  it("throws when entry has catalog error", () => {
    expect(() =>
      resolvePaneSlot(
        "bad",
        entry({ id: "bad", error: "parse failed", hasScene: false }),
        undefined,
        {},
        {},
      ),
    ).toThrow("parse failed");
  });

  it("returns live mount when provided", () => {
    const mount = {
      id: "beam",
      entry: entry({ id: "beam" }),
      host: { mount: () => ({ refresh: () => {}, dispose: () => {} }) },
      loader: async () => ({}),
    };
    expect(resolvePaneSlot("beam", entry({ id: "beam" }), mount, {}, {})).toBe(mount);
  });
});

describe("paneResolveFallback", () => {
  it("reads PaneResolveError fields", () => {
    const err = new PaneResolveError("beam", "beam", "nope");
    expect(paneResolveFallback(err, "beam")).toEqual({
      id: "beam",
      label: "beam",
      message: "nope",
    });
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
