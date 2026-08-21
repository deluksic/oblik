import { describe, expect, it } from "vitest";

import { filterCommands } from "./palette.ts";

describe("filterCommands", () => {
  const cmds = [
    { id: "point", title: "Point", hint: "Click empty paper" },
    { id: "distance", title: "Distance", hint: "Radius from a point" },
  ];

  it("returns all commands for empty query", () => {
    expect(filterCommands(cmds, "")).toEqual(cmds);
  });

  it("filters by title, id, and hint", () => {
    expect(filterCommands(cmds, "radius")).toEqual([cmds[1]]);
    expect(filterCommands(cmds, "point")).toEqual(cmds);
  });
});
