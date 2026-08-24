import { createMemo, createSignal } from "solid-js";
import { render } from "@solidjs/web";

import { convergeDraft, evaluate, type Draft } from "oblik";
import { Euclid2View } from "oblik/euclid2";
import type { Camera2 } from "oblik";

import scene from "./scenes/shelf.ts";
import annotations from "virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts";

const FILE = "apps/demo/src/scenes/shelf.ts";

function App() {
  const [mod, setMod] = createSignal(scene);
  const [anno, setAnno] = createSignal(annotations);
  const [draft, setDraft] = createSignal<Draft>(new Map());
  const [camera, setCamera] = createSignal<Camera2>(scene.camera ?? { x: 0, y: 0, scale: 48 });

  if (import.meta.hot) {
    import.meta.hot.accept("./scenes/shelf.ts", (m) => {
      if (!m?.default) return;
      setMod(m.default);
      setCamera((c) => c);
    });
    import.meta.hot.accept("virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts", (m) => {
      if (!m?.default) return;
      setAnno(m.default);
      setDraft((d) => convergeDraft(d, m.default));
    });
  }

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
    await fetch("/__oblik-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: FILE, id, target: "literal", values }),
    });
  }

  return (
    <div class="shell">
      <header class="head">
        <p class="kicker">oblik</p>
        <h1>{mod().title}</h1>
        <p>{mod().hint}</p>
      </header>
      <Euclid2View
        trace={world().trace}
        annotations={anno()}
        camera={camera()}
        draft={draft()}
        onCamera={setCamera}
        onDraft={mergeDraft}
        onCommit={(id, values) => void commit(id, values)}
      />
    </div>
  );
}

render(() => <App />, document.getElementById("app")!);
