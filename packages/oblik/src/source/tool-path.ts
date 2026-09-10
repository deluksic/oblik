import path from "node:path";

/**
 * Map a registered tool's `module` reference (sent by the browser) to an
 * absolute path on disk. Accepts:
 * - a Vite-root URL pathname (`/src/layout/tools.ts`) — joined to `rootAbs`;
 * - Vite's `/@fs/<abs>` form;
 * - an absolute path (node/tests).
 */
export function toolModuleAbs(moduleRef: string, rootAbs: string): string {
  if (moduleRef.startsWith("/@fs")) {
    const rest = moduleRef.replace(/^\/@fs/, "");
    // Windows drive paths arrive as "/@fs/C:/x" — drop the extra leading slash.
    return /^\/[A-Za-z]:[\\/]/.test(rest) ? rest.slice(1) : rest;
  }
  // Windows drive paths are already absolute.
  if (/^[A-Za-z]:[\\/]/.test(moduleRef)) return moduleRef;
  // Everything else (a Vite-root pathname like `/src/x.ts` or a bare
  // relative module) lives under the serving root.
  return path.join(rootAbs, moduleRef);
}

/** Relative import specifier from the dest file to the tool file (no extension). Empty when identical. */
export function relativeModuleSpecifier(destAbs: string, toolAbs: string): string {
  const dest = path.resolve(destAbs);
  const tool = path.resolve(toolAbs);
  if (dest === tool) return "";
  const rel = path.relative(path.dirname(dest), tool).replace(/\\/g, "/");
  const bare = rel.replace(/\.(ts|tsx|js|mjs)$/, "");
  return bare.startsWith(".") ? bare : `./${bare}`;
}

/** One-stop mapping used by the `/__oblik-insert` handler. */
export function moduleRefToSpecifier(destAbs: string, moduleRef: string, rootAbs: string): string {
  return relativeModuleSpecifier(destAbs, toolModuleAbs(moduleRef, rootAbs));
}
