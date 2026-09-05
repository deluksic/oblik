import type { Plugin } from "vite";

const VIRTUAL_EXT = ".vanilla.css";

/**
 * vanilla-extract's own hot-update path invalidates the importer chain of a
 * changed `.css.ts`, which cascades to a full page reload and drops component
 * state. Class names hash from file path + export name, so the JS side never
 * needs to re-run when token values change: invalidate and return only the
 * file's virtual CSS modules. Returning them replaces Vite's update list, and
 * the CSS module self-accepts, so the style re-injects without remounting.
 *
 * Place this plugin after `vanillaExtractPlugin()` so its module list wins.
 */
export function oblikVanillaExtractHmr(): Plugin {
  return {
    name: "oblik:vanilla-extract-hmr",
    apply: "serve",
    hotUpdate({ file, server, timestamp }) {
      const fileId = file.split("?")[0].replace(/\\/g, "/");
      if (!fileId.endsWith(".css.ts")) return;
      const graph = server.environments.client.moduleGraph;
      const mods = [...(graph.getModulesByFile(`${fileId}${VIRTUAL_EXT}`) ?? [])];
      if (mods.length === 0) return;
      for (const mod of mods) graph.invalidateModule(mod, new Set(), timestamp, true);
      return mods;
    },
  };
}
