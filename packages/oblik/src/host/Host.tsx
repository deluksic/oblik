import { Errored, createSignal } from "solid-js";
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
  const [mod, setMod] = createSignal(opts.scene);
  const [anno, setAnno] = createSignal(opts.annotations);

  render(() => <Host file={opts.file} mod={mod()} anno={anno()} />, opts.el);

  return {
    setScene(next) {
      evaluate(next, { module: opts.file });
      setMod(next);
    },
    setAnnotations: setAnno,
  };
}

function Host(props: {
  file: string;
  mod: Scene;
  anno: Record<string, Annotation>;
}) {
  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <p class={styles.kicker}>oblik</p>
        <h1>{props.mod.title}</h1>
        <p>{props.mod.hint}</p>
      </header>
      <div class={styles.stage}>
        <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
          {props.mod.kind === "euclid2" ? (
            <Euclid2Pane scene={props.mod} file={props.file} annotations={props.anno} />
          ) : (
            <p class={styles.err}>Unknown scene kind</p>
          )}
        </Errored>
      </div>
    </div>
  );
}
