import { imageRect, type ImageOpts, type ImageRect, type ImageStyle } from "../eval/image";
import type { Vec2 } from "../geom";
import type { Expr } from "../source/expr";
import {
  extensionForMime,
  extensionFromName,
  IMAGE_MAX_BYTES,
  slugFromName,
  type ImageExtension,
} from "../source/import-image";
import { fitWorldWidth } from "./camera";

/**
 * Bringing a bitmap in: an `ImageFileLike` in, a scene node out.
 *
 * The halves are deliberately apart. Reading a paste or a drop is pure data
 * shuffling over the DOM's own structures, the gate is pure, and only the
 * upload and the decode are effects — which is why the decode and `fetch` are
 * injected here and the module imports nothing from the DOM.
 *
 * The order matters: **decode, then upload**. The browser is the only format
 * oracle there is, so a file it cannot draw is refused before a single byte
 * reaches the server — no orphan in `public/assets`, nothing to clean up.
 */

/** Just enough of a `File` to gate one, so the gate is testable off-DOM. */
export type ImageFileLike = { type: string; name?: string; size: number };

/** What a decode has to report for the node to be written. */
export type DecodedImage = { width: number; height: number };

/** The clipboard item a paste carries. `null` is what the DOM returns for an
 * item with no file, so it is handled here and never travels further. */
export type ClipboardItemLike<T extends ImageFileLike> = {
  kind: string;
  type: string;
  getAsFile(): T | null | undefined;
};

/** The transfer shape both readers need: `DataTransfer` satisfies it, and a test
 * can hand over a literal. Generic in the file type, so passing a `DataTransfer`
 * gives back a `File` — no cast at the call site. */
export type TransferLike<T extends ImageFileLike = ImageFileLike> = {
  files?: ArrayLike<T>;
  items?: ArrayLike<ClipboardItemLike<T>>;
};

/** The look a freshly imported reference gets: the light-table look — the bitmap
 * as printed, desaturated so ink and the grid read over it. */
export const IMPORT_STYLE: Partial<ImageStyle> = { saturation: 0.15 };

const MAX_MB = Math.floor(IMAGE_MAX_BYTES / (1024 * 1024));

/**
 * The client-side gate, which runs before anything is uploaded. It answers two
 * questions the server cannot: which extension the format is (only this side
 * decoded it) and whether it is worth sending at all.
 */
export function checkImage(file: ImageFileLike): { ext: ImageExtension; slug: string } | string {
  if (!(file.size > 0)) return "that file is empty";
  if (file.size > IMAGE_MAX_BYTES) return `that image is larger than ${MAX_MB} MB`;
  const ext = extensionForMime(file.type) ?? extensionFromName(file.name ?? "");
  if (!ext) {
    return `${file.name !== undefined && file.name !== "" ? file.name : "that file"} is not a format the browser can draw`;
  }
  return {
    ext,
    slug: slugFromName(file.name !== undefined && file.name !== "" ? file.name : "image"),
  };
}

/**
 * The image a paste carried, if it carried one.
 *
 * `clipboardData.files` is empty for a pasted bitmap in most browsers and fills
 * only when the clipboard holds a real file (a PNG copied in Finder), so both
 * are read. A paste with no image item is left alone — that is how a text paste
 * stays a text paste.
 */
export function pastedImage<T extends ImageFileLike>(
  data: TransferLike<T> | undefined,
): T | undefined {
  for (const item of itemsOf(data)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file !== null && file !== undefined) return file;
  }
  return imageFromFiles(data);
}

/**
 * The image a drop carried. Unlike a paste this is usually `files`, but not
 * always: an embedded browser (VS Code's, for one) can hand a drag over as an
 * item list, and a drag from outside the page may carry only a URI list. Both
 * are read — and `describeDrop` is what says so in the status line when neither
 * holds a file, because a drop that quietly does nothing is the worst version.
 */
export function droppedImage<T extends ImageFileLike>(
  data: TransferLike<T> | undefined,
): T | undefined {
  for (const item of itemsOf(data)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file !== null && file !== undefined) return file;
  }
  return imageFromFiles(data);
}

/** What a drop offered, for a message the user can act on. */
export function describeDrop(
  data: (TransferLike & { types?: ArrayLike<string> }) | undefined,
): string {
  const types = data?.types === undefined ? [] : Array.from(data.types);
  const files = data?.files?.length ?? 0;
  const items = itemsOf(data).length;
  const carried = [
    files > 0 ? `${files} file${files === 1 ? "" : "s"}` : "",
    items > 0 ? `${items} item${items === 1 ? "" : "s"}` : "",
    types.length > 0 ? `types: ${types.join(", ")}` : "",
  ].filter((part) => part !== "");
  return carried.length === 0
    ? "that drop carried nothing the page could read — use Import image…, or paste the file"
    : `that drop carried no image (${carried.join("; ")}) — use Import image…, or paste the file`;
}

function itemsOf<T extends ImageFileLike>(
  data: TransferLike<T> | undefined,
): ClipboardItemLike<T>[] {
  return data?.items === undefined ? [] : Array.from(data.items);
}

function imageFromFiles<T extends ImageFileLike>(
  data: { files?: ArrayLike<T> } | undefined,
): T | undefined {
  const files = data?.files;
  if (files === undefined) return undefined;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file !== undefined && file.type.startsWith("image/")) return file;
  }
  return undefined;
}

/**
 * Where a freshly imported reference goes: its centre on `world`, at a size that
 * shows the whole bitmap in the view it was dropped into (`fitWorldWidth`).
 *
 * The height is left to `imageSize` and the aspect, so the node keeps the file's
 * proportions on its own. The width is a *stated* world size rather than the
 * pixel count, which is what makes the reference visible the moment it lands;
 * giving it its true scale is measure's job.
 */
export function importImageOpts(
  world: Vec2,
  size: DecodedImage,
  view: { w: number; h: number; scale: number },
): ImageOpts {
  return {
    world,
    anchor: { x: size.width / 2, y: size.height / 2 },
    imageSize: { width: size.width, height: size.height },
    targetSize: { width: fitWorldWidth(view, size) },
    style: { ...IMPORT_STYLE },
  };
}

/** The `/__oblik-insert` argument list for a reference: the URL, then the
 * options object — the same `Expr` tree every other insert is written from. */
const num = (value: number): Expr => ({ kind: "num", value });
const pointExpr = (point: Vec2): Expr => ({
  kind: "props",
  props: { x: num(point.x), y: num(point.y) },
});

export function imageArgs(url: string, opts: ImageOpts): Expr[] {
  const props: Record<string, Expr> = {
    world: pointExpr(opts.world),
    imageSize: {
      kind: "props",
      props: { width: num(opts.imageSize.width), height: num(opts.imageSize.height) },
    },
  };
  const width = opts.targetSize.width;
  const height = opts.targetSize.height;
  if (width !== undefined || height !== undefined) {
    props.targetSize = {
      kind: "props",
      props: {
        ...(width !== undefined ? { width: num(width) } : {}),
        ...(height !== undefined ? { height: num(height) } : {}),
      },
    };
  }
  if (opts.anchor !== undefined) props.anchor = pointExpr(opts.anchor);
  const style: Record<string, Expr> = {};
  if (opts.style?.opacity !== undefined) style.opacity = num(opts.style.opacity);
  if (opts.style?.saturation !== undefined) style.saturation = num(opts.style.saturation);
  if (opts.style?.contrast !== undefined) style.contrast = num(opts.style.contrast);
  if (Object.keys(style).length > 0) props.style = { kind: "props", props: style };
  return [
    { kind: "str", value: url },
    { kind: "props", props },
  ];
}

export type UploadDeps = {
  /** `createImageBitmap` in the app; the test hands over a size. */
  decode(blob: Blob): Promise<DecodedImage>;
  fetch: typeof fetch;
};

export type ImportedImage = {
  /** The served URL the node will hold. */
  url: string;
  size: DecodedImage;
  /** The options object for the insert, and the rect it resolves to — what the
   * caller fits the camera to. */
  opts: ImageOpts;
  rect: ImageRect;
};

/**
 * Decode, upload, and hand back what to insert. Every rejection is a string the
 * pane can show, and nothing is uploaded until the browser has drawn the bitmap
 * once.
 */
export async function importImage(
  file: Blob & { name?: string; size: number; type?: string },
  at: { world: Vec2; view: { w: number; h: number; scale: number } },
  deps: UploadDeps,
): Promise<ImportedImage | string> {
  const gate = checkImage({
    type: file.type ?? "",
    size: file.size,
    ...(file.name !== undefined ? { name: file.name } : {}),
  });
  if (typeof gate === "string") return gate;

  let size: DecodedImage;
  try {
    size = await deps.decode(file);
  } catch {
    return "the browser could not draw that image";
  }
  if (!(size.width > 0) || !(size.height > 0)) return "that image has no pixels";

  const query = `slug=${encodeURIComponent(gate.slug)}&ext=${gate.ext}`;
  let res: Response;
  try {
    res = await deps.fetch(`/__oblik-import-image?${query}`, { method: "POST", body: file });
  } catch {
    return "the dev server did not accept the upload";
  }
  const body = (await res.json().catch(() => undefined)) as
    | { url?: string; error?: string }
    | undefined;
  if (!res.ok) return body?.error ?? `upload failed (${res.status})`;
  if (body?.url === undefined) return "upload failed";

  const opts = importImageOpts(at.world, size, at.view);
  return { url: body.url, size, opts, rect: imageRect(opts) };
}
