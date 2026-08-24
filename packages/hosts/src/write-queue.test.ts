import { expect, test } from "vitest";

import { enqueueFileWrite, enqueueLatest, resetWriteQueue, writeSlot } from "./write-queue";

test("file writes run one after another", async () => {
  resetWriteQueue();
  const order: string[] = [];
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const a = enqueueFileWrite("scene.ts", async () => {
    order.push("a-start");
    await gateA;
    order.push("a-end");
    return "a";
  });
  const b = enqueueFileWrite("scene.ts", async () => {
    order.push("b");
    return "b";
  });
  await Promise.resolve();
  expect(order).toEqual(["a-start"]);
  releaseA();
  expect(await a).toBe("a");
  expect(await b).toBe("b");
  expect(order).toEqual(["a-start", "a-end", "b"]);
});

test("latest slot drops superseded payloads", async () => {
  resetWriteQueue();
  const posted: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const at = { file: "s.ts", line: 1, column: 1 };
  const slot = writeSlot(at, "style");
  const first = enqueueLatest(at.file, slot, 1, async (n) => {
    posted.push(n);
    await gate;
    return null;
  });
  const second = enqueueLatest(at.file, slot, 2, async (n) => {
    posted.push(n);
    return null;
  });
  const third = enqueueLatest(at.file, slot, 3, async (n) => {
    posted.push(n);
    return null;
  });
  await Promise.resolve();
  release();
  expect(await first).toBeNull();
  expect(await second).toBeNull();
  expect(await third).toBeNull();
  expect(posted).toEqual([3]);
});
