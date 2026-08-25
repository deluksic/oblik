export type CallSite = {
  file: string;
  line: number;
  column: number;
  name?: string;
};

const SKIP_NAME = new Set(["", "eval", "anonymous", "<anonymous>", "Module", "evaluate", "traced"]);

/** Scene / user source paths we can peek on disk — not Vite prebundles or oblik internals. */
export function isUserSourcePath(file: string): boolean {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  if (/(^|\/)node_modules(\/|$)/.test(key)) return false;
  if (/(^|\/)\.vite(\/|$)/.test(key)) return false;
  if (/^node:/.test(key)) return false;
  if (/\/oblik\//.test(key)) return false;
  return /\.(ts|tsx)$/.test(key);
}

function parseFrame(raw: string): CallSite | null {
  const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
  const m = line.match(/(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const file = m[1].replace(/^\//, "");
  if (!isUserSourcePath(file)) return null;
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
