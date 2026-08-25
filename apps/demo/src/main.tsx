import { Errored, createMemo, createSignal } from "solid-js";
import { render } from "@solidjs/web";

import { evaluate, type Annotation, type Camera2, type Draft, type Euclid2Scene } from "oblik";
import { Euclid2View } from "oblik/euclid2";

import scene from "./scenes/shelf.ts";
import annotations from "virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts";

const FILE = "apps/demo/src/scenes/shelf.ts";

type Session = {
  setMod: (m: Euclid2Scene) => void;
  setAnno: (a: Record<string, Annotation>) => void;
  setDraft: (fn: (d: Draft) => Draft) => void;
};

const session: { current: Session | null } = { current: null };

if (import.meta.hot) {
  import.meta.hot.accept("./scenes/shelf.ts", (m) => {
    const s = session.current;
    if (!m?.default || !s) return;
    const next = m.default as Euclid2Scene;
    // Override stays unless this build actually produces a trace.
    evaluate(next, { module: FILE });
    s.setMod(next);
    s.setDraft(() => new Map());
  });
  import.meta.hot.accept("virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts", (m) => {
    if (!m?.default || !session.current) return;
    session.current.setAnno(m.default);
  });
}

function App() {
  const [mod, setMod] = createSignal(scene);
  const [anno, setAnno] = createSignal(annotations);
  const [draft, setDraft] = createSignal<Draft>(new Map());
  const [camera, setCamera] = createSignal<Camera2>(scene.camera ?? { x: 0, y: 0, scale: 48 });
  session.current = { setMod, setAnno, setDraft };

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

  const draftIds = createMemo(() => [...draft().keys()]);

  return (
    <div class="shell">
      <header class="head">
        <p class="kicker">oblik</p>
        <h1>{mod().title}</h1>
        <p>{mod().hint}</p>
        <p class="status">
          {draftIds().length > 0 ? `Override ${draftIds().join(", ")} until the next build.` : "View is the last build."}
        </p>
      </header>
      <div class="stage">
        <Errored fallback={(err) => <p class="err">{String(err())}</p>}>
          <Euclid2View
            trace={world().trace}
            camera={camera()}
            onCamera={setCamera}
            onDraft={mergeDraft}
            onCommit={(id, values) => void commit(id, values)}
          />
        </Errored>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("app")!);
