import type { CommandSpec } from "./types.ts";

export type { CommandSpec };

export function filterCommands(commands: readonly CommandSpec[], query: string): CommandSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  return commands.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  );
}
