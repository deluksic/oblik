import { createSignal } from "solid-js";

import { createScene } from "./workspace/model";
import type { SceneEntry } from "@/types";

import styles from "./Welcome.module.css";

export type WelcomeProps = {
  onCreated: (id: string, entry: SceneEntry) => void | Promise<void>;
};

export function Welcome(props: WelcomeProps) {
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  return (
    <div class={styles.welcome}>
      <h2>Design programs, viewed in scenes</h2>
      <p class={styles.lead}>
        Drop a TypeScript file in <code>scenes/</code> and it shows up here. Or create one now — an
        empty 2D canvas, ready for Space commands.
      </p>
      <form
        class={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const input = form.elements.namedItem("id");
          const id = input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : "";
          if (!id) return;
          setError("");
          setBusy(true);
          void createScene(id)
            .then(({ id: created, entry }) => props.onCreated(created, entry))
            .catch((err) => {
              setError(err instanceof Error ? err.message : String(err));
              setBusy(false);
            });
        }}
      >
        <input
          name="id"
          type="text"
          required
          spellcheck={false}
          autocomplete="off"
          pattern="[a-z][a-z0-9-]*"
          placeholder="hello"
          aria-label="New scene id"
          class={styles.input}
        />
        <button type="submit" class={styles.button} disabled={busy()}>
          New scene
        </button>
        {error() ? <p class={styles.formError}>{error()}</p> : null}
      </form>
      <p class={styles.hint}>
        Id becomes the filename and the CSS grid area: <code>hello.scene.ts</code> →{" "}
        <code>grid-area: hello</code>.
      </p>
    </div>
  );
}
