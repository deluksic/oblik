import { describe, expect, test } from "vitest";

import { circle, line, paint, point, region, diff, union, segment } from "../eval/constructors";
import type { TraceNode } from "../eval/context";
import { evaluate } from "../eval/evaluate";
import { defineScene } from "../eval/scene";
import { figureToSvg, type FigureExportOptions } from "./export";

function traceFor(build: () => void): TraceNode[] {
  const scene = defineScene({ kind: "figure", title: "Test figure", build });
  return evaluate(scene, {}).trace;
}

function svgFor(build: () => void, opts: Partial<FigureExportOptions> = {}) {
  return figureToSvg({
    trace: traceFor(build),
    file: "apps/demo/src/scenes/basic-fig.ts",
    ...opts,
  });
}

describe("figureToSvg", () => {
  test("serializes painted segment and circle into a standalone SVG", () => {
    const out = svgFor(() => {
      const a = point(0, 0, "o_a");
      const b = point(4, 3, "o_b");
      const s = segment(a, b, "o_s");
      const c = circle(a, 2, "o_c");
      paint(s, { stroke: "#123456", width: 2 }, "o_ps");
      paint(c, { stroke: "#abcdef", fill: "none", width: 1.5 }, "o_pc");
    });

    expect(out.empty).toBe(false);
    expect(out.filename).toBe("basic-fig.svg");
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(Number.isInteger(out.width)).toBe(true);
    expect(out.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out.svg).toContain("viewBox=");
    expect(out.svg).toContain("<line");
    expect(out.svg).toContain("<circle");
    expect(out.svg).toContain('stroke="#123456"');
    expect(out.svg).toContain('stroke="#abcdef"');
    expect(out.svg).toContain('stroke-width="2"');
    expect(out.svg).toContain('vector-effect="non-scaling-stroke"');
    // cream paper background by default
    expect(out.svg).toContain('fill="#fff3e6"');
    // y-up world flipped into SVG space
    expect(out.svg).toContain("scale(1 -1)");
  });

  test("crops to the page frame and sizes output by camera scale", () => {
    const out = svgFor(
      () => {
        const a = point(2, 1.6, "o_a");
        const c = circle(a, 1, "o_c");
        paint(c, { stroke: "#1c1917" }, "o_pc");
      },
      { frame: { width: 5.2, height: 4.2 }, camera: { x: 2, y: 1.6, scale: 72 }, paper: "white" },
    );

    expect(out.svg).toContain('viewBox="0 0 5.2 4.2"');
    expect(out.width).toBe(Math.round(5.2 * 72));
    expect(out.height).toBe(Math.round(4.2 * 72));
    expect(out.svg).toContain('fill="#ffffff"'); // white paper
  });

  test("marks an empty figure and emits no ink elements", () => {
    const out = svgFor(() => {
      point(0, 0, "o_a"); // constructed but never painted
    });

    expect(out.empty).toBe(true);
    expect(out.svg).not.toContain("<line");
    expect(out.svg).not.toContain("<circle");
    expect(out.svg).toContain("<g");
    expect(out.svg).toContain("</g>");
  });

  test("honors point marks: open is hollow, none is skipped", () => {
    const out = svgFor(() => {
      const p = point(1, 1, "o_p");
      const q = point(2, 2, "o_q");
      paint(p, { point: "open", stroke: "#111111" }, "o_pp");
      paint(q, { point: "none" }, "o_pq");
    });

    const circles = out.svg.match(/<circle/g) ?? [];
    expect(circles).toHaveLength(1); // only the "open" point renders
    expect(out.svg).toContain('stroke="#111111"');
    expect(out.svg).toContain('fill="none"');
  });

  test("clips an infinite painted line to the frame", () => {
    const out = svgFor(
      () => {
        const a = point(-10, 0, "o_la");
        const b = point(10, 0, "o_lb");
        const l = line(a, b, "o_L");
        paint(l, { stroke: "#222222" }, "o_pl");
      },
      { frame: { width: 4, height: 4 }, camera: { x: 0, y: 0, scale: 50 } },
    );

    expect(out.svg).toMatch(/<line[^>]*stroke="#222222"/);
    // horizontal line y=0 clipped to x in [-2, 2]
    expect(out.svg).toContain('y1="0"');
    expect(out.svg).toContain('y2="0"');
    expect(out.svg).toContain('"-2"');
    expect(out.svg).toContain('"2"');
  });

  test("paints a region with a luminance mask and exact hole circles", () => {
    const out = svgFor(() => {
      const a = point(0, 0, "o_ra");
      const b = point(4, 0, "o_rb");
      const c = point(4, 3, "o_rc");
      const d = point(0, 3, "o_rd");
      const ab = segment(a, b, "o_rab");
      const bc = segment(b, c, "o_rbc");
      const cd = segment(c, d, "o_rcd");
      const da = segment(d, a, "o_rda");
      const stock = region([a, ab, b, bc, c, cd, d, da], [], "o_rstock");
      const holeAt = point(2, 1.5, "o_rhc");
      const hole = circle(holeAt, 0.5, "o_rhole");
      const face = diff(stock, [hole], "o_rface");
      paint(face, { stroke: "#1c1917", fill: "#cfe8d4", width: 1.2 }, "o_rp");
    });

    expect(out.empty).toBe(false);
    expect(out.svg).toContain("<mask");
    expect(out.svg).toContain('maskUnits="userSpaceOnUse"');
    expect(out.svg).toContain('fill="#cfe8d4"');
    expect(out.svg).toMatch(/<circle[^>]*r="0.5"/);
  });

  test("paints a union as nested luminance, not shop stock", () => {
    const out = svgFor(() => {
      const a = point(0, 0, "o_ua");
      const b = point(1.2, 0, "o_ub");
      const left = circle(a, 1, "o_ul");
      const right = circle(b, 1, "o_ur");
      const face = union([left, right], "o_uface");
      paint(face, { stroke: "#1c1917", fill: "#c5ddf5", width: 1.2 }, "o_up");
    });

    expect(out.empty).toBe(false);
    expect(out.svg).toContain("<mask");
    expect(out.svg).toContain('fill="#c5ddf5"');
    expect(out.svg).toMatch(/<circle[^>]*r="1"/);
    expect(out.svg).toContain("<rect");
  });

  test("emits stroke-dasharray for dashed styles", () => {
    const out = svgFor(() => {
      const a = point(0, 0, "o_a");
      const b = point(3, 0, "o_b");
      const s = segment(a, b, "o_s");
      paint(s, { stroke: "#1c1917", dash: [5, 3] }, "o_ps");
    });

    expect(out.svg).toContain('stroke-dasharray="5 3"');
  });
});
