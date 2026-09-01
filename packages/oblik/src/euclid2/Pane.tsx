import { createEffect, createMemo, createSignal, Loading } from "solid-js";

import { tryEvaluate, type Draft } from "../eval/evaluate";
import type { TraceNode } from "../eval/context";
import { assignInv, invMatches } from "../eval/inv";
import { sourceFileKey } from "../eval/stack";
import type { Euclid2Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import type { MentionFile } from "../source/mention";
import { SelectionSidebar } from "../host/SelectionSidebar";
import {
  emptyScopeDetail,
  selectionDetailForScope,
  type ScopePick,
} from "../host/selection-detail";
import { traceKey } from "./pick";
import { Palette } from "./Palette";
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
import { Euclid2View } from "./view/View";

import styles from "./Pane.module.css";

export type Euclid2PaneProps = {
  scene: Euclid2Scene;
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
    (node) =>
      node.inv?.name === fn.name && node.inv && sourceFileKey(node.inv.file) === sourceFileKey(fn.file),
  );
  return { file: fn.file, name: fn.name, serial: parentNode?.inv?.serial ?? 0 };
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

export function Euclid2Pane(props: Euclid2PaneProps) {
  const [draft, setDraft] = createSignal<Draft>(() => (props.scene, new Map()));
  const [picker, setPicker] = createSignal(() => (props.scene, false));
  const [tool, setTool] = createSignal<ToolSession | null>(() => (props.scene, null));
  const [place, setPlace] = createSignal<PlaceHit | null>(() => (props.scene, null));
  const [hoverId, setHoverId] = createSignal<string | null>(() => (props.scene, null));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(() => (props.file, null));
  const [focus, setFocus] = createSignal<ScopeFocus>(() => (props.file, entryFocus(props.file)));
  const [toolLock, setToolLock] = createSignal(false);
  const [writeError, setWriteError] = createSignal<string | null>(null);

  const mentions = createMemo(() => props.mentions ?? []);

  const world = createMemo(() => {
    const w = tryEvaluate(props.scene, {
      draft: draft(),
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
            setTool(null);
            setPlace(null);
            setWriteError(null);
            if (toolLock()) {
              setFocus(parentFocus(focus(), entryFocus(props.file), world().trace, mentions()));
              setToolLock(false);
            }
          } else if (selectedKey()) setSelectedKey(null);
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
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setWriteError(body?.error ?? `patch failed (${res.status})`);
      return;
    }
    setWriteError(null);
  }

  async function insert(job: {
    from: string;
    args: unknown;
    bind?: string;
    patchVertex?: { id: string; index: number };
  }) {
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
    setTool(null);
    setPlace(null);
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
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setWriteError(body?.error ?? `expose failed (${res.status})`);
      return;
    }
    setWriteError(null);
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
    setSelectedKey(n ? traceKey(n) : null);
    if (!tool() && n) {
      const next = focusFromNode(n);
      if (next) setFocus(next);
    }
  }

  const draftIds = createMemo(() => [...draft().keys()]);
  const ghost = createMemo(() => {
    const t = tool();
    const p = place();
    return t ? ghostOf(t, p, scope()) : null;
  });
  const prompt = createMemo(() => {
    const t = tool();
    if (!t) return null;
    return previewOf(t, place(), scope());
  });
  const status = createMemo(() => {
    const fail = writeError() ?? world().error;
    if (fail) return fail;
    if (tool()) return "Type into the prompt, Tab between fields, Enter to commit. Escape cancels.";
    const ids = draftIds();
    if (ids.length > 0) return `Override ${ids.join(", ")} until the next build.`;
    return "Space inserts. Click to inspect (select is scope). Drag handles write literals.";
  });

  return (
    <div class={styles.workspace}>
      <div class={styles.wrap}>
        <p class={[styles.status, { [styles.statusError]: !!(writeError() ?? world().error) }]}>{status()}</p>
        <Euclid2View
          trace={world().trace}
          initialCamera={props.scene.camera}
          placing={tool() != null}
          ghost={ghost()}
          place={place()}
          toolSession={tool()}
          hoverId={hoverId()}
          selectedKey={selectedKey()}
          scope={scope()}
          onHoverId={setHoverId}
          onPick={onPick}
          onDraft={mergeDraft}
          onCommit={(id, values) => void commit(id, values)}
          onPlace={onPlace}
          onCursor={setPlace}
        />
        <Palette
          picker={picker()}
          prompt={prompt()}
          onPick={(id: ToolId) => {
            setPicker(false);
            setPlace(null);
            setWriteError(null);
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
