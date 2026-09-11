import { createEffect, createSignal, type Accessor } from "solid-js";

import type { PaneSize } from "../camera";

/**
 * An element's box in the two units this app cares about: **CSS pixels** for the
 * camera, the chrome and world↔screen, **device pixels** for a canvas backing
 * store.
 */
export type ElementBox = { logical: PaneSize; physical: PaneSize };

const { max, round } = Math;

/**
 * A backing store is never zero-sized, whatever the layout says mid-mount, so
 * the device box is rounded and floored at 1. The logical box is unclamped: a
 * collapsed element really is 0 across.
 */
function forCanvas(size: PaneSize): PaneSize {
  return { w: max(1, round(size.w)), h: max(1, round(size.h)) };
}

/** The box a `ResizeObserverEntry` reports, in both units. */
export function boxFromEntry(entry: ResizeObserverEntry, dpr: number): ElementBox {
  const logicalBox = entry.contentBoxSize?.[0];
  const deviceBox = entry.devicePixelContentBoxSize?.[0];
  const logical = logicalBox
    ? { w: logicalBox.inlineSize, h: logicalBox.blockSize }
    : physicalToLogical(deviceBox, dpr);
  const physical = deviceBox
    ? { w: deviceBox.inlineSize, h: deviceBox.blockSize }
    : logicalToPhysical(logical, dpr);
  return { logical, physical: forCanvas(physical) };
}

/** The same reading from a plain rect: a first measure, or a browser with no
 * entry to hand. */
export function boxFromRect(el: Element, dpr: number): ElementBox {
  const rect = el.getBoundingClientRect();
  const logical = { w: rect.width, h: rect.height };
  return { logical, physical: forCanvas(logicalToPhysical(logical, dpr)) };
}

function logicalToPhysical(logical: PaneSize, dpr: number): PaneSize {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return { w: logical.w * scale, h: logical.h * scale };
}

function physicalToLogical(
  physical: { inlineSize: number; blockSize: number } | undefined,
  dpr: number,
): PaneSize {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (!physical) return { w: 0, h: 0 };
  return { w: physical.inlineSize / scale, h: physical.blockSize / scale };
}

/** The device pixel ratio as it is *now*: a window moved to another display
 * changes it, and a box measured before that is stale. */
export function currentDpr(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}

export type ElementBoxOpts = {
  /**
   * Fires from the observer's own callback. A signal read there is current and
   * untracked *by design*, which is where a component reacting to its own size
   * has to do its work — an effect's apply may not read one at all.
   */
  onChange?: (box: ElementBox) => void;
};

/** `ResizeObserver` on `el()`, reported in both units. */
export function createElementBox(
  el: () => Element | undefined,
  opts?: ElementBoxOpts,
): Accessor<ElementBox | undefined> {
  const [box, setBox] = createSignal<ElementBox | undefined>(undefined);
  createEffect(
    () => el(),
    (node) => {
      if (!node) return;
      const report = (next: ElementBox) => {
        setBox(next);
        opts?.onChange?.(next);
      };
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((e) => e.target === node);
        report(entry ? boxFromEntry(entry, currentDpr()) : boxFromRect(node, currentDpr()));
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
  );
  return box;
}
