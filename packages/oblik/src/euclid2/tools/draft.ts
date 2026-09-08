import { printExpr, type Expr } from "#source/expr";

import type { LengthDraft } from "./length";
import { scopeOf } from "./scope";
import type {
  InsertJob,
  Field,
  FieldKind,
  Draft,
  Placed,
  Scope,
  Tool,
  ToolKey,
  ToolSession,
  ToolStep,
} from "./types";

/** What a `ref` field accepts, minus the length machinery. */
export type RefLooks = "point" | "carrier" | "circle" | "region" | "operand";

/** The value a slot of each `RefLooks` holds. */
export type SlotValue = {
  point: Placed;
  carrier: Scope["carriers"][string];
  circle: Scope["circles"][string];
  region: Scope["regions"][string];
  operand: Scope["points"][string] | Scope["circles"][string];
};

const { max } = Math;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function parseNum(raw: string | undefined): number | undefined {
  const t = raw?.trim() ?? "";
  if (t === "" || t === "-" || t === "." || t === "-.") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function identError(raw: string, usedNames: readonly string[] = []): string | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  if (!IDENT.test(t)) return "Name must be an identifier.";
  if (usedNames.includes(t)) return `bind ${t} is already used`;
  return undefined;
}

export function numError(raw: string): string | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  if (parseNum(t) === undefined) return "Not a number.";
  return undefined;
}

export function refError(raw: string, names: readonly string[], label: string): string | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  if (!PATH.test(t)) return "Name must be an identifier or path.";
  if (names.length > 0 && !names.includes(t)) return `No ${label} named ${t}.`;
  return undefined;
}

export function lengthError(raw: string, scope: Scope): string | undefined {
  const t = raw.trim();
  if (t === "" || t === "-") return undefined;
  if (parseNum(t) !== undefined) return undefined;
  let rest = t;
  if (rest.startsWith("-")) {
    rest = rest.slice(1).trim();
    if (rest === "") return undefined;
  }
  const dot = rest.lastIndexOf(".");
  if (dot > 0) {
    const object = rest.slice(0, dot);
    const field = rest.slice(dot + 1);
    if (field === "radius") {
      if (!scope.circles[object]) return `No circle named ${object}.`;
      return undefined;
    }
    if (field === "distance") {
      if (scope.carriers[object]?.geom.kind !== "parallelLine")
        return `No parallel line named ${object}.`;
      return undefined;
    }
  }
  return refError(raw, Object.keys(scope.lengths), "slider");
}

const REF_TABLES: Record<
  RefLooks,
  { table: (scope: Scope) => Readonly<Record<string, unknown>>; names: (scope: Scope) => string[]; label: string }
> = {
  point: { table: (s) => s.points, names: (s) => Object.keys(s.points), label: "point" },
  carrier: { table: (s) => s.carriers, names: (s) => Object.keys(s.carriers), label: "line" },
  circle: { table: (s) => s.circles, names: (s) => Object.keys(s.circles), label: "circle" },
  region: { table: (s) => s.regions, names: (s) => Object.keys(s.regions), label: "region" },
  operand: {
    table: (s) => ({ ...s.points, ...s.circles }),
    names: (s) => [...Object.keys(s.points), ...Object.keys(s.circles)],
    label: "point or circle",
  },
};

export function fieldError<S extends ToolSession>(
  field: Field<S>,
  session: S,
  scope: Scope,
): string | undefined {
  const raw = field.get(session);
  if (field.kind === "length") return lengthError(raw, scope);
  if (field.kind === "number") return numError(raw);
  if (field.kind === "ident") return identError(raw, scope.used);
  const looks = REF_TABLES[field.looks === "length" || !field.looks ? "point" : field.looks];
  return refError(raw, looks.names(scope), looks.label);
}

export function firstInvalid<S extends ToolSession>(
  tool: Tool<S>,
  session: S,
  scope: Scope,
): Field<S> | undefined {
  return (
    openFields(tool, session).find((f) => fieldError(f, session, scope) !== undefined) ?? undefined
  );
}

export function namedBind(name: string | undefined): string | undefined {
  const t = name?.trim() ?? "";
  return IDENT.test(t) ? t : undefined;
}

export function withBind(session: { name?: string }, job: InsertJob): InsertJob {
  const bind = namedBind(session.name);
  return bind ? { ...job, bind } : job;
}

/**
 * Typed ref beats placed, placed beats nothing. `kind` selects the scope
 * table; a typed ref matching the placed value's printed expr keeps it
 * (the placement may be newer than the printed tape).
 */
export function resolveSlot<K extends RefLooks>(
  kind: K,
  ref: string,
  placed: SlotValue[K] | undefined,
  scope: Scope,
): SlotValue[K] | undefined {
  const t = ref.trim();
  if (!t) return placed;
  const table = REF_TABLES[kind].table(scope) as Record<string, SlotValue[K]>;
  if (table[t]) return table[t];
  return placed && printExpr(placed.expr) === t ? placed : undefined;
}

/** Typed ref text beats a resolved expr, which beats the hover label or fallback. */
export function slotLabel(
  ref: string,
  resolved: { expr: Expr } | undefined,
  hover: string | undefined,
  fallback: string,
): string {
  const t = ref.trim();
  if (t) return t;
  if (resolved) return printExpr(resolved.expr);
  return hover ?? fallback;
}

export function hitRef(hit: import("./types").PlaceHit): string {
  return hit.point.kind === "ref" ? hit.point.bind : "";
}

export function nameField<S extends ToolSession & { name: string }>(
  open: (session: S) => boolean = () => true,
): Field<S> {
  return {
    id: "name",
    kind: "ident",
    placeholder: "<name>",
    open,
    get: (s) => s.name,
    set: (s, raw) => ({ ...s, name: raw }),
  };
}

export function typedField<S extends ToolSession & { typed: string }>(
  open: (session: S) => boolean,
): Field<S> {
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
export function lengthField<S extends ToolSession & LengthDraft>(placeholder = "<n>"): Field<S> {
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
  looks: "point" | "carrier" | "region" | "circle" | "operand",
  get: (session: S) => string,
  set: (session: S, raw: string) => S,
): Field<S> {
  return { id, kind: "ref", placeholder, looks, open: () => true, get, set };
}

export function editValue(value: string, kind: FieldKind, key: string): string | undefined {
  if (key === "Backspace") return value.slice(0, -1);
  if (key === "Delete") return "";
  if (key.length !== 1) return undefined;
  if (kind === "ident" || kind === "ref") return /[A-Za-z0-9_]/.test(key) ? value + key : undefined;
  if (kind === "length") {
    if (key === "-" && value === "") return "-";
    if (key === "." || /[0-9A-Za-z_]/.test(key)) return value + key;
    return undefined;
  }
  if (key === "-" && value === "") return "-";
  if (/[0-9.]/.test(key)) return value + key;
  return undefined;
}

export function openFields<S extends ToolSession>(tool: Tool<S>, session: S): Field<S>[] {
  return (tool.fields ?? []).filter((f) => f.open(session));
}

export function focusedField<S extends ToolSession>(
  tool: Tool<S>,
  session: S,
): Field<S> | undefined {
  const open = openFields(tool, session);
  if (open.length === 0) return undefined;
  const id = tool.focus?.(session) ?? open[0]!.id;
  return open.find((f) => f.id === id) ?? open[0]!;
}

export function focusedDraft<S extends ToolSession>(
  tool: Tool<S>,
  session: S,
  scope: Scope,
): Draft | undefined {
  const field = focusedField(tool, session);
  if (!field) return undefined;
  const value = field.get(session);
  const error = fieldError(field, session, scope);
  return {
    id: field.id,
    kind: field.kind,
    value,
    placeholder: field.placeholder,
    invalid: error !== undefined,
    error: error ?? undefined,
  };
}

export function tabSession<S extends ToolSession>(tool: Tool<S>, session: S, dir: 1 | -1): S {
  if (tool.tab) return tool.tab(session, dir);
  const open = openFields(tool, session);
  if (open.length === 0 || !tool.setFocus) return session;
  const ids = open.map((f) => f.id);
  const cur = tool.focus?.(session) ?? ids[0]!;
  const i = max(0, ids.indexOf(cur));
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
  place: import("./types").PlaceHit | undefined,
  scope: Scope | readonly string[] = [],
): KeyOutcome {
  const sc = scopeOf(scope);
  if (e.ctrl || e.meta || e.alt) return { ignore: true };
  if (e.key === "Tab") return { session: tabSession(tool, session, e.shift ? -1 : 1) };
  if (e.key === ",") return { session: tabSession(tool, session, 1) };
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
  if (next === undefined) return { ignore: true };
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

export function splitSlot(line: string): SlotParts | undefined {
  const i = line.indexOf(SLOT_OPEN);
  const j = line.indexOf(SLOT_CLOSE);
  if (i < 0 || j < 0 || j < i) return undefined;
  return {
    before: unmarkSlot(line.slice(0, i)),
    token: line.slice(i + SLOT_OPEN.length, j),
    after: unmarkSlot(line.slice(j + SLOT_CLOSE.length)),
  };
}

export function withSlot(preview: { line: string; hint: string }, draft: Draft | undefined) {
  const parts = splitSlot(preview.line);
  return {
    line: unmarkSlot(preview.line),
    hint: preview.hint,
    ...(draft ? { draft } : {}),
    ...(parts ? { before: parts.before, after: parts.after, token: parts.token } : {}),
  };
}
