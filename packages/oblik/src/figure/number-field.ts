import { formatNum } from "@/source/patch";

/** Incomplete drafts like `-` / `.` stay invalid until they parse as a finite number. */
export function parseLiveNum(raw: string, opts?: { min?: number }): number | null {
  const t = raw.trim();
  if (t === "" || t === "-" || t === "+" || t === "." || t === "-." || t === "+.") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (opts?.min != null && n < opts.min) return null;
  return n;
}

export function sameNum(a: number, b: number): boolean {
  return formatNum(a) === formatNum(b);
}
