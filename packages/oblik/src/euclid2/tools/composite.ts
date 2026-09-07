import type { Annotation } from "../../source/analyze";
import type { TraceNode } from "#eval/context";
import { withEval, type EvalCtx } from "#eval/context";
import type { Region } from "#geom";
import { signedDistToRegion } from "#geom/region";
import { printExpr, type Expr } from "#source/expr";

import { snapLineCarrier, snapRegion, type Vec2 } from "../pick";
import { isPinnedPoint } from "../place";
import { asPoint, dist, exprOfPlace, exprOfPrint, hoverBind, hoverPlace, round } from "./common";
import { inSlot, nameField, parseNum, previewName, withBind } from "./draft";
import { attachLengthHit, evalLengthExpr, lengthHover, parseLengthTyped } from "./length";
import type {
  CompositeFill,
  Field,
  InsertJob,
  PlaceHit,
  Preview,
  RegisteredTool,
  Scope,
  Tool,
  ToolArg,
  ToolSession,
} from "./types";

type CompS = Extract<ToolSession, { tool: RegisteredTool }>;

let ghostSerial = 0;

function typedText(s: CompS, label: string): string {
  const f = s.fills[label];
  return f?.kind === "text" ? f.raw : "";
}

function argAt(s: CompS, label: string): ToolArg | undefined {
  return s.tool.args.find((a) => a.label === label);
}

function argIndex(s: CompS, label: string): number {
  return s.tool.args.findIndex((a) => a.label === label);
}

/**
 * An arg is *satisfied* when a commit could use it as-is: point/region/segment
 * need a click or a mention; a number is satisfied by a typed value or its def;
 * a length is satisfied by a gesture or typed text — except an anchored length
 * still sitting on its default text, which stays unsatisfied so a follow-up
 * click can measure it.
 */
function satisfied(s: CompS, arg: ToolArg): boolean {
  const f = s.fills[arg.label];
  if (arg.kind === "point" || arg.kind === "region" || arg.kind === "segment") {
    return f !== undefined;
  }
  if (arg.kind === "number") return f !== undefined || arg.def !== undefined;
  // length
  if (f?.kind === "expr") return true;
  if (f?.kind === "text") {
    if (f.raw.trim() !== "") return arg.anchor === undefined || f.raw.trim() !== String(arg.def);
    return false;
  }
  return false;
}

/**
 * The user has actually started this tool: something was clicked/measured, or a
 * required arg was typed. Defaults alone (and the cursor) do not count — no
 * shape appears before the first real fill.
 */
function engaged(s: CompS): boolean {
  for (const arg of s.tool.args) {
    const f = s.fills[arg.label];
    if (f?.kind === "expr") return true;
    if (f?.kind !== "text") continue;
    const t = f.raw.trim();
    if (t === "") continue;
    if (
      (arg.kind === "number" || arg.kind === "length") &&
      arg.def !== undefined &&
      t === String(arg.def)
    ) {
      continue; // an untouched default prefill
    }
    return true;
  }
  return false;
}

function withFill(s: CompS, label: string, fill: CompositeFill): CompS {
  return { ...s, fills: { ...s.fills, [label]: fill } };
}

/** Focus the first unsatisfied arg after `after`; otherwise `"name"`. */
function focusNext(s: CompS, after: string): CompS {
  const from = Math.max(0, argIndex(s, after));
  for (let i = from + 1; i < s.tool.args.length; i++) {
    const arg = s.tool.args[i];
    if (arg && !satisfied(s, arg)) return { ...s, focus: arg.label };
  }
  for (let i = 0; i < s.tool.args.length; i++) {
    const arg = s.tool.args[i];
    if (arg && !satisfied(s, arg)) return { ...s, focus: arg.label };
  }
  return { ...s, focus: "name" };
}

// ---- value / expr resolution per arg kind -----------------------------------

function pointValue(s: CompS, scope: Scope, label: string): Vec2 | undefined {
  const f = s.fills[label];
  if (!f) return undefined;
  if (f.kind === "expr") {
    if (f.at) return f.at;
    if (f.expr.kind === "call" && f.expr.name === "point") {
      const [x, y] = f.expr.args;
      if (x?.kind === "num" && y?.kind === "num") return { x: x.value, y: y.value };
    }
    return scope.points[printExpr(f.expr)]?.at;
  }
  const t = f.raw.trim();
  if (!t) return undefined;
  return scope.points[t]?.at;
}

function pointExpr(s: CompS, scope: Scope, label: string): Expr | undefined {
  const f = s.fills[label];
  if (!f) return undefined;
  if (f.kind === "expr") return f.expr;
  const t = f.raw.trim();
  if (!t) return undefined;
  return scope.points[t]?.expr;
}

function regionExpr(s: CompS, scope: Scope, label: string): Expr | undefined {
  const f = s.fills[label];
  if (!f) return undefined;
  if (f.kind === "expr") return f.expr;
  const t = f.raw.trim();
  if (!t) return undefined;
  return scope.regions[t]?.expr;
}

function regionGeom(s: CompS, scope: Scope, label: string): Region | undefined {
  const f = s.fills[label];
  if (!f) return undefined;
  if (f.kind === "expr") return scope.regions[printExpr(f.expr)]?.geom;
  const t = f.raw.trim();
  if (!t) return undefined;
  return scope.regions[t]?.geom;
}

function segmentExpr(s: CompS, scope: Scope, label: string): Expr | undefined {
  const f = s.fills[label];
  if (!f) return undefined;
  const t = f.kind === "text" ? f.raw.trim() : printExpr(f.expr);
  if (!t) return undefined;
  const c = scope.carriers[t];
  return c && c.geom.kind === "segment" ? c.expr : undefined;
}

function segmentGeom(
  s: CompS,
  scope: Scope,
  label: string,
): { kind: "segment"; a: Vec2; b: Vec2 } | undefined {
  const f = s.fills[label];
  if (!f) return undefined;
  const t = f.kind === "text" ? f.raw.trim() : printExpr(f.expr);
  if (!t) return undefined;
  const c = scope.carriers[t];
  return c && c.geom.kind === "segment" ? (c.geom as { kind: "segment"; a: Vec2; b: Vec2 }) : undefined;
}

function anchorGeom(s: CompS, scope: Scope, label: string): Anchor | undefined {
  const arg = argAt(s, label);
  if (!arg) return undefined;
  if (arg.kind === "point") {
    const at = pointValue(s, scope, label);
    return at ? { at } : undefined;
  }
  if (arg.kind === "region") {
    const geom = regionGeom(s, scope, label);
    return geom ? { geom } : undefined;
  }
  return undefined;
}

type Anchor = { at?: Vec2; geom?: Region };

function atOf(place: PlaceHit): Vec2 {
  return place.point.kind === "free" ? place.world : place.point.at;
}

function measureToPlace(anchor: Anchor, place: PlaceHit): number | undefined {
  const at = atOf(place);
  if (anchor.at) return dist(anchor.at, at);
  if (anchor.geom) {
    const d = signedDistToRegion(anchor.geom, at);
    return Number.isFinite(d) ? round(d) : undefined;
  }
  return undefined;
}

/** Number for a length/number arg: gesture cache, typed text, cursor draft, def. */
function numericValue(
  s: CompS,
  scope: Scope,
  arg: ToolArg,
  place: PlaceHit | undefined,
): number | undefined {
  if (arg.kind !== "length" && arg.kind !== "number") return undefined;
  const f = s.fills[arg.label];
  if (f?.kind === "expr") {
    if (f.value !== undefined) return f.value;
    const v = evalLengthExpr(f.expr, scope);
    if (v !== undefined) return v;
  }
  const t = typedText(s, arg.label).trim();
  // Only an untouched arg (empty, or still its default) drafts from the cursor —
  // a typed value wins and no ghost appears for a required arg the user has
  // not populated.
  const untouched = arg.def !== undefined ? t === String(arg.def) : t === "";
  if (s.focus === arg.label && place && untouched) {
    if (place.length) return place.length.value;
    const anchor =
      arg.kind === "length" && arg.anchor ? anchorGeom(s, scope, arg.anchor) : undefined;
    if (anchor) {
      const v = measureToPlace(anchor, place);
      if (v !== undefined) return v;
    }
  }
  if (t !== "") {
    if (arg.kind === "number") return parseNum(t);
    const e = parseLengthTyped(t, scope);
    const v = e ? evalLengthExpr(e, scope) : undefined;
    if (v !== undefined) return v;
  }
  if (arg.def !== undefined) return arg.def;
  return undefined;
}

/** Commit Expr for a length/number arg; numbers always become numeric literals. */
function numericExpr(s: CompS, scope: Scope, arg: ToolArg): Expr | undefined {
  if (arg.kind !== "length" && arg.kind !== "number") return undefined;
  const f = s.fills[arg.label];
  if (arg.kind === "number") {
    if (f?.kind === "expr") return f.value !== undefined ? { kind: "num", value: f.value } : undefined;
    const t = typedText(s, arg.label).trim();
    const n = t !== "" ? parseNum(t) : undefined;
    if (n !== undefined) return { kind: "num", value: n };
    if (arg.def !== undefined) return { kind: "num", value: arg.def };
    return undefined;
  }
  if (f?.kind === "expr") return f.expr;
  const t = typedText(s, arg.label).trim();
  if (t !== "") {
    const e = parseLengthTyped(t, scope);
    if (e) return e;
    return undefined;
  }
  if (arg.def !== undefined) return { kind: "num", value: arg.def };
  return undefined;
}

/** Insert job when every arg resolves; else the first missing arg's label. */
function tryJob(s: CompS, scope: Scope): { job?: InsertJob; missing?: string } {
  const args: Expr[] = [];
  for (const arg of s.tool.args) {
    let e: Expr | undefined;
    if (arg.kind === "point") e = pointExpr(s, scope, arg.label);
    else if (arg.kind === "region") e = regionExpr(s, scope, arg.label);
    else if (arg.kind === "segment") e = segmentExpr(s, scope, arg.label);
    else e = numericExpr(s, scope, arg);
    if (!e) return { missing: arg.label };
    args.push(e);
  }
  const job: InsertJob = {
    from: s.tool.name,
    args,
    tool: { module: s.tool.module, prefix: s.tool.prefix },
  };
  return { job: withBind(s, job) };
}

/** Anchored measure fill: dist-to-point (live for pinned) or signed region offset. */
function measureFill(
  s: CompS,
  scope: Scope,
  arg: Extract<ToolArg, { kind: "length" }>,
  hit: PlaceHit,
): CompositeFill | undefined {
  if (!arg.anchor) return undefined;
  const anchor = anchorGeom(s, scope, arg.anchor);
  if (!anchor) return undefined;
  const at = atOf(hit);
  if (anchor.at) {
    const anchorExpr = pointExpr(s, scope, arg.anchor);
    if (!anchorExpr) return undefined;
    const value = round(dist(anchor.at, at));
    if (isPinnedPoint(hit.point)) {
      return {
        kind: "expr",
        expr: { kind: "call", name: "dist", args: [anchorExpr, exprOfPlace(hit.point)] },
        value,
      };
    }
    return { kind: "expr", expr: { kind: "num", value }, value };
  }
  if (anchor.geom) {
    const d = signedDistToRegion(anchor.geom, at);
    if (!Number.isFinite(d)) return undefined;
    const value = round(d);
    return { kind: "expr", expr: { kind: "num", value }, value };
  }
  return undefined;
}

// ---- fields & preview -------------------------------------------------------

function placeholderFor(arg: ToolArg): string {
  if (arg.kind === "point") return "<point>";
  if (arg.kind === "region") return "<region>";
  if (arg.kind === "segment") return "<segment>";
  return "<n>";
}

function fieldFor(arg: ToolArg): Field<CompS> {
  const base = {
    id: arg.label,
    placeholder: placeholderFor(arg),
    open: () => true,
    get: (s: CompS) => typedText(s, arg.label),
    set: (s: CompS, raw: string) => withFill(s, arg.label, { kind: "text", raw }),
  };
  if (arg.kind === "point") return { ...base, kind: "ref", looks: "point" };
  if (arg.kind === "region") return { ...base, kind: "ref", looks: "region" };
  if (arg.kind === "segment") return { ...base, kind: "ref", looks: "carrier" };
  if (arg.kind === "length") return { ...base, kind: "length" };
  return { ...base, kind: "number" };
}

function fieldsFor(reg: RegisteredTool): Field<CompS>[] {
  const fs = reg.args.map((a) => fieldFor(a));
  fs.push(nameField());
  return fs;
}

function token(s: CompS, scope: Scope, place: PlaceHit | undefined, arg: ToolArg): string {
  const f = s.fills[arg.label];
  if (f?.kind === "expr") return printExpr(f.expr);
  const t = typedText(s, arg.label).trim();
  if (t !== "") return t;
  const n = numericValue(s, scope, arg, place);
  if (n !== undefined) return String(Math.round(n * 100) / 100);
  return `<${arg.label}>`;
}

function argHint(arg: ToolArg): string {
  switch (arg.kind) {
    case "point":
      return `${arg.label}: click a point, or empty space to place one.`;
    case "region":
      return `${arg.label}: click a face, or type its name.`;
    case "segment":
      return `${arg.label}: click a segment, or type its name.`;
    case "number":
      return arg.def !== undefined
        ? `${arg.label}: a number (default ${arg.def}) — type or click a length to reuse.`
        : `${arg.label}: a number — type it, or click a length to reuse.`;
    default:
      return arg.anchor
        ? `${arg.label}: type a length, click one, or measure from ${arg.anchor}.`
        : `${arg.label}: type a length, or click an existing one to reuse it.`;
  }
}

// ---- ghost draft-eval -------------------------------------------------------

/**
 * Run the tool fn in a throwaway eval ctx and return the nodes its constructor
 * calls emitted. Ids come from the fn's own stamped source and are shared by
 * every call of the tool; the view re-ids them per draft so a ghost of a second
 * placement renders alongside live geometry of the first.
 */
export function runToolTrace(
  fn: (...values: unknown[]) => unknown,
  values: readonly unknown[],
): TraceNode[] {
  const ctx: EvalCtx = {
    draft: new Map(),
    trace: [],
    annotations: new Map<string, Annotation>(),
    occ: new Map(),
    captureStack: false,
  };
  try {
    withEval(ctx, () => fn(...values));
  } catch {
    // Degenerate draft values — the ghost is simply absent.
  }
  return ctx.trace;
}

export function compileComposite(reg: RegisteredTool): Tool<CompS> {
  const tool: Tool<CompS> = {
    spec: {
      id: reg.name,
      title: reg.title,
      hint: reg.hint,
      prefix: reg.prefix,
    },
    start: () => {
      const fills: Record<string, CompositeFill> = {};
      for (const a of reg.args) {
        if (a.kind === "length" || a.kind === "number") {
          if (a.def !== undefined) fills[a.label] = { kind: "text", raw: String(a.def) };
        }
      }
      const base: CompS = {
        verb: "composite",
        tool: reg,
        focus: "name",
        fills,
        name: "",
      };
      const first = base.tool.args.find((a) => !satisfied(base, a));
      return { ...base, focus: first?.label ?? base.tool.args[0]?.label ?? "name" };
    },
    fields: fieldsFor(reg),
    focus: (s) => s.focus,
    setFocus: (s, id) => ({ ...s, focus: id }),
    hit(session, hit, ctx) {
      const arg = argAt(session, session.focus);
      if (!arg) return hit;
      if (arg.kind === "point") return hit;
      if (arg.kind === "region") {
        const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
        const picked = snapRegion(ctx.trace, hit.world, ctx.camera, ctx.size, undefined, filter);
        return picked ? { ...hit, region: picked } : hit;
      }
      if (arg.kind === "segment") {
        const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
        const picked = snapLineCarrier(
          ctx.trace,
          hit.world,
          ctx.camera,
          ctx.size,
          undefined,
          filter,
        );
        if (!picked || picked.geom.kind !== "segment") return hit;
        return { ...hit, carrier: picked };
      }
      const draft = { typed: typedText(session, session.focus) };
      return attachLengthHit(hit, ctx, draft, ["radius", "distance"]);
    },
    hover(session, hit, trace) {
      const arg = argAt(session, session.focus);
      if (!arg) return undefined;
      if (arg.kind === "point") return hoverPlace(hit.point, trace);
      if (arg.kind === "region") {
        if (!hit.region) return undefined;
        return hoverBind(trace, hit.region.bind);
      }
      if (arg.kind === "segment") {
        if (!hit.carrier) return undefined;
        return hoverBind(trace, hit.carrier.bind);
      }
      return lengthHover(hit, trace);
    },
    click(session, hit, scope) {
      const arg = argAt(session, session.focus);
      if (!arg || session.focus === "name") return { session };
      let fill: CompositeFill | undefined;
      if (arg.kind === "point") {
        if (satisfied(session, arg)) return { session };
        const placed = asPoint(hit);
        fill = { kind: "expr", expr: placed.expr, at: placed.at };
      } else if (arg.kind === "region") {
        if (!hit.region || satisfied(session, arg)) return { session };
        // Mention prints can be member paths (`rec.face`) — keep the expr
        // member-aware so the insert scope check sees `rec`, not `rec.face`.
        fill = { kind: "expr", expr: exprOfPrint(hit.region.bind) };
      } else if (arg.kind === "segment") {
        if (!hit.carrier || hit.carrier.geom.kind !== "segment" || satisfied(session, arg)) {
          return { session };
        }
        fill = { kind: "expr", expr: exprOfPrint(hit.carrier.bind) };
      } else {
        // length / number: click only via a meaningful gesture
        if (hit.length) {
          fill = { kind: "expr", expr: hit.length.expr, value: hit.length.value };
        } else if (arg.kind === "length" && arg.anchor) {
          const t = typedText(session, arg.label).trim();
          if (t === "" || t === String(arg.def)) {
            fill = measureFill(session, scope, arg, hit);
          }
        }
        if (!fill) return { session };
      }
      const next = focusNext(withFill(session, arg.label, fill), arg.label);
      // Only auto-insert when the fill completed the tool (focus moved to name);
      // otherwise stay in the session so the user can measure/type further.
      if (next.focus !== "name") return { session: next };
      const { job, missing } = tryJob(next, scope);
      if (!job) return { session: missing ? { ...next, focus: missing } : next };
      return { insert: job };
    },
    commit(session, _place, scope) {
      const { job, missing } = tryJob(session, scope);
      if (!job) {
        if (missing && session.focus !== missing) return { session: { ...session, focus: missing } };
        return undefined;
      }
      return { insert: job };
    },
    ghost(session, place, scope) {
      // No shape before the user has actually started: a canvas arg must get a
      // real click/mention first, and required args must be populated (typed,
      // clicked, or draft-measured at the cursor).
      const hasCanvas = session.tool.args.some(
        (a) => a.kind === "point" || a.kind === "region" || a.kind === "segment",
      );
      if (hasCanvas && !engaged(session)) return undefined;
      const values: unknown[] = [];
      for (const arg of session.tool.args) {
        let v: unknown;
        if (arg.kind === "point") {
          v = pointValue(session, scope, arg.label);
          if (v === undefined && session.focus === arg.label && place) {
            v = place.point.kind === "free" ? place.world : place.point.at;
          }
        } else if (arg.kind === "region") {
          v = regionGeom(session, scope, arg.label);
          if (v === undefined && session.focus === arg.label && place?.region) v = place.region.geom;
        } else if (arg.kind === "segment") {
          v = segmentGeom(session, scope, arg.label);
          if (v === undefined && session.focus === arg.label && place?.carrier) {
            v = place.carrier.geom.kind === "segment" ? place.carrier.geom : undefined;
          }
        } else {
          v = numericValue(session, scope, arg, place);
        }
        if (v === undefined) return undefined;
        values.push(v);
      }
      const nodes = runToolTrace(session.tool.fn, values);
      if (nodes.length === 0) return undefined;
      return { kind: "trace", stamp: `gh-${session.tool.name}-${ghostSerial++}`, nodes };
    },
    preview(session, place, scope): Preview {
      const parts: string[] = [];
      for (const arg of session.tool.args) {
        const text = token(session, scope, place, arg);
        parts.push(inSlot(session.focus === arg.label, text));
      }
      const bind = inSlot(session.focus === "name", previewName(session, reg.prefix));
      const hint = argHintAt(session);
      return { line: `const ${bind} = ${reg.name}(${parts.join(", ")})`, hint };
    },
  };
  return tool;
}

function argHintAt(s: CompS): string {
  const arg = argAt(s, s.focus);
  if (arg) return argHint(arg);
  return s.tool.hint || `${s.tool.name}: press Enter to insert.`;
}

export type { CompS };
