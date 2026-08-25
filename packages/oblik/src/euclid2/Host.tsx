import { Errored, createMemo, createSignal, onSettled } from "solid-js";
import { render } from "@solidjs/web";

import { evaluate, type Draft } from "../eval/evaluate";
import type { Euclid2Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import type { Camera2 } from "./camera";
import { Euclid2View } from "./View";
import { Palette } from "./Palette";
import { clickTool, ghostOf, previewOf, startTool, type PlaceHit, type ToolId, type ToolSession } from "./tool";
import styles from "./Host.module.css";

export type Euclid2Mount = {
  setScene: (scene: Euclid2Scene) => void;
  setAnnotations: (annotations: Record<string, Annotation>) => void;
};

export type Euclid2MountOpts = {
  el: HTMLElement;
  scene: Euclid2Scene;
  file: string;
  annotations: Record<string, Annotation>;
};

export function mountEuclid2(opts: Euclid2MountOpts): Euclid2Mount {
  const slots: { current: Euclid2Mount | null } = { current: null };
  render(() => <Host opts={opts} slots={slots} />, opts.el);
  return {
    setScene: (scene) => slots.current?.setScene(scene),
    setAnnotations: (annotations) => slots.current?.setAnnotations(annotations),
  };
}

function Host(props: { opts: Euclid2MountOpts; slots: { current: Euclid2Mount | null } }) {
  const file = props.opts.file;
  const [mod, setMod] = createSignal(props.opts.scene);
  const [anno, setAnno] = createSignal(props.opts.annotations);
  const [draft, setDraft] = createSignal<Draft>(new Map());
  const [camera, setCamera] = createSignal<Camera2>(props.opts.scene.camera ?? { x: 0, y: 0, scale: 48 });
  const [picker, setPicker] = createSignal(false);
  const [tool, setTool] = createSignal<ToolSession | null>(null);
  const [cursor, setCursor] = createSignal<{ x: number; y: number } | null>(null);

  props.slots.current = {
    setScene(next) {
      evaluate(next, { module: file });
      setMod(next);
      setDraft(() => new Map());
    },
    setAnnotations: setAnno,
  };

  const world = createMemo(() => evaluate(mod(), { draft: draft(), annotations: anno(), module: file }));

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
      body: JSON.stringify({ file, id, target: "literal", values }),
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
      body: JSON.stringify({ file, ...job }),
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

  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <p class={styles.kicker}>oblik</p>
        <h1>{mod().title}</h1>
        <p>{mod().hint}</p>
        <p class={styles.status}>
          {tool()
            ? "Space is placing. Escape cancels."
            : draftIds().length > 0
              ? `Override ${draftIds().join(", ")} until the next build.`
              : "Space inserts. Drag handles write literals."}
        </p>
      </header>
      <div class={styles.stage}>
        <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
          <Euclid2View
            trace={world().trace}
            camera={camera()}
            placing={tool() != null}
            ghost={ghost()}
            onCamera={setCamera}
            onDraft={mergeDraft}
            onCommit={(id, values) => void commit(id, values)}
            onPlace={onPlace}
            onCursor={setCursor}
          />
        </Errored>
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
    </div>
  );
}
