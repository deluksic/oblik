import type { CommandSpec } from "@/types";

export type { CommandSpec };

function matchScore(cmd: CommandSpec, q: string): number {
  const title = cmd.title.toLowerCase();
  const id = cmd.id.toLowerCase();
  if (title.startsWith(q) || id.startsWith(q)) return 4;
  if (title.includes(q) || id.includes(q)) return 2;
  // Short queries target command names; hints mention other tools ("line crossing", etc.).
  if (q.length >= 3 && cmd.hint.toLowerCase().includes(q)) return 1;
  return 0;
}

export function filterCommands(commands: readonly CommandSpec[], query: string): CommandSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  return commands
    .map((cmd) => ({ cmd, score: matchScore(cmd, q) }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (a, b) => b.score - a.score || a.cmd.title.localeCompare(b.cmd.title),
    )
    .map((entry) => entry.cmd);
}
