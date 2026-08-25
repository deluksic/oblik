import type { Expr } from "../../source/expr";
import { inSlot, nameField, parseNum, previewName, withBind } from "./draft";
import { round } from "./common";
import type { Field, PlaceHit, Preview, Tool, ToolSession } from "./types";

type SliderSession = Extract<ToolSession, { verb: "slider" }>;

const fields: Field<SliderSession>[] = [
  {
    id: "value",
    kind: "number",
    placeholder: "<value>",
    open: () => true,
    get: (s) => s.value,
    set: (s, raw) => ({ ...s, value: raw }),
  },
  {
    id: "min",
    kind: "number",
    placeholder: "<min>",
    open: () => true,
    get: (s) => s.min,
    set: (s, raw) => ({ ...s, min: raw }),
  },
  {
    id: "max",
    kind: "number",
    placeholder: "<max>",
    open: () => true,
    get: (s) => s.max,
    set: (s, raw) => ({ ...s, max: raw }),
  },
  {
    id: "step",
    kind: "number",
    placeholder: "<step>",
    open: () => true,
    get: (s) => s.step,
    set: (s, raw) => ({ ...s, step: raw }),
  },
  nameField(),
];

function measure(hit: PlaceHit): number {
  return round(Math.max(0.05, Math.hypot(hit.world.x, hit.world.y) || 1));
}

function sliderArgs(session: SliderSession, value: number): Expr[] {
  const props: Record<string, Expr> = {};
  const min = parseNum(session.min);
  if (min != null) props.min = { kind: "num", value: min };
  const max = parseNum(session.max);
  if (max != null) props.max = { kind: "num", value: max };
  const step = parseNum(session.step);
  if (step != null) props.step = { kind: "num", value: step };
  return [{ kind: "num", value: round(value) }, { kind: "props", props }];
}

function insertValue(session: SliderSession, value: number) {
  return { insert: withBind(session, { from: "slider", args: sliderArgs(session, value) }) };
}

function optSlot(session: SliderSession, field: SliderSession["focus"], raw: string, label: string): string {
  return inSlot(session.focus === field, raw.trim() || label);
}

export const slider: Tool<SliderSession> = {
  spec: {
    id: "slider",
    title: "Slider",
    hint: "A named number. Tab for min, max, step. Click to measure from the origin.",
    prefix: "n",
  },
  start: () => ({ verb: "slider", focus: "value", value: "", min: "", max: "", step: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as SliderSession["focus"] }),
  click(session, hit) {
    const typed = parseNum(session.value);
    return insertValue(session, typed != null ? Math.max(0.05, typed) : measure(hit));
  },
  commit(session, place) {
    const typed = parseNum(session.value);
    if (typed != null) return insertValue(session, typed);
    if (place) return insertValue(session, measure(place));
    if (session.focus !== "value") return { session: { ...session, focus: "value" } };
    return null;
  },
  ghost() {
    return null;
  },
  preview(session): Preview {
    const bind = previewName(session, slider.spec.prefix);
    const value = optSlot(session, "value", session.value, "<value>");
    const min = optSlot(session, "min", session.min, "<min>");
    const max = optSlot(session, "max", session.max, "<max>");
    const step = optSlot(session, "step", session.step, "<step>");
    const name = inSlot(session.focus === "name", bind);
    return {
      line: `const ${name} = slider(${value}, { min: ${min}, max: ${max}, step: ${step} })`,
      hint: slider.spec.hint,
    };
  },
};
