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
import { styleExpr, type StyleChip } from "./chips";
import { FigurePalette } from "./Palette";
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
  const [picker, setPicker] = createSignal(() => (props.scene, false));
  const [chip, setChip] = createSignal<StyleChip | null>(() => (props.scene, null));
  const [hoverId, setHoverId] = createSignal<string | null>(() => (props.scene, null));
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
        const typing =
          e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (e.key === "Escape") {
          e.preventDefault();
          if (picker()) setPicker(false);
          else if (chip()) {
            setChip(null);
            setWriteError(null);
          } else if (selectedKey()) setSelectedKey(null);
          else setFocus(parentFocus(focus(), entryFocus(props.file), world().trace, mentions()));
          return;
        }
        if (typing) return;
        if (e.code === "Space" && !chip()) {
          e.preventDefault();
          setPicker((p) => !p);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    },
  );

  async function insert(job: { from: string; args: unknown }) {
    const dest = focus();
    const res = await fetch("/__oblik-insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: dest.file, dest: dest.name, ...job }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setWriteError(body?.error ?? `insert failed (${res.status})`);
      return;
    }
    setWriteError(null);
    setChip(null);
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
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setWriteError(body?.error ?? `expose failed (${res.status})`);
      return;
    }
    setWriteError(null);
  }

  function onPick(hits: TraceNode[]) {
    const n = hits[0];
    setSelectedKey(n ? traceKey(n) : null);
    if (!chip() && n) {
      const next = focusFromNode(n);
      if (next) setFocus(next);
    }
  }

  function onPaint(n: TraceNode) {
    const look = chip();
    if (!look) return;
    const expr = mentionExpr(scope(), n);
    if (!expr) {
      const who = mentionPrint(scope(), n) ?? n.bind ?? n.id;
      setWriteError(`${who} is not referable here — dive or Add to return.`);
      return;
    }
    void insert({
      from: "paint",
      args: [expr, styleExpr(look.style)],
    });
  }

  const status = createMemo(() => {
    const fail = writeError() ?? world().error;
    if (fail) return fail;
    const look = chip();
    if (look) return `${look.title} — click nameable geom to paint. Escape cancels.`;
    return "Space picks a style. Click to inspect (select is scope). Outline not returned stays onioned.";
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
          placing={chip() != null}
          hoverId={hoverId()}
          selectedKey={selectedKey()}
          scope={scope()}
          onHoverId={setHoverId}
          onPick={onPick}
          onPaint={onPaint}
        />
        <FigurePalette
          picker={picker()}
          onPick={(next) => {
            setPicker(false);
            setWriteError(null);
            setChip(next);
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
