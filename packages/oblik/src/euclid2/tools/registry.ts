import { captureUserStack, isUserSourcePath, normalizeStackFile } from "#eval/stack";

import { compileComposite } from "./composite";
import type { BuiltinToolId, RegisteredTool, Tool, ToolArg, ToolDef, ToolSpec } from "./types";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const BUILTIN_IDS: readonly BuiltinToolId[] = [
  "point",
  "circle",
  "line",
  "segment",
  "parallelLine",
  "perpendicularLine",
  "tangent",
  "slider",
  "region",
  "roundOffset",
  "fillet",
];

/** Compiled composite tools by registered name. */
const tools = new Map<string, Tool>();
/** Registration records by registered name (spec + fn + module). */
const regs = new Map<string, RegisteredTool>();

function isOblikInternals(file: string): boolean {
  const key = normalizeStackFile(file);
  return (
    key.includes("packages/oblik") ||
    key.includes("/oblik/") ||
    key.includes("node_modules") ||
    key.startsWith("node:")
  );
}

/**
 * The module that called `defineTool`, as the browser served it (Vite root
 * pathname in dev: `/src/layout/tools.ts`) or an absolute path elsewhere.
 * Falls back to an explicit `def.module`.
 */
function callerModule(): string {
  for (const f of captureUserStack()) {
    if (!isUserSourcePath(f.file) || isOblikInternals(f.file)) continue;
    const clean = f.file.replace(/\?.*$/, "");
    if (/^https?:\/\//.test(clean)) {
      try {
        return new URL(clean).pathname;
      } catch {
        // keep the raw frame below
      }
    }
    return clean;
  }
  return "";
}

function argError(def: ToolDef, fnName: string | undefined): string | undefined {
  const name = (def.name?.trim() || fnName) ?? "";
  if (!IDENT.test(name)) {
    return "defineTool needs a name: name the function or pass def.name (identifiers only).";
  }
  if ((BUILTIN_IDS as readonly string[]).includes(name)) {
    return `"${name}" is a built-in tool id — pick a different name.`;
  }
  if (!IDENT.test(def.prefix)) {
    return `prefix "${def.prefix}" must be an identifier.`;
  }
  const labels = new Set<string>();
  for (const [i, a] of def.args.entries()) {
    if (labels.has(a.label)) return `duplicate arg label "${a.label}" in "${name}".`;
    labels.add(a.label);
    if (a.kind !== "length" || a.anchor === undefined) continue;
    const target = def.args.find((x) => x.label === a.anchor);
    if (!target) return `arg "${a.label}" anchors unknown arg "${a.anchor}".`;
    if (target.kind !== "point" && target.kind !== "region") {
      return `arg "${a.label}" anchors "${a.anchor}" but only point/region args can be anchors.`;
    }
    const targetIndex = def.args.indexOf(target);
    if (targetIndex >= i) return `arg "${a.label}" must anchor an earlier arg.`;
  }
  return undefined;
}

function toRegistered(fn: (...args: never[]) => unknown, def: ToolDef): RegisteredTool {
  const name = (def.name?.trim() || (fn as { name?: string }).name) ?? "";
  const argErr = argError(def, name);
  if (argErr) throw new Error(argErr);
  return {
    name,
    title: def.title,
    hint: def.hint ?? "",
    prefix: def.prefix,
    args: def.args,
    fn: fn as unknown as (...values: unknown[]) => unknown,
    module: def.module ?? callerModule(),
  };
}

/**
 * Register `fn` as a Space tool. Returns `fn` unchanged so the same binding can
 * be called from scene code. Re-registering a name overwrites (HMR-safe).
 */
export function defineTool<A extends readonly unknown[]>(
  fn: (...args: A) => unknown,
  def: ToolDef,
): (...args: A) => unknown {
  if (typeof fn !== "function") throw new Error("defineTool expects a function.");
  const reg = toRegistered(fn, def);
  if (!reg.module) {
    throw new Error(
      `defineTool for "${reg.name}" could not find its module — pass def.module explicitly.`,
    );
  }
  const prev = regs.get(reg.name);
  if (prev && prev.module !== reg.module) {
    // eslint-disable-next-line no-console
    console.warn(
      `defineTool: "${reg.name}" was already registered from ${prev.module}; ` +
        `the new registration from ${reg.module} wins.`,
    );
  }
  regs.set(reg.name, reg);
  tools.set(reg.name, compileComposite(reg) as Tool);
  return fn;
}

export function registeredToolById(id: string): Tool | undefined {
  return tools.get(id);
}

export function registeredTools(): readonly RegisteredTool[] {
  return [...regs.values()];
}

export function registeredSpecs(): ToolSpec[] {
  return registeredTools().map((r) => ({
    id: r.name,
    title: r.title,
    hint: r.hint,
    prefix: r.prefix,
  }));
}

type ArgOpts = { def?: number; anchor?: string; integer?: boolean };

export const arg = {
  point(label: string): ToolArg {
    return { kind: "point", label };
  },
  region(label: string): ToolArg {
    return { kind: "region", label };
  },
  segment(label: string): ToolArg {
    return { kind: "segment", label };
  },
  length(label: string, opts: ArgOpts = {}): ToolArg {
    return { kind: "length", label, def: opts.def, anchor: opts.anchor };
  },
  number(label: string, opts: ArgOpts = {}): ToolArg {
    return { kind: "number", label, def: opts.def, integer: opts.integer };
  },
};

export type { ToolDef, ToolArg };
