import { describe, expect, it } from "vitest";

import { filterCommands } from "./filter";

describe("filterCommands", () => {
  const cmds = [
    { id: "point", title: "Point", hint: "Click empty paper or a line crossing." },
    { id: "distance", title: "Distance", hint: "Radius from a point" },
    { id: "line", title: "Line", hint: "Two points for an infinite line." },
  ];

  it("returns all commands for empty query", () => {
    expect(filterCommands(cmds, "")).toEqual(cmds);
  });

  it("filters by title, id, and hint", () => {
    expect(filterCommands(cmds, "radius")).toEqual([cmds[1]]);
    expect(filterCommands(cmds, "point")).toEqual([cmds[0], cmds[1], cmds[2]]);
  });

  it("prefers title/id matches over incidental hint words", () => {
    expect(filterCommands(cmds, "li")).toEqual([cmds[2]]);
  });
});
