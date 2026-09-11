import { imageRect, type ImageOpts, type ImageRect, type ImageStyle } from "../eval/image";
import type { Vec2 } from "../geom";
import type { Expr } from "../source/expr";
import {
  dropPathToFile,
  extensionForMime,
  extensionFromName,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_MB,
  slugFromName,
  type ImageExtension,
} from "../source/import-image";
import { fitWorldWidth } from "./camera";

/** Bringing a bitmap in: an `ImageFileLike` in, a scene node out. */

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

/** Just enough of a `DataTransfer` for both readers, generic in the file type so
 * a `DataTransfer` gives back `File`s and a test can hand over a literal. */
export type TransferLike<T extends ImageFileLike = ImageFileLike> = {
  files?: ArrayLike<T>;
  items?: ArrayLike<ClipboardItemLike<T>>;
  getData?: (type: string) => string;
};

/** The look a freshly imported reference gets: the light-table look — the bitmap
 * as printed, desaturated so ink and the grid read over it. */
export const IMPORT_STYLE: Partial<ImageStyle> = { saturation: 0.15 };

/**
 * The client-side gate, which runs before anything is uploaded and answers what
 * the server cannot: which extension the format is, and whether it is worth
 * sending at all.
 */
export function checkImage(file: ImageFileLike): { ext: ImageExtension; slug: string } | string {
  if (!(file.size > 0)) return "that file is empty";
  if (file.size > IMAGE_MAX_BYTES) return `that image is larger than ${IMAGE_MAX_MB} MB`;
  const ext = extensionForMime(file.type) ?? extensionFromName(file.name ?? "");
  if (!ext) {
    return `${file.name !== undefined && file.name !== "" ? file.name : "that file"} is not a format the browser can draw`;
  }
  return {
    ext,
    slug: slugFromName(file.name !== undefined && file.name !== "" ? file.name : "image"),
  };
}

/** The image a paste carried, if it carried one. */
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
 * The image a drop carried. Usually `files`, but not always: an embedded browser
 * (VS Code's, for one) can hand a drag over as an item list instead.
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

/** What a drop offered, for a message the user can act on. The payload itself is
 * in there too: a drop from an embedded browser is all text, and what a text
 * payload says is the only way to tell which link to add next. */
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
    ...DROP_PATH_TYPES.map((type) => snippet(data?.getData?.(type)))
      .filter((text) => text !== "")
      .map((text) => `“${text}”`),
  ].filter((part) => part !== "");
  return carried.length === 0
    ? "that drop carried nothing the page could read — use Import image…, or paste the file"
    : `that drop carried no image (${carried.join("; ")}) — use Import image…, or paste the file`;
}

/** One payload, short enough for a status line. */
function snippet(text: string | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

/**
 * A drop that carried a *path*: an embedded browser (VS Code's explorer, for
 * one) hands the drag over as URIs in several dialects. The first one that names
 * an image file wins; the server is what decides whether it may read it.
 */
export function droppedPath(data: TransferLike | undefined): string | undefined {
  for (const type of DROP_PATH_TYPES) {
    const raw = data?.getData?.(type) ?? "";
    for (const candidate of stringsIn(raw)) {
      if (dropPathToFile(candidate) !== undefined && extensionFromName(candidate) !== undefined) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** VS Code sets the first two, `resourceurls`/`codefiles` are its own dialects,
 * and a plain path lands in `text/plain`. */
const DROP_PATH_TYPES = [
  "text/uri-list",
  "application/vnd.code.uri-list",
  "resourceurls",
  "codefiles",
  "text/plain",
];

/** The strings a payload holds, whether it is JSON (`resourceurls`, `codefiles`)
 * or one URI per line (`text/uri-list`, where `#` starts a comment). */
function stringsIn(raw: string): string[] {
  const text = raw.trim();
  if (text === "") return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return flatStrings(JSON.parse(text));
    } catch {
      return [];
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function flatStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flatStrings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(flatStrings);
  return [];
}

/** Fetch the stored asset and let the browser report its pixels — one decode
 * path for bytes and for paths. */
async function stored(
  url: string,
  at: { world: Vec2; view: { w: number; h: number; scale: number } },
  deps: UploadDeps,
): Promise<ImportedImage | string> {
  let blob: Blob;
  try {
    const res = await deps.fetch(url);
    if (!res.ok) return `the stored asset could not be read (${res.status})`;
    blob = await res.blob();
  } catch {
    return "the stored asset could not be read";
  }
  const size = await deps.decode(blob).catch(() => undefined);
  if (size === undefined) return "the browser could not draw that image";
  if (!(size.width > 0) || !(size.height > 0)) return "that image has no pixels";
  const opts = importImageOpts(at.world, size, at.view);
  return { url, size, opts, rect: imageRect(opts) };
}

/** Import a bitmap the drop named by path: the dev server reads and stores it,
 * then the browser decodes the copy it serves. */
export async function importImageByPath(
  path: string,
  at: { world: Vec2; view: { w: number; h: number; scale: number } },
  deps: UploadDeps,
): Promise<ImportedImage | string> {
  let res: Response;
  try {
    res = await deps.fetch("/__oblik-import-path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
  } catch {
    return "the dev server did not accept that path";
  }
  const body = (await res.json().catch(() => undefined)) as
    | { url?: string; error?: string }
    | undefined;
  if (!res.ok) return body?.error ?? `import failed (${res.status})`;
  if (body?.url === undefined) return "import failed";
  return stored(body.url, at, deps);
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

/** The bitmap's centre on `world`, sized to fit the view it landed in — the
 * height is left to the aspect. Its true scale is measure's job. */
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

const num = (value: number): Expr => ({ kind: "num", value });
const pointExpr = (point: Vec2): Expr => ({
  kind: "props",
  props: { x: num(point.x), y: num(point.y) },
});

/** The `/__oblik-insert` argument list for a reference: the URL, then the
 * options object — the same `Expr` tree every other insert is written from. */
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
 * pane can show; the upload happens only once the browser has drawn the bitmap.
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
