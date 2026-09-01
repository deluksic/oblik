export function sourceFileKey(file: string): string {
  const n = file.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\?.*$/, "");
  const fromSrc = n.indexOf("/src/");
  if (fromSrc >= 0) return n.slice(fromSrc + 1);
  if (n.startsWith("src/")) return n;
  return n;
}

export type CallSite = {
  file: string;
  line: number;
  column: number;
  name?: string;
};

const SKIP_NAME = new Set(["", "eval", "anonymous", "<anonymous>", "Module", "evaluate", "traced"]);

/** Scene / user source paths we can peek on disk — not Vite prebundles or oblik internals. */
export function isUserSourcePath(file: string): boolean {
  const key = normalizeStackFile(file);
  if (/(^|\/)node_modules(\/|$)/.test(key)) return false;
  if (/(^|\/)\.vite(\/|$)/.test(key)) return false;
  if (key.startsWith('node:')) return false;
  if (/\/oblik\//.test(key)) return false;
  return /\.(ts|tsx)$/.test(key);
}

/** Collapse a browser/Node stack filename to a repo or Vite-app path. */
export function normalizeStackFile(file: string): string {
  let f = file.replace(/\\/g, "/").replace(/\?.*$/, "");
  f = f.replace(/^https?:\/\/[^/]+\//, "");
  f = f.replace(/^file:\/\//, "");
  f = f.replace(/^\/?@fs\/?/, "");
  const demo = f.indexOf("apps/demo/");
  if (demo >= 0) return f.slice(demo);
  f = f.replace(/^\/+/, "");
  // Browser stacks sometimes keep the listen port in front of `/src/…`.
  f = f.replace(/^\d+\//, "");
  return f;
}

type V8CallSite = {
  getFileName?: () => string | null | undefined;
  getLineNumber?: () => number | null | undefined;
  getColumnNumber?: () => number | null | undefined;
  getFunctionName?: () => string | null | undefined;
};

const ErrorWithStack = Error as typeof Error & {
  prepareStackTrace?: (err: Error, sites: V8CallSite[]) => unknown;
};

function callSiteFromParts(file: string, line: number, column: number, name?: string | null): CallSite | null {
  const normalized = normalizeStackFile(file);
  if (!isUserSourcePath(normalized)) return null;
  const who = name?.trim();
  return {
    file: normalized,
    line,
    column,
    ...(who && !SKIP_NAME.has(who) ? { name: who } : {}),
  };
}

export function parseFrame(raw: string): CallSite | null {
  const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
  const m = line.match(/(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const nameMatch = raw.match(/^\s*at\s+(?:async\s+)?([^\s(/]+)/);
  return callSiteFromParts(m[1], Number(m[2]), Number(m[3]), nameMatch?.[1]);
}

function fromV8(site: V8CallSite): CallSite | null {
  const file = site.getFileName?.();
  const line = site.getLineNumber?.();
  const column = site.getColumnNumber?.();
  if (!file || line == null || column == null) return null;
  return callSiteFromParts(file, line, column, site.getFunctionName?.());
}

function dedupe(frames: CallSite[]): CallSite[] {
  const out: CallSite[] = [];
  const seen = new Set<string>();
  for (const f of frames) {
    const key = `${f.file}:${f.line}:${f.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * User frames at constructor time. V8 CallSites are generated positions (source
 * maps are only applied when stringify-ing the stack), so `/__map-stack` can
 * remap them through Vite’s transform. Firefox falls back to the string stack.
 */
export function captureUserStack(): CallSite[] {
  const prev = ErrorWithStack.prepareStackTrace;
  let structured: V8CallSite[] | undefined;
  try {
    ErrorWithStack.prepareStackTrace = (_err, sites) => {
      structured = sites;
      return "";
    };
    const err = new Error();
    void err.stack;
  } catch {
    structured = undefined;
  } finally {
    ErrorWithStack.prepareStackTrace = prev;
  }
  const fromSites = structured?.map(fromV8).filter((f): f is CallSite => f != null) ?? [];
  if (fromSites.length > 0) return dedupe(fromSites);

  const err = new Error();
  const rows = (err.stack ?? "").split("\n").slice(1);
  const parsed: CallSite[] = [];
  for (const raw of rows) {
    const f = parseFrame(raw);
    if (f) parsed.push(f);
  }
  return dedupe(parsed);
}
