import type { TraceNode } from "#eval/context";
import { printExpr } from "#source/expr";

import { asPoint, exprOfPrint, hoverBind, hoverPlace } from "./common";
import { hitRef, nameField, refField, resolveSlot, type RefLooks } from "./draft";
import { scopeFromTrace, toolScope } from "./scope";
import type {
  Field,
  Ghost,
  PlaceCtx,
  PlaceHit,
  Placed,
  Preview,
  Scope,
  TangentOp,
  Tool,
  ToolChrome,
  ToolSession,
  ToolSpec,
  ToolStep,
} from "./types";

/**
 * A declarative ref slot: session field `id` holds the placed value, `idRef`
 * the typed text. Accept / hover / resolve behavior comes from `kind`; only
 * `snap` (hit enrichment while the slot is empty) is per-tool.
 */
export type SlotDef = {
  id: string;
  kind: RefLooks;
  placeholder: string;
  /** Focus after a click fills this slot and no slot is left (default: keep). */
  focusAfter?: string;
  /**
   * This slot's value is the click target of the inserting click itself —
   * a click never fills it; it is typed or consumed by `click`.
   */
  viaClick?: boolean;
  /** Enrich the hit while this slot is the first unfilled one. */
  snap?(hit: PlaceHit, ctx: PlaceCtx): PlaceHit;
};

/** Values that may still be empty — ghost / preview hooks. */
export type SlotToolDef<S extends ToolSession, Vals> = {
  slots: { [K in keyof Vals & string]: SlotDef };
  /** Every slot filled and the canvas clicked. */
  click(session: S, hit: PlaceHit, scope: Scope, vals: Vals): ToolStep;
  /** Every slot filled and Enter pressed. */
  commit?(session: S, place: PlaceHit | undefined, scope: Scope, vals: Vals): ToolStep | undefined;
  /**
   * Override the default click-fill. Return a session to use it, or undefined
   * to fill the active slot normally.
   */
  fill?(
    session: S,
    slotId: string,
    value: Vals[keyof Vals],
    refText: string,
    hit: PlaceHit,
    scope: Scope,
  ): S | undefined;
  /** Hover while every slot is filled (default: nothing). */
  hoverReady?(
    session: S,
    hit: PlaceHit,
    trace: readonly TraceNode[],
    vals: Vals,
  ): string | undefined;
  ghost?(
    session: S,
    place: PlaceHit | undefined,
    scope: Scope,
    vals: { [K in keyof Vals]: Vals[K] | undefined },
  ): Ghost | undefined;
  preview(
    session: S,
    place: PlaceHit | undefined,
    scope: Scope,
    vals: { [K in keyof Vals]: Vals[K] | undefined },
  ): Preview;
  chrome?(session: S): ToolChrome;
};

function readRef(s: ToolSession, id: string): string {
  return (s as unknown as Record<string, string | undefined>)[`${id}Ref`] ?? "";
}

function readValue(s: ToolSession, id: string): unknown {
  return (s as unknown as Record<string, unknown>)[id];
}

/** The operand the cursor is on: a circle stroke, else a point. */
function operandAtHit(hit: PlaceHit): TangentOp {
  if (hit.carrier && hit.carrier.geom.kind === "circle") {
    return {
      kind: "circle",
      circle: { expr: exprOfPrint(hit.carrier.bind), geom: hit.carrier.geom },
    };
  }
  return { kind: "point", placed: asPoint(hit) };
}

/** Resolve a typed operand name: a point or a circle in scope. */
export function resolveOperand(
  ref: string,
  placed: TangentOp | undefined,
  scope: Scope,
): TangentOp | undefined {
  const t = ref.trim();
  if (!t) return placed;
  const raw = resolveSlot("operand", t, undefined, scope);
  if (raw) return "geom" in raw ? { kind: "circle", circle: raw } : { kind: "point", placed: raw };
  if (placed) {
    const printed =
      placed.kind === "point" ? printExpr(placed.placed.expr) : printExpr(placed.circle.expr);
    if (printed === t) return placed;
  }
  return undefined;
}

function defaultAccept(
  kind: RefLooks,
  hit: PlaceHit,
): { value: unknown; refText: string } | undefined {
  const carrier = hit.carrier;
  switch (kind) {
    case "point":
      return { value: asPoint(hit), refText: hitRef(hit) };
    case "carrier":
      if (!carrier || carrier.geom.kind === "circle") return undefined;
      return {
        value: { expr: exprOfPrint(carrier.bind), geom: carrier.geom },
        refText: carrier.bind,
      };
    case "circle":
      if (!carrier || carrier.geom.kind !== "circle") return undefined;
      return {
        value: { expr: exprOfPrint(carrier.bind), geom: carrier.geom },
        refText: carrier.bind,
      };
    case "region":
      if (!hit.region) return undefined;
      return {
        value: { expr: exprOfPrint(hit.region.bind), geom: hit.region.geom },
        refText: hit.region.bind,
      };
    case "operand":
      return { value: operandAtHit(hit), refText: carrier?.bind ?? hitRef(hit) };
  }
}

function defaultHover(
  kind: RefLooks,
  hit: PlaceHit,
  trace: readonly TraceNode[],
): string | undefined {
  switch (kind) {
    case "carrier":
      return hit.carrier ? hoverBind(trace, hit.carrier.bind) : undefined;
    case "operand":
    case "circle":
      if (hit.carrier && hit.carrier.geom.kind === "circle") {
        return hoverBind(trace, hit.carrier.bind);
      }
      return hoverPlace(hit.point, trace);
    case "region":
      return hit.region ? hoverBind(trace, hit.region.bind) : hoverPlace(hit.point, trace);
    case "point":
      return hoverPlace(hit.point, trace);
  }
}

function resolveSlotValue(kind: RefLooks, ref: string, value: unknown, scope: Scope): unknown {
  if (kind === "operand") return resolveOperand(ref, value as TangentOp | undefined, scope);
  return resolveSlot(kind, ref, value as Placed | undefined, scope);
}

/**
 * Build a verb tool from named slots. The driver owns the field list, start
 * state, focus cycling, click fill order, hover, hit snapping, and the
 * commit focus jump; the tool declares only its geometry hooks.
 */
export function defineSlotTool<S extends ToolSession, Vals extends Record<string, unknown>>(
  spec: ToolSpec,
  def: SlotToolDef<S, Vals>,
): Tool<S> {
  const slots = Object.values(def.slots) as SlotDef[];

  const fields = [
    ...slots.map((slot) =>
      refField<S>(
        slot.id,
        slot.placeholder,
        slot.kind,
        (s) => readRef(s, slot.id),
        (s, raw) => ({ ...s, [`${slot.id}Ref`]: raw }) as S,
      ),
    ),
    nameField(),
  ] as Field<S>[];

  function valsOf(session: S, scope: Scope): Vals {
    const out: Record<string, unknown> = {};
    for (const slot of slots) {
      out[slot.id] = resolveSlotValue(
        slot.kind,
        readRef(session, slot.id),
        readValue(session, slot.id),
        scope,
      );
    }
    return out as Vals;
  }

  function firstUnfilled(vals: Vals): SlotDef {
    return slots.find((s) => vals[s.id] === undefined)!;
  }

  const allFilled = (vals: Vals) => slots.every((s) => vals[s.id] !== undefined);

  return {
    spec,
    start: () => {
      const base: Record<string, unknown> = { verb: spec.id, focus: slots[0]!.id, name: "" };
      for (const slot of slots) {
        base[`${slot.id}Ref`] = "";
        base[slot.id] = undefined;
      }
      return base as S;
    },
    fields,
    focus: (s) => (s as unknown as { focus: string }).focus,
    setFocus: (s, id) => ({ ...s, focus: id }) as S,
    hit(session, hit, ctx) {
      const vals = valsOf(session, toolScope(ctx));
      if (allFilled(vals)) return hit;
      return firstUnfilled(vals).snap?.(hit, ctx) ?? hit;
    },
    hover(session, hit, trace, scope) {
      const vals = valsOf(session, scope ?? scopeFromTrace(trace));
      if (allFilled(vals)) return def.hoverReady?.(session, hit, trace, vals);
      return defaultHover(firstUnfilled(vals).kind, hit, trace);
    },
    click(session, hit, scope) {
      const vals = valsOf(session, scope);
      const fillable = slots.filter((s) => !s.viaClick);
      if (fillable.every((s) => vals[s.id] !== undefined)) {
        return def.click(session, hit, scope, vals);
      }
      const slot = fillable.find((s) => vals[s.id] === undefined)!;
      const picked = defaultAccept(slot.kind, hit);
      if (!picked) return { session };
      if (def.fill) {
        const custom = def.fill(
          session,
          slot.id,
          picked.value as Vals[keyof Vals],
          picked.refText,
          hit,
          scope,
        );
        if (custom) return { session: custom };
      }
      const next = slots[slots.indexOf(slot) + 1]?.id;
      const focus =
        (session as unknown as { focus: string }).focus === "name"
          ? "name"
          : (next ?? slot.focusAfter ?? (session as unknown as { focus: string }).focus);
      return {
        session: {
          ...session,
          [slot.id]: picked.value,
          [`${slot.id}Ref`]: picked.refText || readRef(session, slot.id),
          focus,
        } as S,
      };
    },
    commit(session, place, scope) {
      const vals = valsOf(session, scope);
      if (allFilled(vals)) return def.commit?.(session, place, scope, vals) ?? undefined;
      const need = firstUnfilled(vals).id;
      const focus = (session as unknown as { focus: string }).focus;
      if (focus === need) return undefined;
      return { session: { ...session, focus: need } as S };
    },
    ghost(session, place, scope) {
      return def.ghost?.(session, place, scope, valsOf(session, scope));
    },
    preview(session, place, scope) {
      return def.preview(session, place, scope, valsOf(session, scope));
    },
    chrome: def.chrome,
  };
}
