import { Errored, createMemo, createSignal } from "solid-js";
import { render } from "@solidjs/web";

import { evaluate } from "../eval/evaluate";
import type { Scene } from "../eval/scene";
import { Euclid2Pane } from "../euclid2/Pane";
import type { Annotation } from "../source/analyze";
import styles from "./Host.module.css";

export type OblikMount = {
  setScene: (scene: Scene) => void;
  setAnnotations: (annotations: Record<string, Annotation>) => void;
};

export type OblikMountOpts = {
  el: HTMLElement;
  scene: Scene;
  file: string;
  annotations: Record<string, Annotation>;
};

export function mountOblik(opts: OblikMountOpts): OblikMount {
  const slots: { current: OblikMount | null } = { current: null };
  render(() => <Host opts={opts} slots={slots} />, opts.el);
  return {
    setScene: (scene) => slots.current?.setScene(scene),
    setAnnotations: (annotations) => slots.current?.setAnnotations(annotations),
  };
}

function Host(props: { opts: OblikMountOpts; slots: { current: OblikMount | null } }) {
  const file = props.opts.file;
  const [mod, setMod] = createSignal(props.opts.scene);
  const [anno, setAnno] = createSignal(props.opts.annotations);

  props.slots.current = {
    setScene(next) {
      evaluate(next, { module: file });
      setMod(next);
    },
    setAnnotations: setAnno,
  };

  const pane = createMemo(() => {
    const scene = mod();
    return scene.kind === "euclid2" ? (
      <Euclid2Pane scene={scene} file={file} annotations={anno()} />
    ) : (
      <p class={styles.err}>Unknown scene kind</p>
    );
  });

  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <p class={styles.kicker}>oblik</p>
        <h1>{mod().title}</h1>
        <p>{mod().hint}</p>
      </header>
      <div class={styles.stage}>
        <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>{pane()}</Errored>
      </div>
    </div>
  );
}
