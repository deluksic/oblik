export type CallSite = {
  file: string;
  line: number;
  column: number;
  /** V8/Firefox function name when the engine provides one. */
  name?: string;
};

const INFRA = [
  "/packages/geom/",
  "/packages/euclid2/",
  "/packages/euclid3/",
  "/packages/shell/",
  "/packages/sdf/",
  "/@design-scenes/geom/",
  "/@design-scenes/euclid2/",
  "/@design-scenes/euclid3/",
  "/@design-scenes/shell/",
  "/@design-scenes/sdf/",
  "/node_modules/",
  "/hosts/",
  "/inspect.ts",
  "/scene-loaders.ts",
];

const SKIP_NAMES = new Set(["", "eval", "anonymous", "<anonymous>", "Module"]);

function isInfra(file: string): boolean {
  // Live tests live under packages/geom; treat them as user frames.
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  const f = file.startsWith("/") ? file : `/${file}`;
  if (f.endsWith("/main.ts")) return true;
  return INFRA.some((p) => f.includes(p));
}

/** Repo-relative path: apps/paper/src/demo/beam.ts */
export function normalizeFile(file: string): string {
  const cleaned = file.replace(/^\/+/, "");
  const cut =
    cleaned.match(/(packages\/[^/]+\/src\/\S+)$/) ?? cleaned.match(/(apps\/[^/]+\/src\/\S+)$/);
  if (cut?.[1]) return cut[1];
  // Vite serves the paper app from /src/…, not /apps/paper/src/…
  if (cleaned.startsWith("src/")) return `apps/paper/${cleaned}`;
  return cleaned;
}

function functionName(raw: string): string | undefined {
  const v8 = raw.match(/^\s*at\s+(?:async\s+)?([^\s(/]+(?:\.[^\s(/]+)*)\s+\(/);
  if (v8?.[1] && !SKIP_NAMES.has(v8[1]) && v8[1] !== "Object") {
    const n = v8[1].replace(/^Object\./, "");
    return SKIP_NAMES.has(n) ? undefined : n;
  }
  const ff = raw.match(/^\s*([^@\s]+(?:\.[^@\s]+)*)@/);
  if (ff?.[1] && !SKIP_NAMES.has(ff[1])) return ff[1];
  return undefined;
}

export function parseFrame(raw: string): CallSite | null {
  const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
  const m = line.match(/(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const file = normalizeFile(m[1].replace(/^\//, ""));
  const name = functionName(raw);
  return {
    file,
    line: Number(m[2]),
    column: Number(m[3]),
    ...(name ? { name } : {}),
  };
}

function siteKey(s: CallSite): string {
  return `${s.file}:${s.line}:${s.column}`;
}

/**
 * User frames from this constructor, innermost first.
 * Infra (geom, euclid, shell, hosts) is skipped so nested demo helpers remain.
 */
export function captureUserStack(): CallSite[] {
  const stack = new Error().stack ?? "";
  const frames: CallSite[] = [];
  const seen = new Set<string>();
  for (const raw of stack.split("\n")) {
    const frame = parseFrame(raw);
    if (!frame) continue;
    if (isInfra(frame.file)) continue;
    const key = siteKey(frame);
    if (seen.has(key)) continue;
    seen.add(key);
    frames.push(frame);
  }
  return frames;
}

/** First user frame — helper that called the constructor. */
export function captureCallSite(): CallSite {
  const stack = captureUserStack();
  return stack[0] ?? { file: "unknown", line: 0, column: 0 };
}
