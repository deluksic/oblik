import { createEffect, createMemo, createSignal, Loading } from "solid-js";

import { tryEvaluate } from "../eval/evaluate";
import type { TraceNode } from "../eval/context";
import { assignInv, invMatches } from "../eval/inv";
import { sourceFileKey } from "../eval/stack";
import type { FigureScene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import type { MentionFile } from "../source/mention";
import { SelectionSidebar } from "../host/SelectionSidebar";
import {
  emptyScopeDetail,
  selectionDetailForScope,
  type ScopePick,
} from "../host/selection-detail";
import { traceKey } from "../euclid2/pick";
import { mentionExpr, mentionPrint, scopeFromTrace, type ScopeFocus } from "../euclid2/tool";
import { BRUSH_LOOK, styleExpr } from "./chips";
import { FigurePalette } from "./Palette";
import { FigureView } from "./View";
import { isDrawnGeom } from "./pick";
import type { FigureToolId } from "./tools";

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
  if (sourceFileKey(focus.file) === sourceFileKey(entry.file) && (focus.name ?? "build") === (entry.name ?? "build")) {
    return entry;
  }
  const n = trace.find((node) => node.inv && invMatches(node, focus));
  const inv = n?.inv;
  if (!inv?.callerFile) return entry;
  const key = sourceFileKey(inv.callerFile);
  const fn = mentions
    .flatMap((m) => m.functions)
    .find((f) => sourceFileKey(f.file) === key && inv.callerLine >= f.startLine && inv.callerLine <= f.endLine);
  if (!fn) return entry;
  const parentNode = trace.find(
    (node) => node.inv?.name === fn.name && sourceFileKey(node.inv.file) === sourceFileKey(fn.file),
  );
  return { file: fn.file, name: fn.name, serial: parentNode?.inv?.serial ?? 0 };
}

export function FigurePane(props: FigurePaneProps) {
  const [picker, setPicker] = createSignal(() => (props.file, false));
  // Paint HMR replaces `scene`; keep Brush/Eraser until Esc or a different file.
  const [tool, setTool] = createSignal<FigureToolId | null>(() => (props.file, null));
  const [shift, setShift] = createSignal(false);
  const [hoverKey, setHoverKey] = createSignal<string | null>(() => (props.scene, null));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(() => (props.file, null));
  const [focus, setFocus] = createSignal<ScopeFocus>(() => (props.file, entryFocus(props.file)));
  const [writeError, setWriteError] = createSignal<string | null>(null);

  const mentions = createMemo(() => props.mentions ?? []);

  const world = createMemo(() => {
    const w = tryEvaluate(props.scene, {
      annotations: props.annotations,
      module: props.file,
    });
    if (mentions().length > 0 && w.trace.length > 0) assignInv(w.trace, mentions());
    return w;
  });

  const scope = createMemo(() =>
    scopeFromTrace(world().trace, { focus: focus(), mentions: mentions() }),
  );

  const selectedNode = createMemo(() => {
    const key = selectedKey();
    if (!key) return null;
    return world().trace.find((n) => traceKey(n) === key) ?? null;
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

  function focusFromNode(n: TraceNode): ScopeFocus | null {
    if (!n.inv) return null;
    return {
      file: n.inv.file,
      name: n.inv.name,
      serial: n.inv.serial,
      callerFile: n.inv.callerFile,
      callerLine: n.inv.callerLine,
    };
  }

  createEffect(
    () => 1,
    () => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Shift") setShift(e.type === "keydown");
        const typing =
          e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (e.key === "Escape") {
          e.preventDefault();
          if (picker()) setPicker(false);
          else if (tool()) {
            setTool(null);
            setWriteError(null);
          } else if (selectedKey()) setSelectedKey(null);
          else setFocus(parentFocus(focus(), entryFocus(props.file), world().trace, mentions()));
          return;
        }
        if (typing) return;
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
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
      setWriteError(errBody?.error ?? `${url} failed (${res.status})`);
      return false;
    }
    setWriteError(null);
    return true;
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
      args: [expr, styleExpr(BRUSH_LOOK)],
    });
  }

  async function replacePaint(paint: TraceNode) {
    const file = paint.module ?? focus().file;
    await postJson("/__oblik-paint-style", {
      file,
      id: paint.id,
      style: styleExpr(BRUSH_LOOK),
    });
  }

  async function erasePaint(paint: TraceNode) {
    const file = paint.module ?? focus().file;
    const ok = await postJson("/__oblik-erase", { file, id: paint.id });
    if (ok && selectedKey() === traceKey(paint)) setSelectedKey(null);
  }

  async function expose(bind: string) {
    const dest = focus();
    if (!dest.name) return;
    await postJson("/__oblik-expose", { file: dest.file, dest: dest.name, bind });
  }

  function onPick(hits: TraceNode[]) {
    const n = hits[0];
    setSelectedKey(n ? traceKey(n) : null);
    if (n) {
      const next = focusFromNode(n);
      if (next) setFocus(next);
    }
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

  const status = createMemo(() => {
    const fail = writeError() ?? world().error;
    if (fail) return fail;
    const t = tool();
    if (t === "brush") {
      return shift()
        ? "Brush — hover previews, click onion to add ink. Ink stays on top. Escape leaves the brush."
        : "Brush — click ink to replace. Hold Shift to see construction and add. Escape leaves the brush.";
    }
    if (t === "eraser") return "Eraser — click ink to remove it. Construction stays. Escape leaves the eraser.";
    return "Click ink to inspect. Hold Shift for construction. Space for Brush or Eraser.";
  });

  return (
    <div class={styles.workspace}>
      <div class={styles.wrap}>
        <p class={[styles.status, { [styles.statusError]: !!(writeError() ?? world().error) }]}>{status()}</p>
        <FigureView
          trace={world().trace}
          initialCamera={props.scene.camera}
          paper={props.scene.paper}
          frame={props.scene.frame}
          tool={tool()}
          shift={shift()}
          brushLook={BRUSH_LOOK}
          hoverKey={hoverKey()}
          selectedKey={selectedKey()}
          scope={scope()}
          onShift={setShift}
          onHoverKey={setHoverKey}
          onPick={onPick}
          onToolHit={onToolHit}
        />
        <FigurePalette
          picker={picker()}
          onPick={(id) => {
            setPicker(false);
            setWriteError(null);
            setTool(id);
          }}
          onClosePicker={() => setPicker(false)}
        />
      </div>
      <div class={styles.sidebarSlot}>
        <Loading fallback={<SelectionSidebar detail={emptyScopeDetail(focus())} />}>
          <SelectionSidebar
            detail={selectionDetail()}
            onPickScope={pickScope}
            onExpose={(bind) => void expose(bind)}
          />
        </Loading>
      </div>
    </div>
  );
}
