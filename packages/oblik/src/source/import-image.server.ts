import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sanitizeSlug, type ImageExtension } from "./import-image";

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
 * Store `bytes` as `<publicDir>/assets/<slug>-<hash>.<ext>` and hand back the
 * URL to serve it from. Content-addressed: identical bytes reuse the file that
 * is already there, so re-importing a screenshot is free, distinct images can
 * never overwrite each other, and the stored name is a function of the content
 * plus a slug the server sanitises itself — never a path a client chose.
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
