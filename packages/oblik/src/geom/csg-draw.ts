import {
  csgAabb,
  fillAabb,
  isFiniteCsg2,
  isFiniteOperand,
  isFinitePick,
  isFinitePolarRepeat,
  operandAabb,
  repeatAabb,
  type Aabb,
} from "./csg2";
import {
  evaluateRegions,
  islandsAabb,
  islandsSvgPath,
  mergeRepeatOutline,
} from "./evaluate-regions";
import { compileOffsetBoundary } from "./offset";
import { signedDist } from "./ops";
import { regionSvgPath } from "./region";
import type {
  Circle,
  Csg2,
  CsgOperand,
  HalfPlane,
  Offset,
  Pick,
  PolarRepeat,
  Region,
} from "./types";
import { lerp, type Vec2 } from "./vec";

const { abs, hypot, max, min, round } = Math;
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

function asSolid(op: CsgOperand): Region | Circle | undefined {
  return op.kind === "region" || op.kind === "circle" ? op : undefined;
}

/** Paint-only: extra island outers ride as evenodd subpaths. Membership is SDF. */
function packOffsetIslands(islands: Region[]): Region | undefined {
  if (islands.length === 0) return undefined;
  if (islands.length === 1) return islands[0]!;
  const extra: Region["holes"] = [...islands[0]!.holes];
  for (let i = 1; i < islands.length; i++) {
    extra.push(islands[i]!.outer, ...islands[i]!.holes);
  }
  return { kind: "region", outer: islands[0]!.outer, holes: extra };
}

function compileOffsetStock(op: Offset): Region | Circle | undefined {
  return packOffsetIslands(compileOffsetBoundary(op));
}

function unwrapUnary(op: CsgOperand): CsgOperand {
  let node = op;
  while (node.kind === "csg2" && node.op === "union" && node.of.length === 1) {
    node = node.of[0]!;
  }
  return node;
}

export function flattenCsg(op: CsgOperand): FlattenedCsg | undefined {
  let node: CsgOperand = unwrapUnary(op);
  const keep: HalfPlane[] = [];
  while (node.kind === "csg2" && node.op === "intersect") {
    const rest: CsgOperand[] = [];
    for (const child of node.of) {
      const u = unwrapUnary(child);
      if (u.kind === "halfPlane") keep.push(u);
      else rest.push(u);
    }
    if (rest.length !== 1) return undefined;
    node = unwrapUnary(rest[0]!);
  }
  const subtract: (Region | Circle)[] = [];
  while (node.kind === "csg2" && node.op === "diff") {
    if (node.of.length < 1) return undefined;
    for (let i = 1; i < node.of.length; i++) {
      const cut = unwrapUnary(node.of[i]!);
      const solid = asSolid(cut) ?? (cut.kind === "offset" ? compileOffsetStock(cut) : undefined);
      if (!solid) return undefined;
      subtract.push(solid);
    }
    node = unwrapUnary(node.of[0]!);
  }
  if (node.kind === "offset") {
    const compiled = compileOffsetStock(node);
    if (!compiled) return undefined;
    node = compiled;
  }
  if (node.kind !== "region" && node.kind !== "circle") return undefined;
  return { stock: node, subtract, keep };
}

function drawOp(op: Region | Circle): DrawOp {
  if (op.kind === "circle") {
    return { kind: "circle", cx: op.center.x, cy: op.center.y, r: abs(op.radius) };
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
  const span = max(box.maxX - box.minX, box.maxY - box.minY, 1);
  let poly = aabbPoly(padAabb(box, span * 4));
  for (const h of keeps) poly = clipByHalfPlane(poly, h);
  return polyPath(poly);
}

function drawOf(op: CsgOperand, box: Aabb): CsgDraw | undefined {
  const node = unwrapUnary(op);
  if (node.kind === "region" || node.kind === "circle") return { kind: "solid", op: drawOp(node) };
  if (node.kind === "offset") {
    const compiled = compileOffsetStock(node);
    if (!compiled) return undefined;
    return { kind: "solid", op: drawOp(compiled) };
  }
  if (node.kind === "halfPlane") {
    const d = keepClipPath([node], box);
    if (!d) return undefined;
    return { kind: "clip", d, kid: { kind: "solid", op: { kind: "path", d } } };
  }
  if (node.kind === "pick") {
    const d = islandsSvgPath(evaluateRegions(node));
    if (!d) return undefined;
    return { kind: "solid", op: { kind: "path", d } };
  }
  if (node.kind === "polarRepeat") {
    // Stamped, not compiled, and merged: the copies come back as the ring's own
    // outline, so a stroke follows the union rather than every cell seam.
    const d = repeatOutlSvgPath(node);
    if (!d) return undefined;
    return { kind: "solid", op: { kind: "path", d } };
  }
  if (node.kind !== "csg2") return undefined;
  const kids: CsgDraw[] = [];
  for (const child of node.of) {
    const d = drawOf(child, box);
    if (!d) return undefined;
    kids.push(d);
  }
  if (kids.length === 0) return undefined;
  if (node.op === "union") return kids.length === 1 ? kids[0]! : { kind: "union", kids };
  if (node.op === "intersect") return kids.length === 1 ? kids[0]! : { kind: "intersect", kids };
  return { kind: "diff", stock: kids[0]!, cut: kids.slice(1) };
}

/**
 * A repeat — alone, or with solids subtracted — painted straight from its copies.
 *
 * The copies are disjoint by construction (the cell fits its sector), so their
 * paths concatenated under even-odd *are* the union: no boolean, no CSG compile.
 * That matters: `evaluateRegions` on a 40-tooth ring takes seconds, and the
 * paint is rebuilt on every trace tick, so the slow path would freeze the SVG
 * pane the repeat is meant to speed up. Anything this cannot express (a
 * non-solid cut, a boolean around the repeat) falls through to the compiler.
 */
function stampedPaint(op: CsgOperand): CsgPaint | undefined {
  let node = unwrapUnary(op);
  const holes: DrawOp[] = [];
  if (node.kind === "csg2" && node.op === "diff") {
    for (const cut of node.of.slice(1)) {
      const c = unwrapUnary(cut);
      if (c.kind === "region" || c.kind === "circle") holes.push(drawOp(c));
      else if (c.kind === "pick" && isFinitePick(c))
        holes.push({ kind: "path", d: islandsSvgPath(evaluateRegions(c)) });
      else return undefined;
    }
    node = unwrapUnary(node.of[0]!);
  }
  // The stock is the repeat, allowed to be unioned with the hub discs that sit
  // inside it — a hub adds nothing to the outline or the fill the copies do not
  // already have, so it drops out of the paint (see the guard below).
  const kids = node.kind === "csg2" && node.op === "union" ? node.of : [node];
  let rep: PolarRepeat | undefined;
  for (const kid of kids) {
    const k = unwrapUnary(kid);
    if (k.kind === "polarRepeat") {
      if (rep) return undefined;
      rep = k;
    } else if (k.kind !== "circle") {
      return undefined;
    }
  }
  if (!rep) return undefined;
  const merged = mergeRepeatOutline(rep);
  // A hub is only droppable when it is *inside* what the copies already cover:
  // on their axis, and no wider than their outline's inner reach (the root
  // circle, for cells that run to the axis). Anything else is a real union and
  // goes to the tree.
  const inner = outlineInnerRadius(merged, rep.about);
  for (const kid of kids) {
    const k = unwrapUnary(kid);
    if (k.kind !== "circle") continue;
    const off = Math.hypot(k.center.x - rep.about.x, k.center.y - rep.about.y);
    if (off > 1e-9 || abs(k.radius) > inner + 1e-9) return undefined;
  }
  const d = merged
    .map((island) => regionSvgPath(island))
    .filter((one) => one.length > 0)
    .join(" ");
  // The stock's own box: the cuts only take material away, so it still frames
  // the paint (and it is the cheap one — no CSG compile).
  const box = repeatAabb(rep);
  if (!d || !box) return undefined;
  const span = max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  // `mergePaintHoles`, not a separate `holes` list: the mask the SVG view builds
  // paints the *stock path* and nothing else, so a hole is only a hole once it is
  // a subpath of that one even-odd path. A separate list is for stroking holes,
  // not for punching them.
  return mergePaintHoles({
    empty: false,
    box: padAabb(box, span * 0.08),
    stock: { kind: "path", d },
    holes,
  });
}

/** The copies' union outline as one path, and the copies' inner reach: the
 * closest any of those edges comes to the repeat's axis. A hub disc within it is
 * covered by the copies and can be left out of the paint. */
function repeatOutlSvgPath(rep: PolarRepeat): string {
  return mergeRepeatOutline(rep)
    .map((island) => regionSvgPath(island))
    .filter((d) => d.length > 0)
    .join(" ");
}

function outlineInnerRadius(islands: readonly Region[], about: Vec2): number {
  let inner = Infinity;
  for (const island of islands) {
    const loop = island.outer;
    if (!Array.isArray(loop)) {
      inner = NaN;
      break;
    }
    for (const e of loop) {
      inner = min(inner, hypot(e.a.x - about.x, e.a.y - about.y));
      inner = min(inner, hypot(e.b.x - about.x, e.b.y - about.y));
    }
  }
  // A loop that passes within a hair of the axis covers nothing useful: treat a
  // degenerate inner reach as "no hub".
  return Number.isFinite(inner) ? inner : -Infinity;
}

function paintBox(op: CsgOperand): Aabb | undefined {
  const box = op.kind === "csg2" ? csgAabb(op) : operandAabb(op);
  if (!box) return undefined;
  const span = max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  return padAabb(box, span * 0.08);
}

function drawOpPath(op: DrawOp): string {
  if (op.kind === "path") return op.d;
  if (op.kind === "circle") {
    const r = abs(op.r);
    const x = op.cx;
    const y = op.cy;
    return `M ${x + r} ${y} A ${r} ${r} 0 1 1 ${x - r} ${y} A ${r} ${r} 0 1 1 ${x + r} ${y} Z`;
  }
  return "";
}

/** One even-odd path for fill, mask, and halo — outer plus holes as subpaths. */
export function paintSvgPath(paint: CsgPaint): string {
  if (paint.empty || paint.tree) return "";
  return [drawOpPath(paint.stock), ...paint.holes.map(drawOpPath)]
    .filter((d) => d.length > 0)
    .join(" ");
}

function mergePaintHoles(paint: CsgPaint): CsgPaint {
  if (paint.empty || paint.holes.length === 0 || paint.tree) return paint;
  const d = paintSvgPath(paint);
  if (!d) return paint;
  return { ...paint, stock: { kind: "path", d }, holes: [] };
}

function paintCompiledRegion(r: Region): CsgPaint {
  const d = regionSvgPath(r);
  if (!d) return emptyPaint();
  const box = fillAabb(r);
  if (!box) return emptyPaint();
  const span = max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  return {
    empty: false,
    box: padAabb(box, span * 0.08),
    stock: { kind: "path", d },
    holes: [],
  };
}

function paintCompiledIslands(islands: readonly Region[]): CsgPaint {
  if (islands.length === 1) return paintCompiledRegion(islands[0]!);
  const d = islandsSvgPath(islands);
  const box = islandsAabb(islands);
  if (!d || !box) return emptyPaint();
  const span = max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
  return {
    empty: false,
    box: padAabb(box, span * 0.08),
    stock: { kind: "path", d },
    holes: [],
  };
}

/**
 * Compiled islands when evaluateRegions produced cheese. Shop flatten and
 * luminance trees are fallbacks for empty compile (unbounded clips).
 */
export function csgPaint(op: CsgOperand): CsgPaint {
  if (!isFiniteOperand(op)) return emptyPaint();
  const stamped = stampedPaint(op);
  if (stamped) return stamped;
  const islands = evaluateRegions(op);
  if (islands.length > 0) return paintCompiledIslands(islands);
  const box = paintBox(op);
  if (!box) return emptyPaint();
  const shop = flattenCsg(op);
  if (shop) {
    const keepClip = keepClipPath(shop.keep, box);
    if (keepClip === "") return emptyPaint();
    return mergePaintHoles({
      empty: false,
      box,
      stock: drawOp(shop.stock),
      holes: shop.subtract
        .map(drawOp)
        .filter((d) => (d.kind === "path" ? d.d.length > 0 : d.r > 0)),
      keepClip,
    });
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

export function fillPaint(v: Region | Csg2 | Pick | PolarRepeat): CsgPaint {
  const hit = fillPaintCache.get(v);
  if (hit) return hit;
  const out = fillPaintFresh(v);
  fillPaintCache.set(v, out);
  return out;
}

const fillPaintCache = new WeakMap<Region | Csg2 | Pick | PolarRepeat, CsgPaint>();

function fillPaintFresh(v: Region | Csg2 | Pick | PolarRepeat): CsgPaint {
  if (v.kind === "region") {
    const d = regionSvgPath(v);
    if (!d) return emptyPaint();
    const box = fillAabb(v);
    if (!box) return emptyPaint();
    const span = max(box.maxX - box.minX, box.maxY - box.minY, 1e-3);
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
  if (v.kind === "polarRepeat") {
    if (!isFinitePolarRepeat(v)) return emptyPaint();
    return csgPaint(v);
  }
  if (!isFiniteCsg2(v)) return emptyPaint();
  return csgPaint(v);
}

function n(v: number): string {
  return (round(v * 1000) / 1000).toString();
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
