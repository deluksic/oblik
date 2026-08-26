import { createEffect, createMemo, createSignal, Loading } from "solid-js";

import { evaluate, type Draft } from "../eval/evaluate";
import type { TraceNode } from "../eval/context";
import type { Euclid2Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import { SelectionSidebar } from "../host/SelectionSidebar";
import { EMPTY_SELECTION_DETAIL, selectionDetailForNode } from "../host/selection-detail";
import { traceKey } from "./pick";
import { Palette } from "./Palette";
import {
  clickTool,
  ghostOf,
  keyTool,
  previewOf,
  scopeFromTrace,
  startTool,
  tabTool,
  typeTool,
  type PlaceHit,
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
};

export function Euclid2Pane(props: Euclid2PaneProps) {
  const [draft, setDraft] = createSignal<Draft>(() => (props.scene, new Map()));
  const [picker, setPicker] = createSignal(() => (props.scene, false));
  const [tool, setTool] = createSignal<ToolSession | null>(() => (props.scene, null));
  const [place, setPlace] = createSignal<PlaceHit | null>(() => (props.scene, null));
  const [hoverId, setHoverId] = createSignal<string | null>(() => (props.scene, null));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(() => (props.file, null));

  const world = createMemo(() =>
    evaluate(props.scene, { draft: draft(), annotations: props.annotations, module: props.file }),
  );
  const scope = createMemo(() => scopeFromTrace(world().trace));

  const selectedNode = createMemo(() => {
    const key = selectedKey();
    if (!key) return null;
    return world().trace.find((n) => traceKey(n) === key) ?? null;
  });

  const selectionDetail = createMemo(async () => {
    const node = selectedNode();
    if (!node) return EMPTY_SELECTION_DETAIL;
    return selectionDetailForNode(node);
  });

  function applyStep(next: ToolStep | undefined) {
    if (!next) return;
    if ("insert" in next) void insert(next.insert);
    else setTool(next.session);
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
          } else if (selectedKey()) setSelectedKey(null);
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
        const next = keyTool(session, {
          key: e.key,
          shift: e.shiftKey,
          ctrl: e.ctrlKey,
          meta: e.metaKey,
          alt: e.altKey,
        }, place(), scope());
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
      throw new Error(body?.error ?? `patch failed (${res.status})`);
    }
  }

  async function insert(job: { from: string; args: unknown; bind?: string }) {
    const res = await fetch("/__oblik-insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: props.file, ...job }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `insert failed (${res.status})`);
    }
    setTool(null);
    setPlace(null);
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
    setSelectedKey(hits[0] ? traceKey(hits[0]) : null);
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
    if (tool()) return "Type into the prompt, Tab between fields, Enter to commit. Escape cancels.";
    const ids = draftIds();
    if (ids.length > 0) return `Override ${ids.join(", ")} until the next build.`;
    return "Space inserts. Click to inspect. Drag handles write literals.";
  });

  return (
    <div class={styles.workspace}>
      <div class={styles.wrap}>
        <p class={styles.status}>{status()}</p>
        <Euclid2View
          trace={world().trace}
          initialCamera={props.scene.camera}
          placing={tool() != null}
          ghost={ghost()}
          place={place()}
          toolSession={tool()}
          hoverId={hoverId()}
          selectedKey={selectedKey()}
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
      <Loading fallback={<SelectionSidebar detail={EMPTY_SELECTION_DETAIL} />}>
        <SelectionSidebar detail={selectionDetail()} />
      </Loading>
    </div>
  );
}
