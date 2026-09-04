import { createEffect, createMemo, createSignal, Loading, Show } from "solid-js";

import { traceKey } from "../euclid2/pick";
import { mentionExpr, mentionPrint, scopeFromTrace, type ScopeFocus } from "../euclid2/tool";
import type { TraceNode } from "../eval/context";
import { tryEvaluate } from "../eval/evaluate";
import { assignInv, invMatches } from "../eval/inv";
import { isPaint, type PaintValue } from "../eval/paint";
import { reuseUnchangedTrace } from "../eval/reuse-trace";
import type { FigureScene } from "../eval/scene";
import { sourceFileKey } from "../eval/stack";
import { ResizableSidebar } from "../host/ResizableSidebar";
import {
  emptyScopeDetail,
  selectionDetailForScope,
  type ScopePick,
} from "../host/selection-detail";
import {
  SelectionInspector,
  SelectionSidebar,
  SidebarIdentity,
  SidebarSection,
} from "../host/SelectionSidebar";
import { useRequestModal } from "../modal/ModalContext";
import type { Annotation } from "../source/analyze";
import type { MentionFile } from "../source/mention";
import { BrushDock } from "./BrushDock";
import {
  DEFAULT_BRUSH,
  figureStyleFromBrush,
  lookExpr,
  lookFromBrush,
  type BrushSettings,
} from "./chips";
import { figureToSvg } from "./export";
import { ExportModal } from "./ExportModal";
import { frameRect } from "./frame";
import { FrameEditor, type FrameXywh } from "./FrameEditor";
import { FigurePalette } from "./Palette";
import { isDrawnGeom } from "./pick";
import type { FigureToolId } from "./tools";
import { FigureView } from "./View";

import styles from "./Pane.module.css";

export type FigurePaneProps = {
  scene: FigureScene;
  file: string;
  annotations: Record<string, Annotation>;
  mentions?: readonly MentionFile[];
};

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

export function FigurePane(props: FigurePaneProps) {
  const [picker, setPicker] = createSignal(() => (props.file, false));
  // Paint HMR replaces `scene`; keep Brush/Eraser until Esc or a different file.
  const [tool, setTool] = createSignal<FigureToolId | undefined>(() => (props.file, undefined));
  const [brush, setBrush] = createSignal<BrushSettings>(() => (props.file, { ...DEFAULT_BRUSH }));
  const [shift, setShift] = createSignal(false);
  const [hoverKey, setHoverKey] = createSignal<string | undefined>(() => (props.scene, undefined));
  const [selectedKey, setSelectedKey] = createSignal<string | undefined>(
    () => (props.file, undefined),
  );
  const [focus, setFocus] = createSignal<ScopeFocus>(() => (props.file, entryFocus(props.file)));
  const [writeError, setWriteError] = createSignal<string | undefined>(undefined);
  const [frameSelected, setFrameSelected] = createSignal(() => (props.file, false));
  const [editedFrame, setEditedFrame] = createSignal<FrameXywh | undefined>(
    () => (props.scene, undefined),
  );

  const requestModal = useRequestModal();
  const mentions = createMemo(() => props.mentions ?? []);

  const frameXywh = createMemo<FrameXywh | undefined>(() => {
    const local = editedFrame();
    if (local) return local;
    const r = frameRect(props.scene.frame, props.scene.camera);
    return r ? { x: r.x, y: r.y, width: r.w, height: r.h } : undefined;
  });
  const liveFrame = createMemo(() => {
    const local = editedFrame();
    const base = props.scene.frame;
    if (!local || !base) return base;
    return { ...base, x: local.x, y: local.y, width: local.width, height: local.height };
  });

  const world = createMemo((prev: ReturnType<typeof tryEvaluate> | undefined) => {
    const w = tryEvaluate(props.scene, {
      annotations: props.annotations,
      module: props.file,
    });
    w.trace = reuseUnchangedTrace(prev?.trace, w.trace);
    if (mentions().length > 0 && w.trace.length > 0) assignInv(w.trace, mentions());
    return w;
  });

  const scope = createMemo(() =>
    scopeFromTrace(world().trace, { focus: focus(), mentions: mentions() }),
  );

  const selectedNode = createMemo(() => {
    // oxlint-disable-next-line solid/reactivity -- memo-local snapshot, used synchronously.
    const key = selectedKey();
    if (!key) return undefined;
    return world().trace.find((n) => traceKey(n) === key) ?? undefined;
  });

  const selectionDetail = createMemo(async () => {
    const node = selectedNode();
    const f = focus();
    return selectionDetailForScope({
      node,
      focus: f,
      mentions: mentions(),
      print: node ? mentionPrint(scope(), node) : undefined,
      trace: world().trace,
    });
  });

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
        if (e.key === "Shift") setShift(e.type === "keydown");
        const field =
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLButtonElement;
        if (e.key === "Escape") {
          e.preventDefault();
          if (picker()) setPicker(false);
          else if (frameSelected()) setFrameSelected(false);
          else if (tool()) {
            setTool(undefined);
            setWriteError(undefined);
          } else if (selectedKey()) setSelectedKey(undefined);
          else setFocus(parentFocus(focus(), entryFocus(props.file), world().trace, mentions()));
          return;
        }
        if (field) return;
        if (e.code === "Space") {
          if (e.repeat) return;
          e.preventDefault();
          setPicker((p) => !p);
        }
      };
      const onUp = (e: KeyboardEvent) => {
        if (e.key === "Shift") setShift(false);
      };
      const onBlur = () => setShift(false);
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onUp);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onUp);
        window.removeEventListener("blur", onBlur);
      };
    },
  );

  async function postJson(url: string, body: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      setWriteError(errBody?.error ?? `${url} failed (${res.status})`);
      return false;
    }
    setWriteError(undefined);
    return true;
  }

  function lookFor(geom: TraceNode) {
    return lookFromBrush(brush(), geom.value.kind);
  }

  function geomForPaint(paint: TraceNode): TraceNode | undefined {
    if (!isPaint(paint.value)) return undefined;
    const t = (paint.value as PaintValue).targets[0];
    if (!t) return undefined;
    return world().trace.find((n) => n.id === t.id && n.occ === t.occ);
  }

  async function insertPaint(geom: TraceNode) {
    const expr = mentionExpr(scope(), geom);
    if (!expr) {
      const who = mentionPrint(scope(), geom) ?? geom.bind ?? geom.id;
      setWriteError(`${who} is not referable here — dive or Add to return.`);
      return;
    }
    const dest = focus();
    await postJson("/__oblik-insert", {
      file: dest.file,
      dest: dest.name,
      from: "paint",
      args: [expr, lookExpr(lookFor(geom))],
    });
  }

  async function replacePaint(paint: TraceNode) {
    const file = paint.module ?? focus().file;
    const geom = geomForPaint(paint);
    await postJson("/__oblik-paint-style", {
      file,
      id: paint.id,
      style: lookExpr(geom ? lookFor(geom) : figureStyleFromBrush(brush(), true)),
    });
  }

  async function erasePaint(paint: TraceNode) {
    const file = paint.module ?? focus().file;
    const ok = await postJson("/__oblik-erase", { file, id: paint.id });
    if (ok && selectedKey() === traceKey(paint)) setSelectedKey(undefined);
  }

  async function expose(bind: string) {
    const dest = focus();
    if (!dest.name) return;
    await postJson("/__oblik-expose", { file: dest.file, dest: dest.name, bind });
  }

  function onPick(hits: TraceNode[]) {
    const n = hits[0];
    setFrameSelected(false);
    setSelectedKey(n ? traceKey(n) : undefined);
    if (n) {
      const next = focusFromNode(n);
      if (next) setFocus(next);
    }
  }

  function onPickFrame() {
    setSelectedKey(undefined);
    setFrameSelected(true);
  }

  async function commitFrame(next: FrameXywh) {
    setEditedFrame(next);
    await postJson("/__oblik-frame", { file: props.file, frame: next });
  }

  function draftFrame(next: FrameXywh) {
    setEditedFrame(next);
  }

  function onToolHit(n: TraceNode) {
    const t = tool();
    if (t === "eraser") {
      if (n.value.kind === "paint") void erasePaint(n);
      return;
    }
    if (t !== "brush") return;
    if (n.value.kind === "paint") {
      void replacePaint(n);
      return;
    }
    if (isDrawnGeom(n)) void insertPaint(n);
  }

  function openExport() {
    const result = figureToSvg({
      trace: world().trace,
      frame: props.scene.frame,
      paper: props.scene.paper,
      camera: props.scene.camera,
      title: props.scene.title,
      file: props.file,
    });
    void requestModal({
      content: (m) => (
        <ExportModal
          svg={result.svg}
          width={result.width}
          height={result.height}
          filename={result.filename}
          empty={result.empty}
          respond={m.respond}
        />
      ),
    });
  }

  const status = createMemo(() => {
    const fail = writeError() ?? world().error;
    if (fail) return fail;
    const t = tool();
    if (t === "brush") {
      return shift()
        ? "Brush — hover previews, click construction to add ink. Ink fades while construction is up. Escape leaves the brush."
        : "Brush — click ink to replace. Hold Shift to see construction and add. Escape leaves the brush.";
    }
    if (t === "eraser")
      return "Eraser — click ink to remove it. Construction stays. Escape leaves the eraser.";
    return "Click ink to inspect. Hold Shift for construction. Space for Brush, Eraser, or Export.";
  });

  return (
    <div class={styles.workspace}>
      <div class={styles.wrap}>
        <p class={[styles.status, { [styles.statusError]: !!(writeError() ?? world().error) }]}>
          {status()}
        </p>
        <div class={styles.stage}>
          <FigureView
            trace={world().trace}
            initialCamera={props.scene.camera}
            paper={props.scene.paper}
            frame={liveFrame()}
            tool={tool()}
            shift={shift()}
            brush={brush()}
            hoverKey={hoverKey()}
            selectedKey={selectedKey()}
            frameSelected={frameSelected()}
            scope={scope()}
            onShift={setShift}
            onHoverKey={setHoverKey}
            onPick={onPick}
            onToolHit={onToolHit}
            onPickFrame={onPickFrame}
            onFrameDraft={draftFrame}
            onFrameCommit={(next) => void commitFrame(next)}
          />
          <Show when={tool() === "brush"}>
            <BrushDock settings={brush()} onChange={setBrush} />
          </Show>
          <FigurePalette
            picker={picker()}
            onPick={(id) => {
              setPicker(false);
              setWriteError(undefined);
              if (id === "export") {
                openExport();
                return;
              }
              setTool(id);
            }}
            onClosePicker={() => setPicker(false)}
          />
        </div>
      </div>
      <ResizableSidebar>
        <SelectionSidebar>
          <Show
            when={frameSelected() ? frameXywh() : undefined}
            fallback={
              <Loading fallback={<SelectionInspector detail={emptyScopeDetail(focus())} />}>
                <SelectionInspector
                  detail={selectionDetail()}
                  onPickScope={pickScope}
                  onExpose={(bind) => void expose(bind)}
                />
              </Loading>
            }
          >
            {(xy) => (
              <>
                <SidebarIdentity crumb="Frame" meta="Page artboard — world units" />
                <SidebarSection title="Dimensions">
                  <FrameEditor value={xy()} onChange={(next) => void commitFrame(next)} />
                </SidebarSection>
              </>
            )}
          </Show>
        </SelectionSidebar>
      </ResizableSidebar>
    </div>
  );
}
