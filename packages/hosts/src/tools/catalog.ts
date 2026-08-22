import type { CommandSpec } from "@design-scenes/shell";

/** Space palettes. euclid2 is `geom`; sdf2 keeps the Point + Distance slice. */
export type ToolPalette = "geom" | "sdf2";

export type ToolVerb = "point" | "circle" | "line" | "segment" | "offset" | "slider" | "distance";

/**
 * Space verbs. Palette membership and the number-bar flag live here.
 * Click / compile / preview stay in session.ts (they share slot resolvers).
 *
 * Adding a tool: a row here (palette + draft), a `ToolSession` variant, then
 * click / compile / preview in session.ts. Annotator and write-back are
 * `CALL_SITES` in the shell — not this table.
 */
export type ToolSpec = {
  id: ToolVerb;
  title: string;
  hint: string;
  palettes: readonly ToolPalette[];
  /** Typed length/value while a slot is open. Session variant must carry `typed`. */
  draft?: boolean;
};

export const TOOLS: readonly ToolSpec[] = [
  {
    id: "point",
    title: "Point",
    hint: "Empty paper, a named point, or a crossing. Type x / y or click.",
    palettes: ["geom", "sdf2"],
  },
  {
    id: "circle",
    title: "Circle",
    hint: "Center, then radius, a length, or a point.",
    palettes: ["geom"],
    draft: true,
  },
  {
    id: "line",
    title: "Line",
    hint: "Two points — infinite.",
    palettes: ["geom"],
  },
  {
    id: "segment",
    title: "Segment",
    hint: "Two points — finite.",
    palettes: ["geom"],
  },
  {
    id: "offset",
    title: "Offset",
    hint: "A line, then a distance or another length.",
    palettes: ["geom"],
    draft: true,
  },
  {
    id: "slider",
    title: "Slider",
    hint: "A named number. Tab for min, max, step. Click it later to reuse.",
    palettes: ["geom"],
    draft: true,
  },
  {
    id: "distance",
    title: "Distance",
    hint: "Point or line, then a length (ring or parallel).",
    palettes: ["sdf2"],
    draft: true,
  },
];

const byId = new Map(TOOLS.map((t) => [t.id, t]));

export function toolById(id: string): ToolSpec | undefined {
  return byId.get(id as ToolVerb);
}

export function paletteCommands(palette: ToolPalette): CommandSpec[] {
  return TOOLS.filter((t) => t.palettes.includes(palette)).map((t) => ({
    id: t.id,
    title: t.title,
    hint: t.hint,
  }));
}

export function toolAcceptsDraft(id: string): boolean {
  return toolById(id)?.draft === true;
}
