import { Errored, createMemo, createSignal, onSettled } from "solid-js";
import { render } from "@solidjs/web";

import { evaluate, type Annotation, type Camera2, type Draft, type Euclid2Scene } from "oblik";
import {
  Euclid2View,
  Palette,
  clickTool,
  ghostOf,
  previewOf,
  startTool,
  type PlaceHit,
  type ToolId,
  type ToolSession,
} from "oblik/euclid2";

import scene from "./scenes/shelf.ts";
import annotations from "virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts";

const FILE = "apps/demo/src/scenes/shelf.ts";

type Hot = {
  setMod: (m: Euclid2Scene) => void;
  setAnno: (a: Record<string, Annotation>) => void;
  setDraft: (fn: (d: Draft) => Draft) => void;
};

const hot: { current: Hot | null } = { current: null };

if (import.meta.hot) {
  import.meta.hot.accept("./scenes/shelf.ts", (m) => {
    const s = hot.current;
    if (!m?.default || !s) return;
    const next = m.default as Euclid2Scene;
    evaluate(next, { module: FILE });
    s.setMod(next);
    s.setDraft(() => new Map());
  });
  import.meta.hot.accept("virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts", (m) => {
    if (!m?.default || !hot.current) return;
    hot.current.setAnno(m.default);
  });
}

function App() {
  const [mod, setMod] = createSignal(scene);
  const [anno, setAnno] = createSignal(annotations);
  const [draft, setDraft] = createSignal<Draft>(new Map());
  const [camera, setCamera] = createSignal<Camera2>(scene.camera ?? { x: 0, y: 0, scale: 48 });
  const [picker, setPicker] = createSignal(false);
  const [tool, setTool] = createSignal<ToolSession | null>(null);
  const [cursor, setCursor] = createSignal<{ x: number; y: number } | null>(null);
  hot.current = { setMod, setAnno, setDraft };

  const world = createMemo(() =>
    evaluate(mod(), { draft: draft(), annotations: anno(), module: FILE }),
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
      body: JSON.stringify({ file: FILE, id, target: "literal", values }),
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
      body: JSON.stringify({ file: FILE, ...job }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `insert failed (${res.status})`);
    }
    setTool(null);
    setCursor(null);
  }

  function onPick(id: ToolId) {
    setPicker(false);
    setTool(startTool(id));
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
    <div class="shell">
      <header class="head">
        <p class="kicker">oblik</p>
        <h1>{mod().title}</h1>
        <p>{mod().hint}</p>
        <p class="status">
          {tool()
            ? "Space is placing. Escape cancels."
            : draftIds().length > 0
              ? `Override ${draftIds().join(", ")} until the next build.`
              : "Space inserts. Drag handles write literals."}
        </p>
      </header>
      <div class="stage">
        <Errored fallback={(err) => <p class="err">{String(err())}</p>}>
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
          onPick={onPick}
          onClosePicker={() => setPicker(false)}
        />
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("app")!);
