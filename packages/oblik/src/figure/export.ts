import type { TraceNode } from "../eval/context";
import { paintStrokesFromTrace, type FigureStyle, type PaintStroke } from "../eval/paint";
import { csgTreeSvg, fillPaint, type DrawOp } from "../geom/csg-draw";
import { fillAabb } from "../geom/csg2";
import { isGlider } from "../geom/gliders";
import { infiniteLineAxis } from "../geom/ops";
import { isCircleWalk, regionSvgPath, walkEdges } from "../geom/region";
import type { Csg2, Pick } from "../geom/types";
import type { Vec2 } from "../geom/vec";
import { frameRect, type FigureFrame } from "./frame";

const { abs, max, min, round } = Math;
export type FigureExportOptions = {
  trace: readonly TraceNode[];
  frame?: FigureFrame;
  paper?: "cream" | "white";
  /** Scene look-at + world scale. Centers the frame and sets output resolution. */
  camera?: { x: number; y: number; scale: number };
  title?: string;
  file?: string;
  /** Draw the paper background rectangle. Defaults to true. */
  background?: boolean;
};

export type FigureExport = {
  svg: string;
  width: number;
  height: number;
  filename: string;
  /** True when the figure has no painted ink to export. */
  empty: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };

const DEFAULT_STROKE = "#1c1917";
const DEFAULT_STROKE_WIDTH = 1.35;
const DEFAULT_POINT_WIDTH = 1.2;
const PAPER_FILL: Record<"cream" | "white", string> = { cream: "#f5f5f4", white: "#ffffff" };
const MAX_DIM = 2000;
const MIN_DIM = 48;

function num(n: number): string {
  return (round(n * 1000) / 1000).toString();
}

function clamp(n: number, lo: number, hi: number): number {
  return min(hi, max(lo, n));
}

/** Clip an infinite line (origin + direction) to a rectangle. Liang–Barsky. */
function clipInfiniteLine(origin: Vec2, dir: Vec2, rect: Rect): [Vec2, Vec2] | undefined {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  const p = [-dir.x, dir.x, -dir.y, dir.y];
  const q = [origin.x - x0, x1 - origin.x, origin.y - y0, y1 - origin.y];
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return undefined;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) tMin = max(tMin, t);
    else tMax = min(tMax, t);
  }
  if (tMin > tMax || !Number.isFinite(tMin) || !Number.isFinite(tMax)) return undefined;
  return [
    { x: origin.x + tMin * dir.x, y: origin.y + tMin * dir.y },
    { x: origin.x + tMax * dir.x, y: origin.y + tMax * dir.y },
  ];
}

function boundsOfStrokes(strokes: readonly PaintStroke[]): Rect | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let has = false;
  const inc = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    has = true;
    minX = min(minX, x);
    minY = min(minY, y);
    maxX = max(maxX, x);
    maxY = max(maxY, y);
  };
  for (const { geom } of strokes) {
    const v = geom.value;
    if (v.kind === "point") inc(v.x, v.y);
    else if (v.kind === "segment") {
      inc(v.a.x, v.a.y);
      inc(v.b.x, v.b.y);
    } else if (v.kind === "circle") {
      const r = abs(v.radius);
      inc(v.center.x - r, v.center.y - r);
      inc(v.center.x + r, v.center.y + r);
    } else if (v.kind === "region") {
      if (isCircleWalk(v.outer)) {
        const r = abs(v.outer.radius);
        inc(v.outer.center.x - r, v.outer.center.y - r);
        inc(v.outer.center.x + r, v.outer.center.y + r);
      } else {
        for (const e of walkEdges(v.outer)) {
          inc(e.a.x, e.a.y);
          inc(e.b.x, e.b.y);
        }
      }
    } else if (v.kind === "csg2" || v.kind === "pick") {
      const box = fillAabb(v);
      if (box) {
        inc(box.minX, box.minY);
        inc(box.maxX, box.maxY);
      }
    } else if (isGlider(v)) inc(v.x, v.y);
  }
  return has ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : undefined;
}

function exportBounds(strokes: readonly PaintStroke[], opts: FigureExportOptions): Rect {
  const framed = frameRect(opts.frame, opts.camera);
  if (framed && framed.w > 0 && framed.h > 0) return framed;
  const b = boundsOfStrokes(strokes);
  if (b && b.w >= 0 && b.h >= 0) {
    const pad = max(0.5, max(b.w, b.h) * 0.08);
    const rect = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    if (rect.w > 0 && rect.h > 0) return rect;
  }
  const cx = opts.camera?.x ?? 0;
  const cy = opts.camera?.y ?? 0;
  return { x: cx - 6, y: cy - 4.5, w: 12, h: 9 };
}

function styleAttrs(style: FigureStyle, filled: boolean): string {
  const stroke = style.stroke ?? DEFAULT_STROKE;
  const width = style.width ?? DEFAULT_STROKE_WIDTH;
  const dash =
    style.dash && style.dash.length > 0
      ? ` stroke-dasharray="${style.dash.map(num).join(" ")}"`
      : "";
  const fill = filled ? (style.fill ?? "none") : "none";
  return (
    `fill="${fill}" stroke="${stroke}" stroke-width="${num(width)}"${dash}` +
    ` stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`
  );
}

function drawOpEl(op: DrawOp, attrs: string): string {
  if (op.kind === "circle") {
    return `<circle cx="${num(op.cx)}" cy="${num(op.cy)}" r="${num(op.r)}" ${attrs}/>`;
  }
  if (!op.d) return "";
  return `<path d="${op.d}" fill-rule="evenodd" ${attrs}/>`;
}

function regionToSvg(r: Csg2 | Pick, style: FigureStyle, id: string): string {
  const p = fillPaint(r);
  if (p.empty) return "";
  const key = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const box = p.box;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const frame = `x="${num(box.minX)}" y="${num(box.minY)}" width="${num(w)}" height="${num(h)}"`;
  const clips: string[] = [];
  if (p.keepClip) clips.push(`<clipPath id="rk-${key}"><path d="${p.keepClip}"/></clipPath>`);
  if (p.tree) {
    const tree = csgTreeSvg(p.tree, `rt-${key}`, box);
    const mask =
      `<mask id="rm-${key}" maskUnits="userSpaceOnUse" ${frame}>` +
      `<rect ${frame} fill="#000"/>` +
      tree.body +
      `</mask>`;
    const fillAttrs = `${styleAttrs(style, true)} mask="url(#rm-${key})"`;
    let wrapped = `<rect ${frame} ${fillAttrs}/>`;
    if (p.keepClip) wrapped = `<g clip-path="url(#rk-${key})">${wrapped}</g>`;
    return `<defs>${tree.defs}${mask}${clips.join("")}</defs>${wrapped}`;
  }
  const holes = p.holes.map((op) => drawOpEl(op, 'fill="#000" stroke="none"')).join("");
  const mask =
    `<mask id="rm-${key}" maskUnits="userSpaceOnUse" ${frame}>` +
    `<rect ${frame} fill="#000"/>` +
    drawOpEl(p.stock, 'fill="#fff" stroke="none"') +
    holes +
    `</mask>`;
  const fillAttrs = `${styleAttrs(style, true)} mask="url(#rm-${key})"`;
  const strokeAttrs = `${styleAttrs({ ...style, fill: "none" }, false)} mask="url(#rm-${key})"`;
  let body = drawOpEl(p.stock, fillAttrs);
  for (const hole of p.holes) body += drawOpEl(hole, strokeAttrs);
  let wrapped = body;
  if (p.keepClip) wrapped = `<g clip-path="url(#rk-${key})">${wrapped}</g>`;
  return `<defs>${mask}${clips.join("")}</defs>${wrapped}`;
}

function strokeToSvg(s: PaintStroke, bounds: Rect, pointRadius: number): string {
  const v = s.geom.value;
  if (v.kind === "segment") {
    return `<line x1="${num(v.a.x)}" y1="${num(v.a.y)}" x2="${num(v.b.x)}" y2="${num(v.b.y)}" ${styleAttrs(s.style, false)}/>`;
  }
  if (v.kind === "line" || v.kind === "parallelLine") {
    const axis = infiniteLineAxis(v);
    if (!axis) return "";
    const seg = clipInfiniteLine(axis.origin, axis.dir, bounds);
    if (!seg) return "";
    const [a, b] = seg;
    return `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" ${styleAttrs(s.style, false)}/>`;
  }
  if (v.kind === "circle") {
    return `<circle cx="${num(v.center.x)}" cy="${num(v.center.y)}" r="${num(abs(v.radius))}" ${styleAttrs(s.style, true)}/>`;
  }
  if (v.kind === "region") {
    const d = regionSvgPath(v);
    if (!d) return "";
    return `<path d="${d}" fill-rule="evenodd" ${styleAttrs(s.style, true)}/>`;
  }
  if (v.kind === "csg2" || v.kind === "pick") {
    return regionToSvg(v, s.style, `${s.geom.id}-${s.geom.occ}`);
  }
  const point = v.kind === "point" || isGlider(v) ? { x: v.x, y: v.y } : undefined;
  if (point) {
    const mark = s.style.point ?? "dot";
    if (mark === "none") return "";
    const stroke = s.style.stroke ?? DEFAULT_STROKE;
    const fill = mark === "open" ? "none" : stroke;
    const width = s.style.width ?? DEFAULT_POINT_WIDTH;
    return (
      `<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(pointRadius)}"` +
      ` fill="${fill}" stroke="${stroke}" stroke-width="${num(width)}" vector-effect="non-scaling-stroke"/>`
    );
  }
  return "";
}

function baseName(file: string | undefined, title: string | undefined): string {
  if (file) {
    const leaf = file.split("/").pop() ?? file;
    const noExt = leaf.replace(/\.[^.]+$/, "");
    if (noExt) return noExt;
  }
  if (title) {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) return slug;
  }
  return "figure";
}

/**
 * Serialize the painted ink of a figure scene to a standalone SVG string, cropped
 * to the page frame when present (otherwise a padded bounding box of the ink).
 * Pure and DOM-free so it can run in tests and off the render path.
 */
export function figureToSvg(opts: FigureExportOptions): FigureExport {
  const strokes = paintStrokesFromTrace(opts.trace);
  const bounds = exportBounds(strokes, opts);

  const perUnit = clamp(opts.camera?.scale ?? 48, 4, 400);
  const rawW = max(1, bounds.w * perUnit);
  const rawH = max(1, bounds.h * perUnit);
  const shrink = min(1, MAX_DIM / max(rawW, rawH));
  const width = max(MIN_DIM, round(rawW * shrink));
  const height = max(MIN_DIM, round(rawH * shrink));
  const pointRadius = (4 * bounds.w) / width;

  const tx = -bounds.x;
  const ty = bounds.y + bounds.h;
  const paper = PAPER_FILL[opts.paper ?? "cream"];

  const body = strokes
    .map((s) => strokeToSvg(s, bounds, pointRadius))
    .filter((piece) => piece.length > 0)
    .join("\n    ");

  const bg =
    opts.background === false
      ? ""
      : `<rect x="0" y="0" width="${num(bounds.w)}" height="${num(bounds.h)}" fill="${paper}"/>\n  `;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(bounds.w)} ${num(bounds.h)}" width="${width}" height="${height}">\n` +
    `  ${bg}<g transform="translate(${num(tx)} ${num(ty)}) scale(1 -1)">\n` +
    `    ${body}\n` +
    `  </g>\n` +
    `</svg>\n`;

  return {
    svg,
    width,
    height,
    filename: `${baseName(opts.file, opts.title)}.svg`,
    empty: strokes.length === 0,
  };
}
