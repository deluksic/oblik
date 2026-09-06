import type { Expr } from "#source/expr";

import { round } from "./common";
import { inSlot, nameField, previewName, withBind } from "./draft";
import { attachLengthHit, lengthRefName, numberField, resolveNumberExpr } from "./length";
import type { Field, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";

const { max, sqrt } = Math;
type SliderSession = Extract<ToolSession, { verb: "slider" }>;

const fields: Field<SliderSession>[] = [
  numberField(
    "value",
    "<value>",
    (s) => s.value,
    (s, raw) => ({ ...s, value: raw }),
  ),
  numberField(
    "min",
    "<min>",
    (s) => s.min,
    (s, raw) => ({ ...s, min: raw }),
  ),
  numberField(
    "max",
    "<max>",
    (s) => s.max,
    (s, raw) => ({ ...s, max: raw }),
  ),
  numberField(
    "step",
    "<step>",
    (s) => s.step,
    (s, raw) => ({ ...s, step: raw }),
  ),
  nameField(),
];

function measure(hit: PlaceHit): number {
  return round(max(0.05, sqrt(hit.world.x * hit.world.x + hit.world.y * hit.world.y) || 1));
}

function optProp(raw: string, scope: Scope): Expr | undefined {
  return resolveNumberExpr(raw, scope) ?? undefined;
}

function sliderArgs(session: SliderSession, value: Expr, scope: Scope): Expr[] {
  const props: Record<string, Expr> = {};
  const minExpr = optProp(session.min, scope);
  if (minExpr) props.min = minExpr;
  const maxExpr = optProp(session.max, scope);
  if (maxExpr) props.max = maxExpr;
  const step = optProp(session.step, scope);
  if (step) props.step = step;
  return [value, { kind: "props", props }];
}

function valueExpr(session: SliderSession, scope: Scope, fallback: number): Expr {
  return (
    resolveNumberExpr(session.value, scope, fallback) ?? { kind: "num", value: round(fallback) }
  );
}

function insertValue(session: SliderSession, value: Expr, scope: Scope) {
  return { insert: withBind(session, { from: "slider", args: sliderArgs(session, value, scope) }) };
}

function optSlot(
  session: SliderSession,
  field: SliderSession["focus"],
  raw: string,
  label: string,
): string {
  return inSlot(session.focus === field, raw.trim() || label);
}

const NUMERIC_FOCUS = new Set<SliderSession["focus"]>(["value", "min", "max", "step"]);

export const slider: Tool<SliderSession> = {
  spec: {
    id: "slider",
    title: "Slider",
    hint: "A named number. Tab for min, max, step. Click to measure from the origin.",
    prefix: "n",
  },
  start: () => ({
    verb: "slider",
    focus: "value",
    value: "",
    min: "",
    max: "",
    step: "",
    name: "",
  }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as SliderSession["focus"] }),
  hit(session, hit, ctx) {
    if (!NUMERIC_FOCUS.has(session.focus)) return hit;
    const typed =
      session.focus === "value"
        ? session.value
        : session.focus === "min"
          ? session.min
          : session.focus === "max"
            ? session.max
            : session.step;
    return attachLengthHit(hit, ctx, { typed });
  },
  click(session, hit, scope) {
    if (hit.length && NUMERIC_FOCUS.has(session.focus)) {
      const raw = lengthRefName(hit.length.expr);
      if (!raw) return { session };
      const next =
        session.focus === "value"
          ? { ...session, value: raw }
          : session.focus === "min"
            ? { ...session, min: raw }
            : session.focus === "max"
              ? { ...session, max: raw }
              : { ...session, step: raw };
      const value = valueExpr(next, scope, hit.length.value);
      if (session.focus === "value") return insertValue(next, value, scope);
      return { session: next };
    }
    const bound = resolveNumberExpr(session.value, scope);
    if (bound) return insertValue(session, bound, scope);
    return insertValue(session, { kind: "num", value: measure(hit) }, scope);
  },
  commit(session, place, scope) {
    const bound = resolveNumberExpr(session.value, scope);
    if (bound) return insertValue(session, bound, scope);
    if (place) return insertValue(session, { kind: "num", value: measure(place) }, scope);
    if (session.focus !== "value") return { session: { ...session, focus: "value" } };
    return undefined;
  },
  ghost() {
    return undefined;
  },
  preview(session): Preview {
    const bind = previewName(session, slider.spec.prefix);
    const value = optSlot(session, "value", session.value, "<value>");
    const min = optSlot(session, "min", session.min, "<min>");
    const maxSlot = optSlot(session, "max", session.max, "<max>");
    const step = optSlot(session, "step", session.step, "<step>");
    const name = inSlot(session.focus === "name", bind);
    return {
      line: `const ${name} = slider(${value}, { min: ${min}, max: ${maxSlot}, step: ${step} })`,
      hint: slider.spec.hint,
    };
  },
};
