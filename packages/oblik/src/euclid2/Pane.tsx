import { createEffect, createMemo, createSignal, Loading } from "solid-js";

import { evaluate, type Draft } from "../eval/evaluate";
import type { TraceNode } from "../eval/context";
import type { Euclid2Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import { Inspect } from "../host/Inspect";
import { EMPTY_INSPECT, inspectForNode } from "../host/inspect";
import { pickAmong, traceKey } from "./pick";
import { Palette } from "./Palette";
import {
  clickTool,
  ghostOf,
  previewOf,
  startTool,
  type PlaceHit,
  type ToolId,
  type ToolSession,
} from "./tool";
import { Euclid2View } from "./View";

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
  const [cursor, setCursor] = createSignal<{ x: number; y: number } | null>(
    () => (props.scene, null),
  );
  const [hoverId, setHoverId] = createSignal<string | null>(() => (props.scene, null));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(() => (props.scene, null));
  const peekCache = new Map<string, string>();

  const world = createMemo(() =>
    evaluate(props.scene, { draft: draft(), annotations: props.annotations, module: props.file }),
  );

  const selectedNode = createMemo(() => {
    const key = selectedKey();
    if (!key) return null;
    return world().trace.find((n) => traceKey(n) === key) ?? null;
  });

  const inspect = createMemo(async () => {
    const node = selectedNode();
    if (!node) return EMPTY_INSPECT;
    return inspectForNode(node, peekCache);
  });

  createEffect(
    () => 1,
    () => {
      const onKey = (e: KeyboardEvent) => {
        const typing =
          e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (e.key === "Escape") {
          e.preventDefault();
          if (picker()) setPicker(false);
          else if (tool()) setTool(null);
          else if (selectedKey()) setSelectedKey(null);
          return;
        }
        if (typing) return;
        if (e.code === "Space" && !tool()) {
          e.preventDefault();
          setPicker((p) => !p);
        }
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
    const res = await fetch("/__oblik-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: props.file, id, target: "literal", values }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `patch failed (${res.status})`);
    }
  }

  async function insert(job: { from: string; args: unknown }) {
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
    setCursor(null);
  }

  function onPlace(hit: PlaceHit) {
    const session = tool();
    if (!session) return;
    const next = clickTool(session, hit);
    if ("insert" in next) void insert(next.insert);
    else setTool(next.session);
  }

  function onPick(hits: TraceNode[]) {
    if (hits.length === 0) {
      setSelectedKey(null);
      return;
    }
    const next = pickAmong(hits, selectedKey());
    if (next) setSelectedKey(traceKey(next));
  }

  const draftIds = createMemo(() => [...draft().keys()]);
  const ghost = createMemo(() => {
    const t = tool();
    return t ? ghostOf(t, cursor()) : null;
  });
  const prompt = createMemo(() => {
    const t = tool();
    return t ? previewOf(t) : null;
  });
  const status = createMemo(() => {
    if (tool()) return "Space is placing. Escape cancels.";
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
          hoverId={hoverId()}
          selectedKey={selectedKey()}
          onHoverId={setHoverId}
          onPick={onPick}
          onDraft={mergeDraft}
          onCommit={(id, values) => void commit(id, values)}
          onPlace={onPlace}
          onCursor={setCursor}
        />
        <Palette
          picker={picker()}
          prompt={prompt()}
          onPick={(id: ToolId) => {
            setPicker(false);
            setTool(startTool(id));
          }}
          onClosePicker={() => setPicker(false)}
        />
      </div>
      <Loading fallback={<Inspect state={EMPTY_INSPECT} />}>
        <Inspect state={inspect()} />
      </Loading>
    </div>
  );
}
