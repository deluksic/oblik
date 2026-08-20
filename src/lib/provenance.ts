export type CallSite = {
  file: string;
  line: number;
  column: number;
};

const EDIT_LINE =
  /\bedit(?:Point|DistanceToPoint|PointOnLine)\s*\(/;

let sceneLines: string[] | null = null;

export function registerSceneLines(source: string | null): void {
  sceneLines = source ? source.split("\n") : null;
}

function shouldSkip(file: string): boolean {
  return (
    file.endsWith("/lib/geom.ts") ||
    file.endsWith("/lib/vec.ts") ||
    file.endsWith("/lib/provenance.ts") ||
    file.includes("/euclid2/") ||
    file.endsWith("/main.ts")
  );
}

function lineHasEditCall(line: number): boolean {
  if (!sceneLines) return line > 1;
  return EDIT_LINE.test(sceneLines[line - 1] ?? "");
}

/** Deepest scene frame that looks like an edit* call site — 1-based line/column. */
export function captureCallSite(): CallSite {
  const stack = new Error().stack ?? "";
  const sceneFrames: CallSite[] = [];

  for (const raw of stack.split("\n")) {
    const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
    const m = line.match(
      /(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/,
    );
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const file = m[1].replace(/^\//, "");
    if (shouldSkip(file)) continue;
    if (!file.includes("/scenes/")) continue;
    sceneFrames.push({
      file,
      line: Number(m[2]),
      column: Number(m[3]),
    });
  }

  for (const frame of sceneFrames) {
    if (lineHasEditCall(frame.line)) return frame;
  }

  if (sceneFrames.length > 0) {
    return sceneFrames.reduce((best, f) => (f.line > best.line ? f : best));
  }

  return { file: "unknown", line: 0, column: 0 };
}
