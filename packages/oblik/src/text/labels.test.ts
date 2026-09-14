import { describe, expect, test } from "vitest";

import {
  reconcileLabels,
  type LabelSpec,
  type LabelWriter,
  type LiveLabel,
  type Placement,
  type TextStyle,
} from "./labels";

/**
 * The reconciliation is where the text path's cost is decided, so these tests
 * count what it actually does rather than trusting it.
 *
 * The load-bearing case is the second one: a camera move produces a *new*
 * camera and an *identical* label set, and the whole claim — "GPU-only for pan
 * and zoom" — rests on that sync writing nothing at all. It is asserted as
 * "no create, no reshape, no place, no drop", because any one of them would be
 * per-frame work on a camera move.
 */

const STYLE: TextStyle = { fontSize: 12, lineHeight: 1, color: "#000", opacity: 1 };

type Ops = {
  created: string[];
  reshaped: string[];
  placed: string[];
  dropped: string[];
};

function recorder(ops: Ops): LabelWriter<string> {
  let serial = 0;
  return {
    create(label) {
      ops.created.push(label.key);
      serial += 1;
      return `${label.key}#${serial}`;
    },
    reshape(text, label) {
      ops.reshaped.push(label.key);
      void text;
    },
    place(text) {
      ops.placed.push(text);
    },
    drop(text) {
      ops.dropped.push(text);
    },
  };
}

function emptyOps(): Ops {
  return { created: [], reshaped: [], placed: [], dropped: [] };
}

/** One sync. Returns whether the engine owes a shape. */
function sync(
  live: Map<string, LiveLabel<string>>,
  writer: LabelWriter<string>,
  labels: readonly LabelSpec[],
): boolean {
  return reconcileLabels(live, writer, labels, new Set());
}

const label = (key: string, over: Partial<LabelSpec> = {}): LabelSpec => ({
  key,
  text: key.toUpperCase(),
  x: 1,
  y: 2,
  dx: 10,
  dy: -18,
  style: STYLE,
  knockout: { gap: 2, color: [0.1, 0.2, 0.3] },
  ...over,
});

describe("label reconciliation", () => {
  test("the first sync creates every label and owes a shape", () => {
    const live = new Map<string, LiveLabel<string>>();
    const ops = emptyOps();
    const owed = sync(live, recorder(ops), [label("a"), label("b")]);
    expect(ops.created).toEqual(["a", "b"]);
    expect(ops.reshaped).toEqual([]);
    expect(ops.placed).toEqual([]);
    expect(owed).toBe(true);
  });

  test("a camera move writes nothing and owes no shape", () => {
    const live = new Map<string, LiveLabel<string>>();
    const labels = [label("a"), label("b"), label("c")];
    sync(live, recorder(emptyOps()), labels);

    // A pan or a zoom changes the camera, not any label. The labels are the
    // same objects, and the sync must be a complete no-op.
    const ops = emptyOps();
    const owed = sync(live, recorder(ops), labels);
    expect(ops).toEqual(emptyOps());
    expect(owed).toBe(false);

    // Ten more frames of panning are still nothing.
    for (let frame = 0; frame < 10; frame += 1) sync(live, recorder(ops), labels);
    expect(ops).toEqual(emptyOps());
  });

  test("only the label that moved is placed", () => {
    const live = new Map<string, LiveLabel<string>>();
    sync(live, recorder(emptyOps()), [label("a"), label("b")]);
    const ops = emptyOps();
    const owed = sync(live, recorder(ops), [label("a"), label("b", { x: 99 })]);
    // Moving a label is not a re-shape: it writes uniforms and owes no shape.
    expect(ops.placed).toEqual(["b#2"]);
    expect(ops.reshaped).toEqual([]);
    expect(owed).toBe(false);
  });

  test("a text change re-shapes that label and does not move it", () => {
    const live = new Map<string, LiveLabel<string>>();
    sync(live, recorder(emptyOps()), [label("a"), label("b")]);
    const ops = emptyOps();
    const owed = sync(live, recorder(ops), [label("a"), label("b", { text: "B2" })]);
    expect(ops.reshaped).toEqual(["b"]);
    expect(ops.placed).toEqual([]);
    expect(owed).toBe(true);
  });

  test("a ring change is a placement write, not a re-shape", () => {
    const live = new Map<string, LiveLabel<string>>();
    sync(live, recorder(emptyOps()), [label("a")]);
    const ops = emptyOps();
    const owed = sync(live, recorder(ops), [
      label("a", { knockout: { gap: 2, color: [0.9, 0.8, 0.7] } }),
    ]);
    expect(ops.placed).toEqual(["a#1"]);
    expect(ops.reshaped).toEqual([]);
    expect(owed).toBe(false);
  });

  test("a dropped label is disposed once and owes a shape", () => {
    const live = new Map<string, LiveLabel<string>>();
    sync(live, recorder(emptyOps()), [label("a"), label("b")]);
    const ops = emptyOps();
    const owed = sync(live, recorder(ops), [label("a")]);
    expect(ops.dropped).toEqual(["b#2"]);
    expect(owed).toBe(true);
    expect(live.has("b")).toBe(false);
    // The surviving label keeps its identity: no re-create.
    expect(live.get("a")?.text).toBe("a#1");
  });

  test("the same object set back-to-back allocates no work", () => {
    const live = new Map<string, LiveLabel<string>>();
    const labels = Array.from({ length: 200 }, (_, index) => label(`k${index}`));
    sync(live, recorder(emptyOps()), labels);

    const ops = emptyOps();
    const writer = recorder(ops);
    for (let frame = 0; frame < 60; frame += 1) reconcileLabels(live, writer, labels, new Set());
    expect(ops).toEqual(emptyOps());
  });

  test("placement carries the anchor and offset verbatim", () => {
    const live = new Map<string, LiveLabel<string>>();
    const seen: Placement[] = [];
    const writer: LabelWriter<string> = {
      create(_label, _style, placement) {
        seen.push(placement);
        return "t";
      },
      reshape() {},
      place(_text, placement) {
        seen.push(placement);
      },
      drop() {},
    };
    sync(live, writer, [label("a", { x: 7, y: -3, dx: 4, dy: 5 })]);
    sync(live, writer, [label("a", { x: 8, y: -3, dx: 4, dy: 5 })]);
    expect(seen[0]).toEqual({
      anchor: [7, -3],
      offset: [4, 5],
      ring: { gap: 2, enabled: true, color: [0.1, 0.2, 0.3] },
    });
    expect(seen[1]?.anchor).toEqual([8, -3]);
  });

  test("a label with no ring asks for a zero-width one", () => {
    const live = new Map<string, LiveLabel<string>>();
    const seen: Placement[] = [];
    sync(
      live,
      {
        create(_l, _s, placement) {
          seen.push(placement);
          return "t";
        },
        reshape() {},
        place() {},
        drop() {},
      },
      [label("a", { knockout: undefined })],
    );
    expect(seen[0]?.ring).toEqual({ gap: 0, enabled: false, color: [0, 0, 0] });
  });
});
