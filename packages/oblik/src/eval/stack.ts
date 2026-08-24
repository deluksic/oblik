export type CallSite = {
  file: string;
  line: number;
  column: number;
  name?: string;
};

const SKIP_FILE = [/\/oblik\//, /\/node_modules\//, /\/vite\//, /node:/];
const SKIP_NAME = new Set(["", "eval", "anonymous", "<anonymous>", "Module", "evaluate", "traced"]);

function parseFrame(raw: string): CallSite | null {
  const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
  const m = line.match(/(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const file = m[1].replace(/^\//, "");
  if (SKIP_FILE.some((re) => re.test(file))) return null;
  const nameMatch = raw.match(/^\s*at\s+(?:async\s+)?([^\s(/]+)/);
  const name = nameMatch?.[1];
  return {
    file,
    line: Number(m[2]),
    column: Number(m[3]),
    ...(name && !SKIP_NAME.has(name) ? { name } : {}),
  };
}

export function captureUserStack(): CallSite[] {
  const err = new Error();
  const rows = (err.stack ?? "").split("\n").slice(1);
  const out: CallSite[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const f = parseFrame(raw);
    if (!f) continue;
    const key = `${f.file}:${f.line}:${f.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
