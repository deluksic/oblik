import { printExpr } from "@/source/expr";
import type { InsertJob, Field, FieldKind, Draft, Scope, Tool, ToolKey, ToolSession, ToolStep } from "./types";
import type { LengthDraft } from "./length";
import { scopeOf } from "./scope";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseNum(raw: string | undefined): number | undefined {
  const t = raw?.trim() ?? "";
  if (t === "" || t === "-" || t === "." || t === "-.") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function identError(raw: string, usedNames: readonly string[] = []): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!IDENT.test(t)) return "Name must be an identifier.";
  if (usedNames.includes(t)) return `bind ${t} is already used`;
  return null;
}

export function numError(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (parseNum(t) == null) return "Not a number.";
  return null;
}

export function refError(raw: string, names: readonly string[], label: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!IDENT.test(t)) return "Name must be an identifier.";
  if (names.length > 0 && !names.includes(t)) return `No ${label} named ${t}.`;
  return null;
}

export function lengthError(raw: string, scope: Scope): string | null {
  const t = raw.trim();
  if (t === "" || t === "-") return null;
  if (parseNum(t) != null) return null;
  let rest = t;
  if (rest.startsWith("-")) {
    rest = rest.slice(1).trim();
    if (rest === "") return null;
  }
  const dot = rest.lastIndexOf(".");
  if (dot > 0) {
    const object = rest.slice(0, dot);
    const field = rest.slice(dot + 1);
    if (field === "radius") {
      if (!scope.circles[object]) return `No circle named ${object}.`;
      return null;
    }
    if (field === "distance") {
      if (scope.carriers[object]?.geom.kind !== "parallelLine") return `No parallel line named ${object}.`;
      return null;
    }
  }
  return refError(raw, Object.keys(scope.lengths), "slider");
}

export function fieldError<S extends ToolSession>(field: Field<S>, session: S, scope: Scope): string | null {
  const raw = field.get(session);
  if (field.kind === "length") return lengthError(raw, scope);
  if (field.kind === "number") return numError(raw);
  if (field.kind === "ident") return identError(raw, scope.used);
  const names = field.looks === "carrier"
    ? Object.keys(scope.carriers)
    : Object.keys(scope.points);
  const label = field.looks === "carrier" ? "line" : "point";
  return refError(raw, names, label);
}

export function firstInvalid<S extends ToolSession>(tool: Tool<S>, session: S, scope: Scope): Field<S> | null {
  return openFields(tool, session).find((f) => fieldError(f, session, scope) != null) ?? null;
}

export function namedBind(name: string | undefined): string | undefined {
  const t = name?.trim() ?? "";
  return IDENT.test(t) ? t : undefined;
}

export function withBind(session: { name?: string }, job: InsertJob): InsertJob {
  const bind = namedBind(session.name);
  return bind ? { ...job, bind } : job;
}

export function resolvePoint(ref: string, placed: import("./types").Placed | undefined, scope: Scope) {
  const t = ref.trim();
  if (!t) return placed;
  if (scope.points[t]) return scope.points[t];
  if (placed?.expr.kind === "ref" && placed.expr.name === t) return placed;
}

export function resolveCarrier(
  ref: string,
  placed: Scope["carriers"][string] | undefined,
  scope: Scope,
) {
  const t = ref.trim();
  if (!t) return placed;
  if (scope.carriers[t]) return scope.carriers[t];
  if (placed?.expr.kind === "ref" && placed.expr.name === t) return placed;
}

export function hitRef(hit: import("./types").PlaceHit): string {
  return hit.point.kind === "ref" ? hit.point.bind : "";
}

export function nameField<S extends { name: string }>(open: (session: S) => boolean = () => true): Field<S> {
  return {
    id: "name",
    kind: "ident",
    placeholder: "<name>",
    open,
    get: (s) => s.name,
    set: (s, raw) => ({ ...s, name: raw }),
  };
}

export function typedField<S extends { typed: string }>(open: (session: S) => boolean): Field<S> {
  return {
    id: "typed",
    kind: "number",
    placeholder: "<n>",
    open,
    get: (s) => s.typed,
    set: (s, raw) => ({ ...s, typed: raw }),
  };
}

/** Numeric literal, slider ref, or geometry field (e.g. reach.radius). */
export function lengthField<S extends LengthDraft>(placeholder = "<n>"): Field<S> {
  return {
    id: "typed",
    kind: "length",
    placeholder,
    open: () => true,
    get: (s) => (s.lengthPick ? printExpr(s.lengthPick) : s.typed),
    set: (s, raw) => ({ ...s, typed: raw, lengthPick: undefined }),
  };
}

export { numberField } from "./length";

export function refField<S extends ToolSession>(
  id: string,
  placeholder: string,
  looks: "point" | "carrier",
  get: (session: S) => string,
  set: (session: S, raw: string) => S,
): Field<S> {
  return { id, kind: "ref", placeholder, looks, open: () => true, get, set };
}

export function editValue(value: string, kind: FieldKind, key: string): string | null {
  if (key === "Backspace") return value.slice(0, -1);
  if (key === "Delete") return "";
  if (key.length !== 1) return null;
  if (kind === "ident" || kind === "ref") return /[A-Za-z0-9_]/.test(key) ? value + key : null;
  if (kind === "length") {
    if (key === "-" && value === "") return "-";
    if (key === "." || /[0-9A-Za-z_]/.test(key)) return value + key;
    return null;
  }
  if (key === "-" && value === "") return "-";
  if (/[0-9.]/.test(key)) return value + key;
  return null;
}

export function openFields<S extends ToolSession>(tool: Tool<S>, session: S): Field<S>[] {
  return (tool.fields ?? []).filter((f) => f.open(session));
}

export function focusedField<S extends ToolSession>(tool: Tool<S>, session: S): Field<S> | null {
  const open = openFields(tool, session);
  if (open.length === 0) return null;
  const id = tool.focus?.(session) ?? open[0]!.id;
  return open.find((f) => f.id === id) ?? open[0]!;
}

export function focusedDraft<S extends ToolSession>(tool: Tool<S>, session: S, scope: Scope): Draft | null {
  const field = focusedField(tool, session);
  if (!field) return null;
  const value = field.get(session);
  const error = fieldError(field, session, scope);
  return {
    id: field.id,
    kind: field.kind,
    value,
    placeholder: field.placeholder,
    invalid: error != null,
    error: error ?? undefined,
  };
}

export function tabSession<S extends ToolSession>(tool: Tool<S>, session: S, dir: 1 | -1): S {
  if (tool.tab) return tool.tab(session, dir);
  const open = openFields(tool, session);
  if (open.length === 0 || !tool.setFocus) return session;
  const ids = open.map((f) => f.id);
  const cur = tool.focus?.(session) ?? ids[0]!;
  const i = Math.max(0, ids.indexOf(cur));
  return tool.setFocus(session, ids[(i + dir + ids.length) % ids.length]!);
}

export function typeSession<S extends ToolSession>(tool: Tool<S>, session: S, raw: string): S {
  const field = focusedField(tool, session);
  return field ? field.set(session, raw) : session;
}

export type KeyOutcome = ToolStep | { ignore: true };

export function keySession<S extends ToolSession>(
  tool: Tool<S>,
  session: S,
  e: ToolKey,
  place: import("./types").PlaceHit | null,
  scope: Scope | readonly string[] = [],
): KeyOutcome {
  const sc = scopeOf(scope);
  if (e.ctrl || e.meta || e.alt) return { ignore: true };
  if (e.key === "Tab") return { session: tabSession(tool, session, e.shift ? -1 : 1) };
  if (e.key === "Enter") {
    const bad = firstInvalid(tool, session, sc);
    if (bad) {
      if (tool.setFocus && tool.focus?.(session) !== bad.id) {
        return { session: tool.setFocus(session, bad.id) };
      }
      return { ignore: true };
    }
    return tool.commit?.(session, place, sc) ?? { ignore: true };
  }
  const field = focusedField(tool, session);
  if (!field) return { ignore: true };
  const next = editValue(field.get(session), field.kind, e.key);
  if (next == null) return { ignore: true };
  return { session: field.set(session, next) };
}

export function previewName(session: { name?: string }, fallback: string): string {
  return session.name?.trim() || fallback;
}

const SLOT_OPEN = "\u0001";
const SLOT_CLOSE = "\u0002";

/** Wrap the focused token so the prompt can put the caret in the source line. */
export function inSlot(active: boolean, text: string): string {
  return active ? `${SLOT_OPEN}${text}${SLOT_CLOSE}` : text;
}

export function unmarkSlot(line: string): string {
  return line.replaceAll(SLOT_OPEN, "").replaceAll(SLOT_CLOSE, "");
}

export type SlotParts = { before: string; token: string; after: string };

export function splitSlot(line: string): SlotParts | null {
  const i = line.indexOf(SLOT_OPEN);
  const j = line.indexOf(SLOT_CLOSE);
  if (i < 0 || j < 0 || j < i) return null;
  return {
    before: unmarkSlot(line.slice(0, i)),
    token: line.slice(i + SLOT_OPEN.length, j),
    after: unmarkSlot(line.slice(j + SLOT_CLOSE.length)),
  };
}

export function withSlot(preview: { line: string; hint: string }, draft: Draft | null) {
  const parts = splitSlot(preview.line);
  return {
    line: unmarkSlot(preview.line),
    hint: preview.hint,
    ...(draft ? { draft } : {}),
    ...(parts ? { before: parts.before, after: parts.after, token: parts.token } : {}),
  };
}
