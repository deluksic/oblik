export function quantize(n: number): number {
  return Math.round(n * 100) / 100;
}

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderSnippet(text: string, line: number): string {
  const lines = text.split("\n");
  const i = line - 1;
  const from = Math.max(0, i - 5);
  const to = Math.min(lines.length, i + 6);
  const chunks: string[] = [];
  for (let n = from; n < to; n++) {
    const current = n === i;
    const num = String(n + 1).padStart(4, " ");
    const body = escapeHtml(lines[n] ?? "");
    chunks.push(
      `<div class="${current ? "hl" : ""}"><span class="ln">${num}</span><span class="tx">${body}</span></div>`,
    );
  }
  return chunks.join("");
}

export async function peekFile(cache: Map<string, string>, file: string): Promise<string> {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  const cached = cache.get(key);
  if (cached != null) return cached;
  const res = await fetch(`/__peek?file=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Could not read ${key}`);
  const text = await res.text();
  cache.set(key, text);
  return text;
}

export async function commitWidget(
  at: { file: string; line: number; column: number },
  values: number[],
): Promise<string | null> {
  const res = await fetch("/__write-widget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: at.file,
      line: at.line,
      column: at.column,
      values,
    }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    return body.error ?? `write failed (${res.status})`;
  }
  return null;
}

export type ScenePatch = {
  hoistAt?: { line: number; column: number }[];
  imports?: Record<string, string[]>;
  statements?: string[];
  exprs?: string[];
};

export async function commitScenePatch(
  sceneFile: string,
  patch: ScenePatch,
): Promise<string | null> {
  const res = await fetch("/__insert-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: sceneFile, ...patch }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    return body.error ?? `insert failed (${res.status})`;
  }
  return null;
}
