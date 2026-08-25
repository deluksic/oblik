import { createEffect, createMemo, createSignal, onSettled } from "solid-js";

import { evaluate, type Draft } from "../eval/evaluate";
import type { Euclid2Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import { Euclid2View } from "./View";
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
import styles from "./Pane.module.css";

export type Euclid2PaneProps = {
  scene: Euclid2Scene;
  file: string;
  annotations: Record<string, Annotation>;
};

export function Euclid2Pane(props: Euclid2PaneProps) {
  const [draft, setDraft] = createSignal<Draft>(new Map());
  const [picker, setPicker] = createSignal(false);
  const [tool, setTool] = createSignal<ToolSession | null>(null);
  const [cursor, setCursor] = createSignal<{ x: number; y: number } | null>(null);

  createEffect(
    () => props.scene,
    () => {
      setDraft(new Map());
      setTool(null);
      setCursor(null);
      setPicker(false);
    },
  );

  const world = createMemo(() =>
    evaluate(props.scene, { draft: draft(), annotations: props.annotations, module: props.file }),
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

  onSettled(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        e.preventDefault();
        if (picker()) setPicker(false);
        else if (tool()) setTool(null);
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
  });

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
    return "Space inserts. Drag handles write literals.";
  });

  return (
    <div class={styles.wrap}>
      <p class={styles.status}>{status()}</p>
      <Euclid2View
        trace={world().trace}
        initialCamera={props.scene.camera}
        placing={tool() != null}
        ghost={ghost()}
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
  );
}
