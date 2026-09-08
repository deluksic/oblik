export async function openInEditor(file: string, line: number): Promise<void> {
  const res = await fetch("/__oblik-open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, line }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(body?.error ?? `open failed (${res.status})`);
  }
}
