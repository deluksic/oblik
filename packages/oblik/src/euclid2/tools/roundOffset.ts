import type { Profile } from "@/geom";
import { roundOffsetValue } from "@/geom/offset";
import { signedDistToProfile } from "@/geom/profile";
import { printExpr } from "@/source/expr";

import { snapProfile } from "../pick";
import { exprOfPrint, hoverBind, previewCall, round } from "./common";
import {
  inSlot,
  lengthField,
  nameField,
  previewName,
  refField,
  resolveProfile,
  withBind,
} from "./draft";
import {
  attachLengthHit,
  lengthHover,
  lengthLabel,
  lengthValue,
  resolveLengthExpr,
} from "./length";
import { scopeFromTrace, toolScope } from "./scope";
import type { Field, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";

type OffsetSession = Extract<ToolSession, { verb: "roundOffset" }>;

const fields: Field<OffsetSession>[] = [
  refField(
    "face",
    "<profile>",
    "profile",
    (s) => s.faceRef,
    (s, raw) => ({ ...s, faceRef: raw }),
  ),
  lengthField("<distance>"),
  nameField(),
];

function faceOf(session: OffsetSession, scope: Scope) {
  return resolveProfile(session.faceRef, session.face, scope);
}

function distAt(hit: PlaceHit, geom: Profile): number {
  const at = hit.point.kind === "free" ? hit.world : hit.point.at;
  const d = signedDistToProfile(geom, at);
  return Number.isFinite(d) ? d : 0;
}

function distExpr(session: OffsetSession, hit: PlaceHit, scope: Scope) {
  const bound = resolveLengthExpr(session, scope);
  if (hit.length) return hit.length.expr;
  if (bound) return bound;
  return { kind: "num" as const, value: round(distAt(hit, faceOf(session, scope)!.geom)) };
}

function faceLabel(session: OffsetSession, scope: Scope, place: PlaceHit | null): string {
  if (session.faceRef.trim()) return session.faceRef.trim();
  const face = faceOf(session, scope);
  if (face) return printExpr(face.expr);
  if (place?.profile) return place.profile.bind;
  return "profile";
}

function offsetGhost(face: Profile, d: number) {
  const islands = roundOffsetValue(face, d);
  const loops = islands.map((p) => p.outer);
  const edges = loops.flat();
  if (edges.length < 2) return null;
  return { kind: "profile" as const, edges, loops };
}

export const roundOffset: Tool<OffsetSession> = {
  spec: {
    id: "roundOffset",
    title: "Round offset",
    hint: "Click a profile, then a length: radius, parallel distance, slider, or a click.",
    prefix: "off",
    aliases: ["inset", "outset"],
  },
  start: () => ({ verb: "roundOffset", focus: "face", faceRef: "", typed: "", name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as OffsetSession["focus"] }),
  hit(session, hit, ctx) {
    if (!faceOf(session, toolScope(ctx))) {
      const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
      const profile = snapProfile(ctx.trace, hit.world, ctx.camera, ctx.size, undefined, filter);
      return profile ? { ...hit, profile } : hit;
    }
    return attachLengthHit(hit, ctx, session, ["radius", "distance"]);
  },
  hover(session, hit, trace, scope) {
    if (!faceOf(session, scope ?? scopeFromTrace(trace))) {
      if (!hit.profile) return null;
      return hoverBind(trace, hit.profile.bind);
    }
    return lengthHover(hit, trace);
  },
  click(session, hit, scope) {
    const face = faceOf(session, scope);
    if (!face) {
      if (!hit.profile) return { session };
      return {
        session: {
          ...session,
          face: { expr: exprOfPrint(hit.profile.bind), geom: hit.profile.geom },
          faceRef: hit.profile.bind,
          focus: session.focus === "name" ? "name" : "typed",
        },
      };
    }
    if (hit.length && resolveLengthExpr(session, scope) == null) {
      return {
        insert: withBind(session, {
          from: "roundOffset",
          args: [face.expr, hit.length.expr],
        }),
      };
    }
    return {
      insert: withBind(session, {
        from: "roundOffset",
        args: [face.expr, distExpr(session, hit, scope)],
      }),
    };
  },
  commit(session, _place, scope) {
    const face = faceOf(session, scope);
    if (!face) {
      if (session.focus !== "face") return { session: { ...session, focus: "face" } };
      return null;
    }
    const bound = resolveLengthExpr(session, scope);
    if (bound) {
      return { insert: withBind(session, { from: "roundOffset", args: [face.expr, bound] }) };
    }
    if (session.focus === "name") return { session: { ...session, focus: "typed" } };
    if (session.focus === "face") return { session: { ...session, focus: "typed" } };
    return null;
  },
  ghost(session, place, scope) {
    const face = faceOf(session, scope);
    if (!face) return null;
    if (resolveLengthExpr(session, scope) != null) {
      const fallback = place?.length?.value ?? 0;
      return offsetGhost(face.geom, lengthValue(session, scope, fallback));
    }
    if (place?.length) {
      return offsetGhost(face.geom, lengthValue(session, scope, place.length.value));
    }
    if (!place) return null;
    return offsetGhost(face.geom, distAt(place, face.geom));
  },
  preview(session, place, scope): Preview {
    const spec = roundOffset.spec;
    const bind = previewName(session, spec.prefix);
    const name = inSlot(session.focus === "name", bind);
    const gTok = inSlot(session.focus === "face", faceLabel(session, scope, place));
    const dLabel = lengthLabel(session, scope, "distance");
    const face = faceOf(session, scope);
    if (!face) {
      const d = inSlot(session.focus === "typed", dLabel);
      return {
        line: `const ${name} = roundOffset(${gTok}, ${d})`,
        hint: place?.profile
          ? `Type a profile name or click ${place.profile.bind}. Tab for distance or name.`
          : spec.hint,
      };
    }
    if (place?.length && resolveLengthExpr(session, scope) == null) {
      return {
        line: previewCall(
          "roundOffset",
          [face.expr, place.length.expr],
          scope.used,
          ([g, d]) => `roundOffset(${inSlot(session.focus === "face", g)}, ${d})`,
          name,
        ),
        hint: "Click to reuse that length. Tab to name it.",
      };
    }
    const bound = resolveLengthExpr(session, scope);
    const shown =
      dLabel !== "distance" ? dLabel : place ? String(round(distAt(place, face.geom))) : "distance";
    return {
      line: previewCall(
        "roundOffset",
        [face.expr, ...(bound ? [bound] : [])],
        scope.used,
        ([g, n]) =>
          `roundOffset(${inSlot(session.focus === "face", g)}, ${inSlot(session.focus === "typed", n ?? shown)})`,
        name,
      ),
      hint: "Type a distance, slider, or field (reach.radius, -shelf.distance), click to reuse, or click to measure. Tab to name it.",
    };
  },
};
