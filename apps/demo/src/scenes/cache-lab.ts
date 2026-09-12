import {
  circle,
  csg2,
  defineScene,
  diff,
  memo,
  point,
  polygon,
  region,
  roundOffset,
  segment,
} from "oblik";

const { cos, sin } = Math;
const GRID = 10;
const PETALS = 48;

// Heavy pure layout — the cost that makes a cache hit visible in evalstats.
// Keyed on the fn object, so an HMR re-import of this file rebuilds it once.
const petalRing = memo((n: number, r: number) => {
  let acc = 0;
  for (let i = 0; i < 300_000; i++) acc += sin(i * 0.001) * cos(i * 0.002);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = r * (1 + 0.22 * cos(6 * a) + acc * 1e-9);
    pts.push({ x: 10.6 + w * cos(a), y: 3.55 + w * sin(a) });
  }
  return pts;
});

export default defineScene({
  kind: "euclid2",
  title: "Cache lab",
  hint: "Turn on the eval stats chip in Settings. Drag the free bead — built stays at ~2 while the grid, ring layout, and CSG chain replay from the cache.",
  camera: { x: 7.6, y: 3.4, scale: 42 },
  build() {
    // 100 looped points: the frontier that must hit on every draft tick.
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        point(i * 0.7, j * 0.7, "o_lab_grid");
      }
    }

    // Memoized layout drawn as ink — identity flows from memo hit to polygon.
    const ring = petalRing(PETALS, 2.1);
    polygon(ring, [], "o_lab_plate");

    // Independent CSG chain: hex plate → round offset → drilled.
    const cx = 10.6;
    const cy = 3.55;
    const R = 2.4;
    const corners = [];
    for (let i = 0; i < 6; i++) {
      corners.push({
        x: cx + R * cos((i / 6) * Math.PI * 2),
        y: cy + R * sin((i / 6) * Math.PI * 2),
      });
    }
    const cycle = [];
    for (let i = 0; i < 6; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 6]!;
      cycle.push(a, segment(a, b, "o_lab_edge"));
    }
    const plate = region(cycle, [], "o_lab_region");
    const rounded = roundOffset(plate, 0.18, "o_lab_round");
    const holes = [];
    for (let i = 0; i < 5; i++) {
      const c = point(
        cx + cos((i / 5) * Math.PI * 2) * 1.1,
        cy + sin((i / 5) * Math.PI * 2) * 1.1,
        "o_lab_hc",
      );
      holes.push(circle(c, 0.22, "o_lab_hole"));
    }
    const chain = csg2(diff(rounded, holes), "o_lab_chain");

    // The only live part: a free bead and its marker.
    const bead = point(4.4, 8.2, "o_lab_bead");
    circle(bead, 0.45, "o_lab_bead_ring");

    return { bead, chain };
  },
});
