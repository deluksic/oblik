export type FigureToolId = "brush" | "eraser" | "export";

export type FigureToolSpec = {
  id: FigureToolId;
  title: string;
  hint: string;
};

export const FIGURE_TOOLS: readonly FigureToolSpec[] = [
  { id: "brush", title: "Brush", hint: "Add on onion (Shift). Replace existing ink." },
  { id: "eraser", title: "Eraser", hint: "Remove ink. Construction stays." },
  { id: "export", title: "Export", hint: "Save this figure as an SVG — copy or download." },
];

export function filterFigureTools(query: string): FigureToolSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...FIGURE_TOOLS];
  return FIGURE_TOOLS.filter(
    (t) =>
      t.title.toLowerCase().includes(q) || t.id.includes(q) || t.hint.toLowerCase().includes(q),
  );
}
