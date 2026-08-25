import { mountEuclid2 } from "oblik/euclid2";

import scene from "./scenes/shelf.ts";
import annotations from "virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts";

const FILE = "apps/demo/src/scenes/shelf.ts";

const host = mountEuclid2({
  el: document.getElementById("app")!,
  scene,
  file: FILE,
  annotations,
});

if (import.meta.hot) {
  import.meta.hot.accept("./scenes/shelf.ts", (m) => {
    if (m?.default) host.setScene(m.default);
  });
  import.meta.hot.accept("virtual:oblik-annotations?file=apps/demo/src/scenes/shelf.ts", (m) => {
    if (m?.default) host.setAnnotations(m.default);
  });
}
