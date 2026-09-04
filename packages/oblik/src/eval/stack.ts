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

function slashForward(file: string): string {
  if (!file.includes("\\")) return file;
  return file.split("\\").join("/");
}

function stripQuery(file: string): string {
  const q = file.indexOf("?");
  return q >= 0 ? file.slice(0, q) : file;
}

function stripLeadingSlashes(file: string): string {
  let i = 0;
  while (i < file.length && file[i] === "/") i++;
  return i > 0 ? file.slice(i) : file;
}

function stripPortPrefix(file: string): string {
  const slash = file.indexOf("/");
  if (slash <= 0) return file;
  for (let i = 0; i < slash; i++) {
    const c = file.charCodeAt(i);
    if (c < 48 || c > 57) return file;
  }
  return file.slice(slash + 1);
}

/** Collapse a browser/Node stack filename to a repo or Vite-app path. */
export function normalizeStackFile(file: string): string {
  let f = stripQuery(slashForward(file));
  const scheme = f.indexOf("://");
  if (scheme >= 0) {
    const pathStart = f.indexOf("/", scheme + 3);
    f = pathStart >= 0 ? f.slice(pathStart + 1) : "";
  }
  if (f.startsWith("file://")) f = f.slice(7);
  if (f.startsWith("/@fs/")) f = f.slice(5);
  else if (f.startsWith("@fs/")) f = f.slice(4);
  const demo = f.indexOf("apps/demo/");
  if (demo >= 0) return f.slice(demo);
  f = stripLeadingSlashes(f);
  return stripPortPrefix(f);
}

/** Scene / user source paths we can peek on disk — not Vite prebundles or oblik internals. */
export function isUserSourcePath(file: string): boolean {
  const key = normalizeStackFile(file);
  if (key.includes("node_modules")) return false;
  if (key.includes("/.vite/") || key.startsWith(".vite/")) return false;
  if (key.startsWith("node:")) return false;
  if (key.includes("/oblik/")) return false;
  return key.endsWith(".ts") || key.endsWith(".tsx");
}

/** User-facing stack frames — filter and normalize at read time, not capture. */
export function userStackFrames(frames: readonly CallSite[]): CallSite[] {
  return frames.filter((f) => isUserSourcePath(f.file));
}

/** Repo-relative key for matching mention paths to raw stack filenames. */
export function stackFileKey(file: string): string {
  return sourceFileKey(normalizeStackFile(file));
}

export function normalizeCallSite(f: CallSite): CallSite {
  return { ...f, file: normalizeStackFile(f.file) };
}

type V8CallSite = {
  getFileName?: () => string | undefined;
  getLineNumber?: () => number | undefined;
  getColumnNumber?: () => number | undefined;
  getFunctionName?: () => string | undefined;
};

const ErrorWithStack = Error as typeof Error & {
  prepareStackTrace?: (err: Error, sites: V8CallSite[]) => unknown;
};

function callSiteFromParts(
  file: string,
  line: number,
  column: number,
  name?: string | undefined,
): CallSite | undefined {
  if (!file || line === undefined || column === undefined) return undefined;
  const who = name?.trim();
  return {
    file,
    line,
    column,
    ...(who ? { name: who } : {}),
  };
}

export function parseFrame(raw: string): CallSite | undefined {
  const line = raw.replace(/\.(tsx?|jsx?|mjs)\?[^:]*:/, ".$1:");
  const m = line.match(/(?:https?:\/\/[^/]+\/)?([^:\s)]+\.(?:ts|tsx|js|mjs)):(\d+):(\d+)/);
  if (!m?.[1] || !m[2] || !m[3]) return undefined;
  const nameMatch = raw.match(/^\s*at\s+(?:async\s+)?([^\s(/]+)/);
  return callSiteFromParts(m[1], Number(m[2]), Number(m[3]), nameMatch?.[1]);
}

function fromV8(site: V8CallSite): CallSite | undefined {
  const file = site.getFileName?.();
  const line = site.getLineNumber?.();
  const column = site.getColumnNumber?.();
  if (!file || line === undefined || column === undefined) return undefined;
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
 * Stack frames at constructor time. V8 CallSites are generated positions (source
 * maps are only applied when stringify-ing the stack), so `/__map-stack` can
 * remap them through Vite’s transform. Firefox falls back to the string stack.
 * Frames are stored verbatim; filtering and path cleanup happen at read time.
 */
export const EMPTY_STACK: CallSite[] = [];

export function captureUserStack(): CallSite[] {
  const prev = ErrorWithStack.prepareStackTrace;
  let structured: V8CallSite[] | undefined;
  try {
    ErrorWithStack.prepareStackTrace = (_err, sites) => {
      // Node types the callback with its own `CallSite` (methods return
      // `string | null`); ours are structurally the same minus the platform
      // null, so cast across the boundary.
      structured = sites as unknown as V8CallSite[];
      return "";
    };
    const err = new Error();
    void err.stack;
  } catch {
    structured = undefined;
  } finally {
    ErrorWithStack.prepareStackTrace = prev;
  }
  const fromSites = structured?.map(fromV8).filter((f): f is CallSite => f !== undefined) ?? [];
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
