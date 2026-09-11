import { describe, expect, test } from "vitest";

import {
  extensionForMime,
  extensionFromName,
  isImageExtension,
  IMAGE_EXTENSIONS,
  IMAGE_MAX_BYTES,
  sanitizeSlug,
  slugFromName,
} from "./import-image";

describe("extensionForMime", () => {
  test("maps the raster types a browser decodes", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/WebP")).toBe("webp");
    expect(extensionForMime("image/gif")).toBe("gif");
    expect(extensionForMime(" image/bmp ")).toBe("bmp");
  });

  test("nothing for a type outside the list — decode is not the server's test", () => {
    expect(extensionForMime("image/svg+xml")).toBeUndefined();
    expect(extensionForMime("application/pdf")).toBeUndefined();
    expect(extensionForMime("")).toBeUndefined();
  });
});

describe("extensionFromName", () => {
  test("reads the suffix when the drop carried no MIME type", () => {
    expect(extensionFromName("scan.WEBP")).toBe("webp");
    expect(extensionFromName("a.b.png")).toBe("png");
  });

  test("nothing for no dot or an unknown suffix", () => {
    expect(extensionFromName("scan")).toBeUndefined();
    expect(extensionFromName("scan.psd")).toBeUndefined();
    expect(extensionFromName(".png")).toBe("png");
  });
});

describe("sanitizeSlug", () => {
  test("lowercases and hyphenates", () => {
    expect(sanitizeSlug("Some Gear (2)")).toBe("some-gear-2");
  });

  test("never leaves a path behind", () => {
    expect(sanitizeSlug("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeSlug("a\\b\\c")).toBe("a-b-c");
    expect(sanitizeSlug("..")).toBe("image");
  });

  test("never empty, never leading or trailing a hyphen", () => {
    expect(sanitizeSlug("")).toBe("image");
    expect(sanitizeSlug("!!!")).toBe("image");
    expect(sanitizeSlug("--x--")).toBe("x");
    expect(sanitizeSlug("-".repeat(60))).toBe("image");
  });

  test("caps the length without leaving a trailing hyphen", () => {
    const long = sanitizeSlug("a".repeat(40) + " " + "b".repeat(40));
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("slugFromName", () => {
  test("drops the extension, keeps the stem", () => {
    expect(slugFromName("Some Gear (2).PNG")).toBe("some-gear-2");
    expect(slugFromName("gear")).toBe("gear");
    expect(slugFromName(".hidden")).toBe("hidden");
  });
});

describe("the shared constants", () => {
  test("every listed extension passes the guard", () => {
    for (const ext of IMAGE_EXTENSIONS) expect(isImageExtension(ext)).toBe(true);
    expect(isImageExtension("SVG")).toBe(false);
    expect(isImageExtension("")).toBe(false);
  });

  test("the cap is a sane size for a screenshot", () => {
    expect(IMAGE_MAX_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
  });
});
