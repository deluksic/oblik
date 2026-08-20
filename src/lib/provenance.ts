export type CallSite = {
  file: string;
  line: number;
  column: number;
};

function shouldSkip(file: string): boolean {
  return (
    file.endsWith("/lib/geom.ts") ||
    file.endsWith("/lib/vec.ts") ||
    file.endsWith("/lib/provenance.ts") ||
    file.includes("/euclid2/") ||
    file.endsWith("/main.ts")
  );
}

/** First useful stack frame outside infra — 1-based line/column. */
export function captureCallSite(): CallSite {
  const stack = new Error().stack ?? "";
  for (const raw of stack.split("\n")) {
    const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
    const m = line.match(
      /(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/,
    );
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const file = m[1].replace(/^\//, "");
    if (shouldSkip(file)) continue;
    return {
      file,
      line: Number(m[2]),
      column: Number(m[3]),
    };
  }
  return { file: "unknown", line: 0, column: 0 };
}
