import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  dropPathToFile,
  extensionFromName,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_MB,
  sanitizeSlug,
  slugFromName,
  type ImageExtension,
} from "./import-image";

/** Under Vite's `publicDir`, so it is served at `/assets/…` with no import line. */
export const IMAGE_ASSET_DIR = "assets";

export type StoredImage = {
  /** Served URL, e.g. `/assets/gear-9f3a2c11.png`. This is the node's `src`. */
  url: string;
  /** File name inside the assets directory. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** True when identical bytes were already stored — no write happened. */
  deduped: boolean;
};

/** First 8 hex of the content's sha256: enough to name a file, short enough to read. */
export function contentHash(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/**
 * Store `bytes` as `<publicDir>/assets/<slug>-<hash>.<ext>` and return the URL.
 * Content-addressed, so identical bytes reuse the file that is already there.
 */
export function writeImageAsset(
  publicDir: string,
  slug: string,
  ext: ImageExtension,
  bytes: Buffer,
): StoredImage {
  const dir = path.resolve(publicDir, IMAGE_ASSET_DIR);
  const name = `${sanitizeSlug(slug)}-${contentHash(bytes)}.${ext}`;
  const abs = path.resolve(dir, name);
  // The name is already `[a-z0-9-] + 8 hex + allowlisted ext`, so this can only
  // fail if that ever stops being true. Cheap enough to keep as the invariant it is.
  if (path.dirname(abs) !== dir) throw new Error("asset path escapes the assets directory");
  fs.mkdirSync(dir, { recursive: true });
  const deduped = fs.existsSync(abs);
  if (!deduped) fs.writeFileSync(abs, bytes);
  return { url: `/${IMAGE_ASSET_DIR}/${name}`, name, path: abs, deduped };
}

export type DroppedFile = {
  /** Absolute path on disk. */
  path: string;
  ext: ImageExtension;
};

/**
 * Resolve a dropped path to a readable image **inside the workspace root**. A
 * drop is a string the browser cannot fetch itself, so the server does the
 * reading — which is why everything outside the root, every other extension and
 * every non-local scheme is refused, with a message the pane can show.
 */
export function resolveDropFile(root: string, raw: string): DroppedFile | string {
  const named = dropPathToFile(raw);
  if (named === undefined) return "that drop carried a link, not a file on this machine";
  const abs = path.resolve(named);
  const within = path.relative(path.resolve(root), abs);
  if (within === "" || within.startsWith("..") || path.isAbsolute(within)) {
    return `${path.basename(abs)} is outside the project root`;
  }
  const ext = extensionFromName(abs);
  if (ext === undefined) return `${path.basename(abs)} is not an image`;
  let size: number;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return `${path.basename(abs)} is not a file`;
    size = stat.size;
  } catch {
    return `the dev server cannot read ${path.basename(abs)}`;
  }
  if (size === 0) return "that file is empty";
  if (size > IMAGE_MAX_BYTES) return `${path.basename(abs)} is larger than ${IMAGE_MAX_MB} MB`;
  return { path: abs, ext };
}

/** The name in a served `/assets/<name>` URL, or `undefined` for anything else. */
function assetNameFromUrl(url: string | undefined): string | undefined {
  const pathname = (url ?? "").split(/[?#]/)[0] ?? "";
  if (!pathname.startsWith(`/${IMAGE_ASSET_DIR}/`)) return undefined;
  const name = pathname.slice(IMAGE_ASSET_DIR.length + 2);
  if (name === "" || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return undefined;
  }
  return extensionFromName(name) === undefined ? undefined : name;
}

/**
 * The file `/assets/<name>` names, or `undefined` when it is not an asset this
 * app serves. Vite reads `publicDir` **once at startup**, so an asset an import
 * writes afterwards is invisible to its own middleware — while the pane and the
 * renderer both fetch that URL immediately.
 */
export function assetFileForUrl(publicDir: string, url: string | undefined): string | undefined {
  const name = assetNameFromUrl(url);
  if (name === undefined) return undefined;
  const dir = path.resolve(publicDir, IMAGE_ASSET_DIR);
  const abs = path.resolve(dir, name);
  if (path.dirname(abs) !== dir) return undefined;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : undefined;
}

/** The URL a file already inside `publicDir` is served at, if it is one. */
function publicUrlOf(publicDir: string, abs: string): string | undefined {
  const rel = path.relative(path.resolve(publicDir), abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return `/${rel.split(path.sep).join("/")}`;
}

/**
 * The asset a dropped path becomes: the file **where it lies** when it is
 * already inside `publicDir` (no second copy, and no write at all), otherwise
 * content-addressed under `assets/`. Anything refused is a message for the pane.
 */
export function importDroppedFile(
  publicDir: string,
  root: string,
  raw: string,
): StoredImage | string {
  const found = resolveDropFile(root, raw);
  if (typeof found === "string") return found;
  const existing = publicUrlOf(publicDir, found.path);
  if (existing !== undefined) {
    return { url: existing, name: path.basename(found.path), path: found.path, deduped: true };
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(found.path);
  } catch {
    return `the dev server cannot read ${path.basename(found.path)}`;
  }
  return writeImageAsset(publicDir, slugFromName(path.basename(found.path)), found.ext, bytes);
}
