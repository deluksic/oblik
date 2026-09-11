/**
 * The wire contract for importing a raster reference, shared by the browser
 * (paste / drop / picker) and the dev-server endpoint that stores it. Pure — no
 * node, no DOM — so both sides validate against one list and one cap, and a
 * change to either is a single edit.
 *
 * The browser's decode (`createImageBitmap`) is the real acceptance test for a
 * format; this list is the half the server can check without decoding anything.
 * It is deliberately raster-only: an SVG decodes to a bitmap inconsistently
 * (it needs intrinsic dimensions) and would be served from the app's own origin
 * with script intact, which is not a surface this prototype wants to open.
 */
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "avif",
  "ico",
] as const;

export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/** Both sides enforce it: the client before upload, the endpoint while reading. */
export const IMAGE_MAX_BYTES = 32 * 1024 * 1024;

const MIME_EXTENSION: Record<string, ImageExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/avif": "avif",
  "image/vnd.microsoft.icon": "ico",
  "image/x-icon": "ico",
};

export function isImageExtension(ext: string): ext is ImageExtension {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/** The extension to store a decoded blob under. `undefined` → not a raster we take. */
export function extensionForMime(type: string): ImageExtension | undefined {
  return MIME_EXTENSION[type.trim().toLowerCase()];
}

/** Fallback for a drop whose `file.type` is empty (common for `.webp`/`.bmp`). */
export function extensionFromName(name: string): ImageExtension | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return isImageExtension(ext) ? ext : undefined;
}

/**
 * A filename-safe slug the *server* can trust in a path. Lowercase ASCII,
 * digits and single hyphens, never empty, never leading or trailing a hyphen.
 */
export function sanitizeSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "image";
}

/** `Some Gear (2).PNG` → `some-gear-2`. */
export function slugFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  return sanitizeSlug(dot > 0 ? name.slice(0, dot) : name);
}
