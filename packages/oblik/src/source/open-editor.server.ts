import { spawn } from "node:child_process";

export const EDITOR_OPEN_DEFAULT = "code --goto {file}:{line}";

/**
 * Split an editor-open command template into argv, shlex-style (single/double
 * quoted tokens keep spaces), then substitute `{file}` and `{line}` per token.
 * Substituting per token — not on the template — keeps paths containing
 * spaces intact and stops a file path from contributing executable tokens.
 */
export function editorArgv(command: string, file: string, line: number): string[] {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const argv = tokens
    .map((t) => t.replace(/^"([^"]*)"$/, "$1").replace(/^'([^']*)'$/, "$1"))
    .map((t) => t.replaceAll("{file}", file).replaceAll("{line}", String(line)))
    .filter((t) => t !== "");
  if (argv.length === 0 || argv[0] === "") throw new Error("editor command is empty");
  return argv;
}

export function spawnEditor(
  argv: readonly string[],
  onSpawned: () => void,
  onError: (err: Error) => void,
): void {
  const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" });
  child.once("error", onError);
  child.once("spawn", () => {
    child.unref();
    onSpawned();
  });
}
