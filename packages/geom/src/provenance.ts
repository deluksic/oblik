export type CallSite = {
  file: string;
  line: number;
  column: number;
};

const INFRA = [
  "/packages/geom/",
  "/packages/euclid2/",
  "/packages/euclid3/",
  "/packages/shell/",
  "/@design-scenes/geom/",
  "/@design-scenes/euclid2/",
  "/@design-scenes/euclid3/",
  "/@design-scenes/shell/",
  "/node_modules/",
  "/hosts/",
  "/inspect.ts",
  "/scene-loaders.ts",
];

function isInfra(file: string): boolean {
  const f = file.startsWith("/") ? file : `/${file}`;
  if (f.endsWith("/main.ts")) return true;
  return INFRA.some((p) => f.includes(p));
}

/** Repo-relative path: apps/paper/src/demo/beam.ts */
export function normalizeFile(file: string): string {
  const cleaned = file.replace(/^\/+/, "");
  const cut =
    cleaned.match(/(packages\/[^/]+\/src\/\S+)$/) ?? cleaned.match(/(apps\/[^/]+\/src\/\S+)$/);
  return cut?.[1] ?? cleaned;
}

function parseFrame(raw: string): CallSite | null {
  const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
  const m = line.match(/(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return {
    file: normalizeFile(m[1].replace(/^\//, "")),
    line: Number(m[2]),
    column: Number(m[3]),
  };
}

/** First stack frame outside geom / euclid2 / shell. */
export function captureCallSite(): CallSite {
  const stack = new Error().stack ?? "";
  for (const raw of stack.split("\n")) {
    const frame = parseFrame(raw);
    if (!frame) continue;
    if (isInfra(frame.file)) continue;
    return frame;
  }
  return { file: "unknown", line: 0, column: 0 };
}
