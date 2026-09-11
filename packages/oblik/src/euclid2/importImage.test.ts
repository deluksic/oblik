import { describe, expect, test } from "vitest";

import {
  checkImage,
  describeDrop,
  droppedImage,
  droppedPath,
  imageArgs,
  importImage,
  importImageByPath,
  importImageOpts,
  pastedImage,
  type TransferLike,
} from "./importImage";

const PNG = { type: "image/png", name: "Some Gear (2).PNG", size: 4096 };
const VIEW = { w: 800, h: 600, scale: 60 };

function fileOf(over: Partial<{ type: string; name: string; size: number; bytes: number[] }> = {}) {
  const bytes = new Uint8Array(over.bytes ?? [1, 2, 3]);
  return {
    type: over.type ?? "image/png",
    ...(over.name !== undefined ? { name: over.name } : {}),
    size: over.size ?? bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Blob & { name?: string; size: number; type?: string };
}

function fakeFetch(
  respond: (url: string, body: unknown) => { ok: boolean; status?: number; json?: unknown },
) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (async (url: string, init?: { body?: unknown }) => {
    calls.push({ url, body: init?.body });
    const r = respond(url, init?.body);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const decodeTo = (size: { width: number; height: number }) => async () => size;

/** A clipboard item carrying `file`, or none at all. */
function item(type: string, file: typeof PNG | undefined) {
  return { kind: "file", type, getAsFile: () => file };
}

describe("checkImage", () => {
  test("takes the extension from the MIME type", () => {
    expect(checkImage(PNG)).toEqual({ ext: "png", slug: "some-gear-2" });
  });

  test("falls back to the file name when the browser gave no type", () => {
    expect(checkImage({ type: "", name: "scan.WEBP", size: 10 })).toEqual({
      ext: "webp",
      slug: "scan",
    });
  });

  test("refuses what it cannot name, before anything is uploaded", () => {
    expect(typeof checkImage({ type: "image/heic", name: "photo.heic", size: 10 })).toBe("string");
    expect(typeof checkImage({ type: "", name: "notes.txt", size: 10 })).toBe("string");
    expect(typeof checkImage({ type: "image/png", name: "empty.png", size: 0 })).toBe("string");
    expect(typeof checkImage({ type: "image/png", name: "huge.png", size: 64 * 1024 * 1024 })).toBe(
      "string",
    );
  });

  test("a screenshot with no name still gets a slug", () => {
    expect(checkImage({ type: "image/png", size: 10 })).toEqual({ ext: "png", slug: "image" });
  });
});

describe("pastedImage / droppedImage", () => {
  test("a pasted bitmap comes off the items, not the (empty) files list", () => {
    const data = { files: [], items: [item("image/png", PNG)] };
    expect(pastedImage(data)).toBe(PNG);
  });

  test("a real file on the clipboard is found in files", () => {
    expect(pastedImage({ files: [PNG], items: [] })).toBe(PNG);
    expect(droppedImage({ files: [PNG] })).toBe(PNG);
  });

  test("a drop reads items as well as files — an embedded browser may send either", () => {
    expect(droppedImage({ files: [PNG] })).toBe(PNG);
    expect(droppedImage({ files: [], items: [item("image/png", PNG)] })).toBe(PNG);
    expect(droppedImage({ files: [], items: [item("text/plain", undefined)] })).toBeUndefined();
  });

  test("an empty drop says what it carried, so the user can act", () => {
    // Nothing at all: an embedded browser swallowing the drag looks like this.
    expect(describeDrop(undefined)).toContain("use Import image…");
    expect(describeDrop({ files: [], items: [], types: [] })).toContain("carried nothing");
    // A real drag from outside the page: a URI list, and no file the page can read.
    const uri = { files: [], items: [], types: ["text/uri-list", "text/plain"] };
    const message = describeDrop(uri);
    expect(message).toContain("types: text/uri-list, text/plain");
    expect(message).toContain("use Import image…");
    // A non-image file is named too.
    expect(
      describeDrop({ files: [{ type: "application/pdf", name: "a.pdf", size: 3 }] }),
    ).toContain("1 file");
  });

  test("text and other non-images are left alone", () => {
    // oxlint-disable-next-line unicorn/no-null -- the DOM reports "no file" as null
    const empty = { kind: "string", type: "text/plain", getAsFile: () => null };
    expect(pastedImage({ files: [], items: [empty] })).toBeUndefined();
    expect(pastedImage({ files: [], items: [item("text/html", undefined)] })).toBeUndefined();
    expect(
      pastedImage({ files: [{ type: "application/pdf", name: "a.pdf", size: 1 }] }),
    ).toBeUndefined();
    expect(pastedImage(undefined)).toBeUndefined();
    expect(droppedImage(undefined)).toBeUndefined();
  });

  test("the first image wins when a paste carries several things", () => {
    const other = { type: "image/jpeg", name: "b.jpg", size: 2 };
    expect(
      pastedImage({ files: [], items: [item("image/png", PNG), item("image/jpeg", other)] }),
    ).toBe(PNG);
  });

  test("an item that reports no file falls through to the next one", () => {
    // oxlint-disable-next-line unicorn/no-null -- the DOM reports "no file" as null
    const blank = { kind: "file", type: "image/png", getAsFile: () => null };
    const data = { files: [], items: [blank, item("image/png", PNG)] };
    expect(pastedImage(data)).toBe(PNG);
  });
});

describe("importImageOpts", () => {
  test("centres the bitmap on the world point, at a size the view can show", () => {
    const opts = importImageOpts({ x: 3, y: 4 }, { width: 404, height: 500 }, VIEW);
    expect(opts.world).toEqual({ x: 3, y: 4 });
    expect(opts.anchor).toEqual({ x: 202, y: 250 });
    expect(opts.imageSize).toEqual({ width: 404, height: 500 });
    // 90% of the view's height, which is the limiting axis for this portrait file.
    expect((opts.targetSize.width! * 500) / 404).toBeCloseTo((600 / 60) * 0.9, 9);
    expect(opts.style).toEqual({ saturation: 0.15 });
  });

  test("states the width only, so the aspect stays the file's", () => {
    expect(importImageOpts({ x: 0, y: 0 }, { width: 100, height: 50 }, VIEW).targetSize).toEqual({
      width: expect.any(Number),
    });
  });
});

describe("imageArgs", () => {
  test("builds the insert arguments the printer expects", () => {
    const opts = importImageOpts({ x: 1, y: 2 }, { width: 40, height: 20 }, VIEW);
    expect(imageArgs("/assets/a-1b2c3d4e.png", opts)).toEqual([
      { kind: "str", value: "/assets/a-1b2c3d4e.png" },
      {
        kind: "props",
        props: {
          world: {
            kind: "props",
            props: { x: { kind: "num", value: 1 }, y: { kind: "num", value: 2 } },
          },
          imageSize: {
            kind: "props",
            props: { width: { kind: "num", value: 40 }, height: { kind: "num", value: 20 } },
          },
          targetSize: {
            kind: "props",
            props: { width: { kind: "num", value: opts.targetSize.width } },
          },
          anchor: {
            kind: "props",
            props: { x: { kind: "num", value: 20 }, y: { kind: "num", value: 10 } },
          },
          style: { kind: "props", props: { saturation: { kind: "num", value: 0.15 } } },
        },
      },
    ]);
  });

  test("omits the props a node does not state", () => {
    const args = imageArgs("/a.png", {
      world: { x: 0, y: 0 },
      imageSize: { width: 4, height: 4 },
      targetSize: {},
    });
    const props = (args[1] as { props: Record<string, unknown> }).props;
    expect(Object.keys(props)).toEqual(["world", "imageSize"]);
  });
});

describe("importImage", () => {
  const world = { x: 0, y: 0 };

  test("decodes, uploads the bytes, and returns what to insert", async () => {
    const { impl, calls } = fakeFetch(() => ({
      ok: true,
      json: { url: "/assets/gear-9f3a2c11.png" },
    }));
    const result = await importImage(
      fileOf(PNG),
      { world, view: VIEW },
      {
        decode: decodeTo({ width: 404, height: 500 }),
        fetch: impl,
      },
    );
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") throw new Error(result);
    expect(result.url).toBe("/assets/gear-9f3a2c11.png");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/__oblik-import-image?slug=some-gear-2&ext=png");
  });

  /**
   * Decode runs first because the browser is the only format oracle: a file it
   * cannot draw never reaches the server, so a rejected drop leaves no orphan.
   */
  test("a file that does not decode is refused before the upload", async () => {
    const { impl, calls } = fakeFetch(() => ({ ok: true, json: { url: "/assets/x.png" } }));
    const result = await importImage(
      fileOf(PNG),
      { world, view: VIEW },
      {
        decode: async () => {
          throw new Error("bad bitmap");
        },
        fetch: impl,
      },
    );
    expect(result).toBe("the browser could not draw that image");
    expect(calls).toHaveLength(0);
  });

  test("a file the gate refuses is refused before the decode too", async () => {
    const { impl, calls } = fakeFetch(() => ({ ok: true, json: {} }));
    let decoded = false;
    const result = await importImage(
      fileOf({ type: "image/heic", name: "a.heic" }),
      { world, view: VIEW },
      {
        decode: async () => {
          decoded = true;
          return { width: 1, height: 1 };
        },
        fetch: impl,
      },
    );
    expect(typeof result).toBe("string");
    expect(decoded).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("a server refusal is surfaced, not swallowed", async () => {
    const { impl } = fakeFetch(() => ({
      ok: false,
      status: 400,
      json: { error: "unsupported image extension" },
    }));
    expect(
      await importImage(
        fileOf(PNG),
        { world, view: VIEW },
        {
          decode: decodeTo({ width: 4, height: 4 }),
          fetch: impl,
        },
      ),
    ).toBe("unsupported image extension");
  });

  test("a network failure is a message, not a throw", async () => {
    const impl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await importImage(
        fileOf(PNG),
        { world, view: VIEW },
        {
          decode: decodeTo({ width: 4, height: 4 }),
          fetch: impl,
        },
      ),
    ).toBe("the dev server did not accept the upload");
  });

  test("an empty decode is refused rather than written as a zero rect", async () => {
    const { impl, calls } = fakeFetch(() => ({ ok: true, json: { url: "/assets/x.png" } }));
    expect(
      await importImage(
        fileOf(PNG),
        { world, view: VIEW },
        {
          decode: decodeTo({ width: 0, height: 0 }),
          fetch: impl,
        },
      ),
    ).toBe("that image has no pixels");
    expect(calls).toHaveLength(0);
  });
});

/** A drop from an embedded browser: text payloads, no files. */
function textDrop(payloads: Record<string, string>): TransferLike {
  return { getData: (type: string) => payloads[type] ?? "" } as unknown as TransferLike;
}

describe("droppedPath", () => {
  test("reads the URI list, comments and CRLF and all", () => {
    const drop = textDrop({ "text/uri-list": "# 1 file\r\nfile:///work/ref.png\r\n" });
    expect(droppedPath(drop)).toBe("file:///work/ref.png");
  });

  test("reads the JSON dialects", () => {
    const urls = textDrop({ resourceurls: JSON.stringify(["file:///work/ref.png"]) });
    expect(droppedPath(urls)).toBe("file:///work/ref.png");
    const code = textDrop({
      codefiles: JSON.stringify([{ resource: { fsPath: "/work/ref.png" } }]),
    });
    expect(droppedPath(code)).toBe("/work/ref.png");
  });

  test("skips what is not an image and keeps looking", () => {
    const drop = textDrop({
      "text/uri-list": "file:///work/notes.md",
      "text/plain": "/work/ref.PNG",
    });
    expect(droppedPath(drop)).toBe("/work/ref.PNG");
  });

  test("nothing to take from links, words, or the browser's own page drag", () => {
    expect(droppedPath(undefined)).toBeUndefined();
    expect(
      droppedPath(textDrop({ "text/uri-list": "https://example.com/ref.png" })),
    ).toBeUndefined();
    expect(droppedPath(textDrop({ "text/plain": "hello" }))).toBeUndefined();
    expect(droppedPath(textDrop({ codefiles: "not json" }))).toBeUndefined();
  });
});

describe("describeDrop", () => {
  test("quotes the text payload back — that is what says which dialect to add next", () => {
    const drop = textDrop({ "text/uri-list": "file:///work/notes.md" });
    const message = describeDrop({ ...drop, files: [], items: [], types: ["text/uri-list"] });
    expect(message).toContain("file:///work/notes.md");
  });
});

function assetFetch(respond: (url: string) => { ok: boolean; status?: number; json?: unknown }) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    calls.push(String(input));
    const r = respond(String(input));
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json ?? {},
      blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const AT = { world: { x: 10, y: 20 }, view: VIEW };

describe("importImageByPath", () => {
  test("asks the dev server to read the path, then decodes the copy it serves", async () => {
    const { impl, calls } = assetFetch((url) =>
      url === "/__oblik-import-path"
        ? { ok: true, json: { url: "/assets/ref-1a2b3c4d.png" } }
        : { ok: true },
    );
    const result = await importImageByPath("file:///work/ref.png", AT, {
      fetch: impl,
      decode: async () => ({ width: 800, height: 600 }),
    });
    expect(calls).toEqual(["/__oblik-import-path", "/assets/ref-1a2b3c4d.png"]);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;
    expect(result.url).toBe("/assets/ref-1a2b3c4d.png");
    expect(result.size).toEqual({ width: 800, height: 600 });
    expect(result.opts.world).toEqual({ x: 10, y: 20 });
    expect(result.opts.anchor).toEqual({ x: 400, y: 300 });
    expect(result.rect.w).toBeGreaterThan(0);
  });

  test("a refusal from the dev server is the message the pane shows", async () => {
    const { impl } = assetFetch(() => ({
      ok: false,
      status: 400,
      json: { error: "ref.png is outside the project root" },
    }));
    const result = await importImageByPath("/elsewhere/ref.png", AT, {
      fetch: impl,
      decode: async () => ({ width: 1, height: 1 }),
    });
    expect(result).toBe("ref.png is outside the project root");
  });

  test("a stored asset the browser cannot draw says so", async () => {
    const { impl } = assetFetch((url) =>
      url === "/__oblik-import-path" ? { ok: true, json: { url: "/assets/x.png" } } : { ok: true },
    );
    const result = await importImageByPath("/work/ref.png", AT, {
      fetch: impl,
      decode: async () => {
        throw new Error("no");
      },
    });
    expect(result).toBe("the browser could not draw that image");
  });
});
