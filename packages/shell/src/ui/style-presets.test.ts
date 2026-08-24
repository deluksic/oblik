import { expect, test } from "vitest";

import {
  colorValueForPreset,
  dashValueForPreset,
  normalizeHex,
  pickerHex,
  selectedColorId,
  selectedDash,
  selectedLineWidthId,
  selectedPointSizeId,
  sizeValueForPreset,
  widthValueForPreset,
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

test("named presets omit default fields", () => {
  expect(colorValueForPreset("default")).toBeUndefined();
  expect(colorValueForPreset("blue")).toBe("#4a8fd9");
  expect(widthValueForPreset("normal")).toBeUndefined();
  expect(widthValueForPreset("small")).toBe(0.75);
  expect(sizeValueForPreset("normal")).toBeUndefined();
  expect(sizeValueForPreset("wide")).toBe(7);
  expect(pickerHex(undefined)).toBe("#d7d2c4");
  expect(pickerHex("#abc")).toBe("#aabbcc");
});
