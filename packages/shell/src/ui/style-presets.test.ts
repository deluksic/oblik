import { expect, test } from "vitest";

import {
  colorValueForPreset,
  dashPattern,
  dashValueForPreset,
  mergeLineStyle,
  mergePointStyle,
  normalizeHex,
  pickerHex,
  selectedColorId,
  selectedDash,
  selectedLineWidthId,
  selectedPointSizeId,
  sizeValueForPreset,
  widthValueForPreset,
  withStyleChannel,
} from "./style-presets";

test("normalizeHex expands short colors", () => {
  expect(normalizeHex("#f00")).toBe("#ff0000");
  expect(normalizeHex("4A8FD9")).toBe("#4a8fd9");
  expect(normalizeHex("nope")).toBeUndefined();
});

test("omitted color is default; unknown hex is custom", () => {
  expect(selectedColorId(undefined)).toBe("default");
  expect(selectedColorId("#e24b4b")).toBe("red");
  expect(selectedColorId("#E24B4B")).toBe("red");
  expect(selectedColorId("#112233")).toBe("custom");
});

test("omitted width and size select normal; leftovers select none", () => {
  expect(selectedLineWidthId(undefined)).toBe("normal");
  expect(selectedLineWidthId(0.75)).toBe("small");
  expect(selectedLineWidthId(3.5)).toBe("wide");
  expect(selectedLineWidthId(4.5)).toBeNull();
  expect(selectedPointSizeId(undefined)).toBe("normal");
  expect(selectedPointSizeId(7)).toBe("wide");
  expect(selectedPointSizeId(12)).toBeNull();
});

test("solid dash is the omitted default", () => {
  expect(selectedDash(undefined)).toBe("solid");
  expect(selectedDash("dotted")).toBe("dotted");
  expect(dashValueForPreset("solid")).toBeUndefined();
  expect(dashValueForPreset("dashed")).toBe("dashed");
});

test("dash pattern scales gaps faster on wide strokes", () => {
  expect(dashPattern("dashed")).toEqual([8, 6]);
  const wide = dashPattern("dashed", 3.5);
  expect(wide[0]).toBeGreaterThan(8);
  expect(wide[1]).toBeGreaterThan(wide[0]);
  expect(wide[1] / wide[0]).toBeGreaterThan(6 / 8);
});

test("named presets always write explicit width and size", () => {
  expect(colorValueForPreset("default")).toBeUndefined();
  expect(colorValueForPreset("blue")).toBe("#4a8fd9");
  expect(widthValueForPreset("normal")).toBe(1.5);
  expect(widthValueForPreset("small")).toBe(0.75);
  expect(sizeValueForPreset("normal")).toBe(3.5);
  expect(sizeValueForPreset("wide")).toBe(7);
  expect(pickerHex(undefined)).toBe("#d7d2c4");
  expect(pickerHex("#abc")).toBe("#aabbcc");
});

test("merge helpers drop cleared fields but keep the rest", () => {
  expect(mergeLineStyle({ color: "#e24b4b", width: 3.5 }, { width: 1.5 })).toEqual({
    color: "#e24b4b",
    width: 1.5,
  });
  expect(mergeLineStyle({ color: "#e24b4b" }, { color: undefined })).toBeUndefined();
  expect(
    withStyleChannel({ line: { width: 2 }, point: { size: 5 } }, "line", { width: 1.5 }),
  ).toEqual({
    line: { width: 1.5 },
    point: { size: 5 },
  });
  expect(withStyleChannel({ line: { width: 2 } }, "line", undefined)).toBeNull();
  expect(mergePointStyle({ color: "#fff", size: 7 }, { size: 3.5 })).toEqual({
    color: "#fff",
    size: 3.5,
  });
});
