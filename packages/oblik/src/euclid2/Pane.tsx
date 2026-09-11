import { createEffect, createMemo, createSignal, Loading, Show } from "solid-js";

import { TypegpuView } from "../euclid2-typegpu/TypegpuView";
import type { TraceNode } from "../eval/context";
import { tryEvaluate, type Draft } from "../eval/evaluate";
import type { ImageValue } from "../eval/image";
import { assignInv, invMatches } from "../eval/inv";
import { carryTraceInv, reuseUnchangedTrace } from "../eval/reuse-trace";
import type { Euclid2Scene } from "../eval/scene";
import type { VisitCaches } from "../eval/scene-cache";
import { sourceFileKey } from "../eval/stack";
import type { Vec2 } from "../geom";
import { openInEditor } from "../host/editor";
import { createEvalstatsSetting } from "../host/evalstats";
import { ResizableSidebar } from "../host/ResizableSidebar";
import {
  emptyScopeDetail,
  selectionDetailForScope,
  type ScopePick,
  type SelectionDetail,
} from "../host/selection-detail";
import { SelectionInspector, SelectionSidebar } from "../host/SelectionSidebar";
import type { Annotation } from "../source/analyze";
import type { ImageProps } from "../source/image-edit";
import type { MentionFile } from "../source/mention";
import { freshSiteId } from "../source/stamp";
import { ImageInspector } from "./ImageInspector";
import { applyImageLeaves, withImageOverride, type ImageOverride } from "./imageOverride";
import { imageArgs, importImage } from "./importImage";
import { Palette } from "./Palette";
import { traceKey } from "./pick";
import {
  clickTool,
  ghostOf,
  keyTool,
  mentionPrint,
  previewOf,
  scopeFromTrace,
  startTool,
  tabTool,
  typeTool,
  type PlaceHit,
  type ScopeFocus,
  type ToolId,
  type ToolSession,
  type ToolStep,
} from "./tool";
import type { InsertJob } from "./tools/types";

import { status as statusLine, statusError, workspace, wrap } from "../ui/pane.module.css";
import styles from "./Pane.module.css";

export type Euclid2PaneProps = {
  scene: Euclid2Scene;
  file: string;
  annotations: Record<string, Annotation>;
  mentions?: readonly MentionFile[];
  /** This visit's caches: the pane asks them for its own scene's entry. */
  caches: VisitCaches;
};

type WorldEval = ReturnType<typeof tryEvaluate> & { ms: number };

function entryFocus(file: string): ScopeFocus {
  return { file, name: "build", serial: 0 };
}

function parentFocus(
  focus: ScopeFocus,
  entry: ScopeFocus,
  trace: readonly TraceNode[],
  mentions: readonly MentionFile[],
): ScopeFocus {
  if (
    sourceFileKey(focus.file) === sourceFileKey(entry.file) &&
    (focus.name ?? "build") === (entry.name ?? "build")
  ) {
    return entry;
  }
  const n = trace.find((node) => node.inv && invMatches(node, focus));
  const inv = n?.inv;
  if (!inv?.callerFile) return entry;
  const key = sourceFileKey(inv.callerFile);
  const fn = mentions
    .flatMap((m) => m.functions)
    .find(
      (f) =>
        sourceFileKey(f.file) === key &&
        inv.callerLine >= f.startLine &&
        inv.callerLine <= f.endLine,
    );
  if (!fn) return entry;
  const parentNode = trace.find(
    (node) =>
      node.inv?.name === fn.name &&
      node.inv &&
      sourceFileKey(node.inv.file) === sourceFileKey(fn.file),
  );
  return { file: fn.file, name: fn.name, serial: parentNode?.inv?.serial ?? 0 };
}

function focusFromNode(n: TraceNode): ScopeFocus | undefined {
  if (!n.inv) return undefined;
  return {
    file: n.inv.file,
    name: n.inv.name,
    serial: n.inv.serial,
    callerFile: n.inv.callerFile,
    callerLine: n.inv.callerLine,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, av] of a) {
    const bv = b.get(id);
    if (!bv || bv.length !== av.length || bv.some((v, i) => v !== av[i])) return false;
  }
  return true;
}

/** Decode a blob to its pixel size. `createImageBitmap` is the only
 * format-specific code in the app — the browser is the only oracle for "can this
 * be drawn", so the import asks it before uploading anything. */
async function decodeImage(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export function Euclid2Pane(props: Euclid2PaneProps) {
  // Content equality: a drag past a slider's end (or a clamped/stationary
  // handle) re-emits identical values on every pointermove — the signal must
  // not notify, or the scene re-evals for nothing.
  const [draft, setDraft] = createSignal<Draft>(() => (props.scene, new Map()), {
    equals: sameDraft,
  });
  const [picker, setPicker] = createSignal(() => (props.scene, false));
  const [tool, setTool] = createSignal<ToolSession | undefined>(() => (props.scene, undefined));
  const [place, setPlace] = createSignal<PlaceHit | undefined>(() => (props.scene, undefined));
  const [hoverKey, setHoverKey] = createSignal<string | undefined>(() => (props.scene, undefined));
  const [selectedKey, setSelectedKey] = createSignal<string | undefined>(
    () => (props.file, undefined),
  );
  const [focus, setFocus] = createSignal<ScopeFocus>(() => (props.file, entryFocus(props.file)));
  const [toolLock, setToolLock] = createSignal(false);
  const [writeError, setWriteError] = createSignal<string | undefined>(undefined);
  const [liveEdit, setLiveEdit] = createSignal(() => (props.scene, false));
  const evalstats = createEvalstatsSetting();

  const mentions = createMemo(() => props.mentions ?? []);
  const world = createMemo((prev: WorldEval | undefined) => {
    console.log("Running world");
    const t0 = performance.now();
    const w = tryEvaluate(props.scene, {
      draft: draft(),
      annotations: props.annotations,
      module: props.file,
      captureStack: !liveEdit(),
      memo: props.caches(props.scene).memo,
    });
    const ms = performance.now() - t0;
    w.trace = reuseUnchangedTrace(prev?.trace, w.trace);
    if (liveEdit()) carryTraceInv(prev?.trace, w.trace);
    else if (mentions().length > 0 && w.trace.length > 0) assignInv(w.trace, mentions());
    return { ...w, ms };
  });

  const scope = createMemo(() =>
    scopeFromTrace(world().trace, { focus: focus(), mentions: mentions() }),
  );

  const selectedNode = createMemo(() => {
    // key is a memo-local snapshot used synchronously; the memo re-runs on change.
    // oxlint-disable-next-line solid/reactivity
    const key = selectedKey();
    if (!key) return undefined;
    return world().trace.find((n) => traceKey(n) === key) ?? undefined;
  });

  let frozenDetail: SelectionDetail | undefined;
  const selectionDetail = createMemo(async () => {
    if (liveEdit()) return frozenDetail ?? emptyScopeDetail(focus());
    const node = selectedNode();
    const f = focus();
    const detail = await selectionDetailForScope({
      node,
      focus: f,
      mentions: mentions(),
      print: node ? mentionPrint(scope(), node) : undefined,
      trace: world().trace,
    });
    frozenDetail = detail;
    return detail;
  });

  function applyStep(next: ToolStep | undefined) {
    if (!next) return;
    if ("insert" in next) void insert(next.insert);
    else setTool(next.session);
  }

  function pickScope(pick: ScopePick) {
    setFocus({
      file: pick.file,
      name: pick.name,
      serial: pick.serial,
      callerFile: pick.callerFile,
      callerLine: pick.callerLine,
    });
  }

  createEffect(
    () => 1,
    () => {
      const onKey = (e: KeyboardEvent) => {
        const typing =
          e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (e.key === "Escape") {
          e.preventDefault();
          if (picker()) setPicker(false);
          else if (tool()) {
            setTool(undefined);
            setPlace(undefined);
            setWriteError(undefined);
            if (toolLock()) {
              setFocus(parentFocus(focus(), entryFocus(props.file), world().trace, mentions()));
              setToolLock(false);
            }
          } else if (selectedKey()) setSelectedKey(undefined);
          else setFocus(parentFocus(focus(), entryFocus(props.file), world().trace, mentions()));
          return;
        }
        if (typing) return;
        if (e.code === "Space" && !tool()) {
          e.preventDefault();
          setPicker((p) => !p);
          return;
        }
        const session = tool();
        if (!session || picker()) return;
        const next = keyTool(
          session,
          {
            key: e.key,
            shift: e.shiftKey,
            ctrl: e.ctrlKey,
            meta: e.metaKey,
            alt: e.altKey,
          },
          place(),
          scope(),
        );
        if (next) {
          e.preventDefault();
          applyStep(next);
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") e.preventDefault();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    },
  );

  function mergeDraft(id: string, values: number[]) {
    setDraft((d) => {
      const n = new Map(d);
      n.set(id, values);
      return n;
    });
  }

  async function commit(id: string, values: number[]) {
    mergeDraft(id, values);
    const file = world().trace.find((n) => n.id === id)?.module ?? props.file;
    const res = await fetch("/__oblik-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, id, target: "literal", values }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      setWriteError(body?.error ?? `patch failed (${res.status})`);
      return;
    }
    setWriteError(undefined);
  }

  /**
   * A pasted or dropped bitmap: upload the bytes, then insert the node that
   * draws them. Two requests, so a failed insert leaves the asset on disk —
   * which the status line says, because a silent orphan is worse than a loud one.
   */
  async function importAt(
    file: File,
    at: { world: Vec2; view: { w: number; h: number; scale: number } },
  ) {
    const result = await importImage(file, at, {
      decode: decodeImage,
      fetch: (input, init) => fetch(input, init),
    });
    if (typeof result === "string") {
      setWriteError(result);
      return;
    }
    setWriteError(undefined);
    // The id is minted here rather than server-side so the node that was just
    // written can be selected: a pasted reference arrives selected, which is
    // what makes the inspector and its outline useful immediately.
    const id = freshSiteId();
    await insert({ from: "image", args: imageArgs(result.url, result.opts), id });
    setSelectedKey(`${id}:0`);
  }

  /**
   * A live edit that has not been written to the source yet. A patch costs a
   * file write and a full HMR round, so a drag previews here and commits on
   * release; the evaluated tape is what the view draws and the inspector reads,
   * so the preview *is* the drag.
   */
  const [imageOverride, setImageOverride] = createSignal<ImageOverride | undefined>(undefined, {
    equals: false,
  });

  /** Set by the view: where the camera is and how big the pane is, which is
   * what an import from the picker places against. */
  const [view, setView] = createSignal(
    { w: 800, h: 600, scale: 48, x: 0, y: 0 },
    { equals: false },
  );

  /** The picker's file input. Import is a pane action — it is about the paper,
   * not about the selected node — so it lives in the pane's chrome beside the
   * status line, and a picked file takes the same path as a paste, placed at the
   * middle of what the user is looking at. */
  const [importEl, setImportEl] = createSignal<HTMLInputElement | undefined>(undefined);

  function importPicked(file: File) {
    void importAt(file, { world: { x: view().x, y: view().y }, view: view() });
  }

  /** Write reference leaves through the patch endpoint — the only writer a
   * reference has, since its numbers live inside an options object. */
  /** Show a live edit without writing it, keyed to the node it belongs to. */
  function previewImage(leaves: ImageProps) {
    const node = imageNode();
    if (!node || node.value.kind !== "image") return;
    setImageOverride({ id: node.id, occ: node.occ, value: applyImageLeaves(node.value, leaves) });
  }

  async function patchImage(leaves: ImageProps) {
    const node = imageNode();
    if (!node) return;
    previewImage(leaves);
    const file = node.module ?? focus().file;
    const res = await fetch("/__oblik-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, id: node.id, props: leaves }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      // A failed write drops the preview: the canvas goes back to source truth
      // rather than keeping a value the file does not have.
      setImageOverride(undefined);
      setWriteError(body?.error ?? `patch failed (${res.status})`);
      return;
    }
    setWriteError(undefined);
  }

  async function insert(job: InsertJob) {
    const dest = focus();
    const res = await fetch("/__oblik-insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: dest.file, dest: dest.name, ...job }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      setWriteError(body?.error ?? `insert failed (${res.status})`);
      return;
    }
    setWriteError(undefined);
    setTool(undefined);
    setPlace(undefined);
    setToolLock(false);
  }

  async function expose(bind: string) {
    const dest = focus();
    if (!dest.name) return;
    const res = await fetch("/__oblik-expose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: dest.file, dest: dest.name, bind }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      setWriteError(body?.error ?? `expose failed (${res.status})`);
      return;
    }
    setWriteError(undefined);
  }

  async function openAt(file: string, line: number) {
    try {
      await openInEditor(file, line);
      setWriteError(undefined);
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    }
  }

  function onPlace(hit: PlaceHit) {
    const session = tool();
    if (!session) return;
    setPlace(hit);
    const next = clickTool(session, hit, scope());
    if ("insert" in next) void insert(next.insert);
    else setTool(next.session);
  }

  function onPick(hits: TraceNode[]) {
    const n = hits[0];
    setSelectedKey(n ? traceKey(n) : undefined);
    if (!tool() && n) {
      const next = focusFromNode(n);
      if (next) setFocus(next);
    }
  }

  const draftIds = createMemo(() => [...draft().keys()]);
  const ghost = createMemo(() => {
    const t = tool();
    const p = place();
    return t ? ghostOf(t, p, scope()) : undefined;
  });
  const prompt = createMemo(() => {
    const t = tool();
    if (!t) return undefined;
    return previewOf(t, place(), scope());
  });
  const status = createMemo(() => {
    const fail = writeError() ?? world().error;
    if (fail) return fail;
    if (tool())
      return "Type into the prompt. Press, or Tab to advance to the next argument. Enter commits. Escape cancels.";
    const ids = draftIds();
    if (ids.length > 0) return `Override ${ids.join(", ")} until the next build.`;
    return "Space inserts. Click to inspect (select is scope). Drag handles write literals.";
  });

  /** The evaluated tape with the live edit applied — what the view draws and
   * what the inspector shows, so a drag and its preview are one thing.
   *
   * Declared before the memos that read it: `createMemo` runs its body
   * immediately to establish the initial value, so a memo reading one declared
   * further down the component is a temporal-dead-zone crash at mount. */
  const tape = createMemo(() => withImageOverride(world().trace, imageOverride()));

  /** The selected reference, when the selection is one: that is what the
   * inspector edits. */
  const imageNode = createMemo(() => {
    const node = tape().find((n) => traceKey(n) === selectedKey());
    return node?.value.kind === "image" ? node : undefined;
  });

  return (
    <div class={workspace}>
      <div class={wrap}>
        <p class={[statusLine, { [statusError]: !!(writeError() ?? world().error) }]}>{status()}</p>
        {/* The palette's "Import image" entry drives this; a reference is
            imported, not drawn, so it is not a button on the paper either. */}
        <input
          ref={setImportEl}
          class={styles.hiddenFile}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file !== undefined) importPicked(file);
          }}
        />
        <div class={styles.paperWrap}>
          <TypegpuView
            trace={tape()}
            initialCamera={props.scene.camera}
            placing={tool() !== undefined}
            ghost={ghost()}
            place={place()}
            toolSession={tool()}
            hoverKey={hoverKey()}
            selectedKey={selectedKey()}
            scope={scope()}
            onHoverKey={setHoverKey}
            onPick={onPick}
            onDraft={mergeDraft}
            onCommit={(id, values) => void commit(id, values)}
            onLiveEdit={setLiveEdit}
            onPlace={onPlace}
            onCursor={setPlace}
            onImportImage={(file, at) => void importAt(file, at)}
            onView={setView}
            onNotice={(text) => setWriteError(text)}
            evalStats={
              evalstats.value()
                ? { ms: world().ms, built: world().stats.built, hits: world().stats.hits }
                : undefined
            }
          />
        </div>
        <Palette
          picker={picker()}
          prompt={prompt()}
          onPick={(id: ToolId) => {
            setPicker(false);
            setPlace(undefined);
            setWriteError(undefined);
            // The palette carries one entry that is not a constructor: a
            // reference is imported, so it opens a file picker rather than
            // starting a tool session.
            if (id === "importImage") {
              importEl()?.click();
              return;
            }
            setToolLock(true);
            setTool(startTool(id));
          }}
          onClosePicker={() => setPicker(false)}
          onDraft={(raw) => {
            const session = tool();
            if (session) setTool(typeTool(session, raw));
          }}
          onTab={(dir) => {
            const session = tool();
            if (session) setTool(tabTool(session, dir));
          }}
          onCommit={() => {
            const session = tool();
            if (!session) return;
            applyStep(keyTool(session, { key: "Enter" }, place(), scope()));
          }}
        />
      </div>
      <ResizableSidebar>
        <Loading fallback={<SelectionSidebar detail={emptyScopeDetail(focus())} />}>
          <SelectionInspector
            detail={selectionDetail()}
            onPickScope={pickScope}
            onExpose={(bind) => void expose(bind)}
            onOpenFile={(file, line) => void openAt(file, line)}
          >
            <Show when={imageNode()}>
              {(node) => (
                <ImageInspector
                  value={node().value as ImageValue}
                  onPreview={previewImage}
                  onCommit={(leaves) => void patchImage(leaves)}
                />
              )}
            </Show>
          </SelectionInspector>
        </Loading>
      </ResizableSidebar>
    </div>
  );
}
