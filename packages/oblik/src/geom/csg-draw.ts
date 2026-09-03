import {
  csgAabb,
  fillAabb,
  isFiniteCsg2,
  isFiniteOperand,
  isFinitePick,
  operandAabb,
  type Aabb,
} from "./csg2";
import { evaluateRegions, islandsAabb, islandsSvgPath } from "./evaluate-regions";
import { compileOffsetBoundary } from "./offset";
import { signedDist } from "./ops";
import { regionSvgPath } from "./region";
import type { Circle, Csg2, CsgOperand, HalfPlane, Offset, Pick, Region } from "./types";
import { lerp, type Vec2 } from "./vec";

export type DrawOp =
  | { kind: "path"; d: string }
  | { kind: "circle"; cx: number; cy: number; r: number };

export type FlattenedCsg = {
  stock: Region | Circle;
  subtract: (Region | Circle)[];
  keep: HalfPlane[];
};

export type CsgDraw =
  | { kind: "solid"; op: DrawOp }
  | { kind: "union"; kids: CsgDraw[] }
  | { kind: "diff"; stock: CsgDraw; cut: CsgDraw[] }
  | { kind: "intersect"; kids: CsgDraw[] }
  | { kind: "clip"; d: string; kid: CsgDraw };

export type CsgPaint = {
  empty: boolean;
  box: Aabb;
  stock: DrawOp;
  holes: DrawOp[];
  keepClip?: string;
  tree?: CsgDraw;
};

/** Luminance polarity. White is visible in the mask. */
export const REGION_MASK = {
  fill: { canvas: "#000", stock: "#fff", hole: "#000" },
  /** Outside the stock region — outward halo on the outer edge. */
  outsideStock: { canvas: "#fff", stock: "#000" },
  /** Interior of the stock region, so hole halos cannot escape the plate. */
  stock: { canvas: "#000", stock: "#fff" },
  /** Complement of the CSG fill (void and holes). */
  outside: { canvas: "#fff", stock: "#000", hole: "#fff" },
} as const;

const emptyPaint = (): CsgPaint => ({
  empty: true,
  box: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  stock: { kind: "path", d: "" },
  holes: [],
});

function padAabb(box: Aabb, pad: number): Aabb {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

function asSolid(op: CsgOperand): Region | Circle | null {
  return op.kind === "region" || op.kind === "circle" ? op : null;
}

/** Paint-only: extra island outers ride as evenodd subpaths. Membership is SDF. */
function packOffsetIslands(islands: Region[]): Region | null {
  if (islands.length === 0) return null;
  if (islands.length === 1) return islands[0]!;
  const extra: Region["holes"] = [...islands[0]!.holes];
  for (let i = 1; i < islands.length; i++) {
    extra.push(islands[i]!.outer, ...islands[i]!.holes);
  }
  return { kind: "region", outer: islands[0]!.outer, holes: extra };
}

function compileOffsetStock(op: Offset): Region | Circle | null {
  return packOffsetIslands(compileOffsetBoundary(op));
}

function unwrapUnary(op: CsgOperand): CsgOperand {
  let node = op;
  while (node.kind === "csg2" && node.op === "union" && node.of.length === 1) {
    node = node.of[0]!;
  }
  return node;
}

export function flattenCsg(op: CsgOperand): FlattenedCsg | null {
  let node: CsgOperand = unwrapUnary(op);
  const keep: HalfPlane[] = [];
  while (node.kind === "csg2" && node.op === "intersect") {
    const rest: CsgOperand[] = [];
    for (const child of node.of) {
      const u = unwrapUnary(child);
      if (u.kind === "halfPlane") keep.push(u);
      else rest.push(u);
    }
    if (rest.length !== 1) return null;
    node = unwrapUnary(rest[0]!);
  }
  const subtract: (Region | Circle)[] = [];
  while (node.kind === "csg2" && node.op === "diff") {
    if (node.of.length < 1) return null;
    for (let i = 1; i < node.of.length; i++) {
      const cut = unwrapUnary(node.of[i]!);
      const solid = asSolid(cut) ?? (cut.kind === "offset" ? compileOffsetStock(cut) : null);
      if (!solid) return null;
      subtract.push(solid);
    }
    node = unwrapUnary(node.of[0]!);
  }
  if (node.kind === "offset") {
    const compiled = compileOffsetStock(node);
    if (!compiled) return null;
    node = compiled;
  }
  if (node.kind !== "region" && node.kind !== "circle") return null;
  return { stock: node, subtract, keep };
}

function drawOp(op: Region | Circle): DrawOp {
  if (op.kind === "circle") {
    return { kind: "circle", cx: op.center.x, cy: op.center.y, r: Math.abs(op.radius) };
  }
  return { kind: "path", d: regionSvgPath(op) };
}

function halfSdf(h: HalfPlane, p: Vec2): number {
  const s = signedDist(p, h.line);
  return h.side === 1 ? -s : s;
}

function aabbPoly(box: Aabb): Vec2[] {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

function clipByHalfPlane(poly: readonly Vec2[], h: HalfPlane): Vec2[] {
  const out: Vec2[] = [];
  if (poly.length === 0) return out;
  const inside = (p: Vec2) => halfSdf(h, p) < 1e-9;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ia = inside(a);
    const ib = inside(b);
    if (ia && ib) out.push(b);
    else if (ia && !ib) {
      const da = halfSdf(h, a);
      const db = halfSdf(h, b);
      out.push(lerp(a, b, da / (da - db)));
    } else if (!ia && ib) {
      const da = halfSdf(h, a);
      const db = halfSdf(h, b);
      out.push(lerp(a, b, da / (da - db)));
      out.push(b);
    }
  }
  return out;
}

function polyPath(poly: readonly Vec2[]): string {
  if (poly.length < 3) return "";
  const s = poly[0]!;
  const parts = [`M ${s.x} ${s.y}`];
  for (let i = 1; i < poly.length; i++) parts.push(`L ${poly[i]!.x} ${poly[i]!.y}`);
  parts.push("Z");
  return parts.join(" ");
}

function keepClipPath(keeps: readonly HalfPlane[], box: Aabb): string | undefined {
  if (keeps.length === 0) return undefined;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  let poly = aabbPoly(padAabb(box, span * 4));
  for (const h of keeps) poly = clipByHalfPlane(poly, h);
  return polyPath(poly);
}

function drawOf(op: CsgOperand, box: Aabb): CsgDraw | null {
  const node = unwrapUnary(op);
  if (node.kind === "region" || node.kind === "circle") return { kind: "solid", op: drawOp(node) };
  if (node.kind === "offset") {
    const compiled = compileOffsetStock(node);
    if (!compiled) return null;
    return { kind: "solid", op: drawOp(compiled) };
  }
  if (node.kind === "halfPlane") {
    const d = keepClipPath([node], box);
    if (!d) return null;
    return { kind: "clip", d, kid: { kind: "solid", op: { kind: "path", d } } };
  }
  if (node.kind === "pick") {
    const d = islandsSvgPath(evaluateRegions(node));
    if (!d) return null;
    return { kind: "solid", op: { kind: "path", d } };
  }
  if (node.kind !== "csg2") return null;
  const kids: CsgDraw[] = [];
  for (const child of node.of) {
    const d = drawOf(child, box);
    if (!d) return null;
    kids.push(d);
  }
  if (kids.length === 0) return null;
  if (node.op === "union") return kids.length === 1 ? kids[0]! : { kind: "union", kids };
  if (node.op === "intersect") return kids.length === 1 ? kids[0]! : { kind: "intersect", kids };
  return { kind: "diff", stock: kids[0]!, cut: kids.slice(1) };
}

function paintBox(op: CsgOperand): Aabb | null {
  const box = op.kind === "csg2" ? csgAabb(op) : operandAabb(op);
  if (!box) return null;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  return padAabb(box, span * 0.08);
}

function paintCompiledIslands(islands: readonly Region[]): CsgPaint {
  const d = islandsSvgPath(islands);
  const box = islandsAabb(islands);
  if (!d || !box) return emptyPaint();
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  return {
    empty: false,
    box: padAabb(box, span * 0.08),
    stock: { kind: "path", d },
    holes: [],
  };
}

/**
 * Exact operand paths plus a luminance mask. Shop trees (diff of solids,
 * optional half-plane intersect) stay stock/holes. Pick paints compiled
 * loops. General trees carry a nested `tree` for SVG masks.
 */
export function csgPaint(op: CsgOperand): CsgPaint {
  if (!isFiniteOperand(op)) return emptyPaint();
  if (op.kind === "pick") return paintCompiledIslands(evaluateRegions(op));
  const box = paintBox(op);
  if (!box) return emptyPaint();
  const shop = flattenCsg(op);
  if (shop) {
    const keepClip = keepClipPath(shop.keep, box);
    if (keepClip === "") return emptyPaint();
    return {
      empty: false,
      box,
      stock: drawOp(shop.stock),
      holes: shop.subtract
        .map(drawOp)
        .filter((d) => (d.kind === "path" ? d.d.length > 0 : d.r > 0)),
      keepClip,
    };
  }
  const tree = drawOf(op, box);
  if (!tree) return emptyPaint();
  return {
    empty: false,
    box,
    stock: { kind: "path", d: "" },
    holes: [],
    tree,
  };
}

export function fillPaint(v: Region | Csg2 | Pick): CsgPaint {
  if (v.kind === "region") {
    const d = regionSvgPath(v);
    if (!d) return emptyPaint();
    const box = fillAabb(v);
    if (!box) return emptyPaint();
    const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
    return {
      empty: false,
      box: padAabb(box, span * 0.08),
      stock: { kind: "path", d },
      holes: [],
    };
  }
  if (v.kind === "pick") {
    if (!isFinitePick(v)) return emptyPaint();
    return csgPaint(v);
  }
  if (!isFiniteCsg2(v)) return emptyPaint();
  return csgPaint(v);
}

function n(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

function aabbAttrs(box: Aabb): string {
  return `x="${n(box.minX)}" y="${n(box.minY)}" width="${n(box.maxX - box.minX)}" height="${n(box.maxY - box.minY)}"`;
}

function svgDrawOp(op: DrawOp, fill: string): string {
  if (op.kind === "circle") {
    return `<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r)}" fill="${fill}" stroke="none"/>`;
  }
  if (!op.d) return "";
  return `<path d="${op.d}" fill-rule="evenodd" fill="${fill}" stroke="none"/>`;
}

export type CsgTreeSvg = { defs: string; body: string };

type TreeBits = { defs: string[]; body: string };

function treeLuminance(node: CsgDraw, id: string, box: Aabb): TreeBits {
  const attrs = aabbAttrs(box);
  const black = `<rect ${attrs} fill="#000"/>`;
  if (node.kind === "solid") return { defs: [], body: svgDrawOp(node.op, "#fff") };
  if (node.kind === "union") {
    const defs: string[] = [];
    let body = "";
    for (let i = 0; i < node.kids.length; i++) {
      const b = treeLuminance(node.kids[i]!, `${id}-u${i}`, box);
      defs.push(...b.defs);
      body += b.body;
    }
    return { defs, body };
  }
  if (node.kind === "diff") {
    const stock = treeLuminance(node.stock, `${id}-s`, box);
    const defs = [...stock.defs];
    let body = stock.body;
    for (let i = 0; i < node.cut.length; i++) {
      const cid = `${id}-c${i}`;
      const cut = treeLuminance(node.cut[i]!, cid, box);
      defs.push(...cut.defs);
      defs.push(`<mask id="${cid}" maskUnits="userSpaceOnUse" ${attrs}>${black}${cut.body}</mask>`);
      body += `<rect ${attrs} fill="#000" mask="url(#${cid})"/>`;
    }
    return { defs, body };
  }
  if (node.kind === "intersect") {
    if (node.kids.length === 0) return { defs: [], body: "" };
    if (node.kids.length === 1) return treeLuminance(node.kids[0]!, id, box);
    const first = treeLuminance(node.kids[0]!, `${id}-a`, box);
    const restNode: CsgDraw =
      node.kids.length === 2 ? node.kids[1]! : { kind: "intersect", kids: node.kids.slice(1) };
    const rest = treeLuminance(restNode, `${id}-r`, box);
    const mid = `${id}-i`;
    return {
      defs: [
        ...first.defs,
        ...rest.defs,
        `<mask id="${mid}" maskUnits="userSpaceOnUse" ${attrs}>${black}${first.body}</mask>`,
      ],
      body: `<g mask="url(#${mid})">${rest.body}</g>`,
    };
  }
  const kid = treeLuminance(node.kid, `${id}-g`, box);
  const cid = `${id}-k`;
  return {
    defs: [...kid.defs, `<clipPath id="${cid}"><path d="${node.d}"/></clipPath>`],
    body: `<g clip-path="url(#${cid})">${kid.body}</g>`,
  };
}

/** Nested luminance (white = in) plus mask/clip defs for a general CSG tree. */
export function csgTreeSvg(node: CsgDraw, id: string, box: Aabb): CsgTreeSvg {
  const bits = treeLuminance(node, id, box);
  return { defs: bits.defs.join(""), body: bits.body };
}

/** @deprecated Use `csgPaint`. */
export const regionPaint = csgPaint;
