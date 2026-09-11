/**
 * The wire contract for importing a raster reference, shared by the browser
 * (paste / drop / picker) and the dev-server endpoint that stores it.
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

/** The same cap, as the number the messages say. */
export const IMAGE_MAX_MB = Math.floor(IMAGE_MAX_BYTES / (1024 * 1024));

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

const EXTENSION_MIME: Record<ImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};

/** What to serve an allowlisted extension as. */
export function mimeForExtension(ext: string): string | undefined {
  const lower = ext.toLowerCase();
  return isImageExtension(lower) ? EXTENSION_MIME[lower] : undefined;
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

/**
 * A drag that carried a *path* rather than bytes: an embedded browser hands a
 * drop over as a `file://` URI, which the page itself cannot fetch. Returns the
 * filesystem path for a `file:` URI or an absolute path, and nothing for a link
 * the dev server must not read.
 */
export function dropPathToFile(raw: string): string | undefined {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (text === "") return undefined;
  if (/^file:\/\//i.test(text)) {
    const rest = text.slice("file://".length).split(/[?#]/)[0] ?? "";
    let decoded: string;
    try {
      decoded = decodeURIComponent(rest);
    } catch {
      return undefined;
    }
    // `file:///C:/x.png` keeps its drive letter, `file:///Users/x.png` the
    // leading slash that makes it absolute; `file://host/share` is neither.
    const abs = /^\/?[A-Za-z]:[\\/]/.test(decoded) ? decoded.replace(/^\//, "") : decoded;
    return /^[A-Za-z]:[\\/]/.test(abs) || abs.startsWith("/") ? abs : undefined;
  }
  const absolute = /^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\") || text.startsWith("/");
  return absolute ? text : undefined;
}
