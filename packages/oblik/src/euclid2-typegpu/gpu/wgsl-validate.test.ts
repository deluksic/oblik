import { tgpu } from "typegpu";
import { describe, expect, test } from "vitest";

import { circleVertex } from "./pipelines/circles";
import { markVertexExplicit, markVertexHalo, markVertexPaint } from "./pipelines/disks";
import { fillFragment, haloFragment } from "./pipelines/fills";
import { imageFragment, imageVertex } from "./pipelines/images";
import { strokeVertexHalo, strokeVertexPaint } from "./pipelines/strokes";
import { validateWgsl } from "./wgslValidate";

/**
 * Every shader this layer generates, compiled by the device.
 *
 * `pipelines/wgsl.test.ts` checks structure: which names the generated code
 * reads, in which order. This checks the one thing structure cannot — that the
 * emitted WGSL is *valid WGSL* — because a type error here compiles, resolves,
 * and only fails at pipeline creation, in the browser, where a pane that draws
 * nothing is the whole error message. The canary below is what makes this file
 * worth more than a comment: it fails if the validator ever stops reporting.
 */

const SHADERS: readonly [string, string][] = [
  ["stroke paint band", tgpu.resolve([strokeVertexPaint])],
  ["stroke chrome band", tgpu.resolve([strokeVertexHalo])],
  ["mark paint band", tgpu.resolve([markVertexPaint])],
  ["mark chrome band", tgpu.resolve([markVertexHalo])],
  ["mark explicit dot", tgpu.resolve([markVertexExplicit])],
  ["circle", tgpu.resolve([circleVertex])],
  ["fill", tgpu.resolve([fillFragment])],
  ["fill halo", tgpu.resolve([haloFragment])],
  ["image", tgpu.resolve([imageVertex, imageFragment])],
];

/** A shader with a type error, and the exact kind this file exists for: the
 * mixed arithmetic `select(0, 1, …)` produces. */
const BROKEN = `
@vertex fn vs() -> @builtin(position) vec4f {
  let x: f32 = 1.0;
  let y: i32 = 2;
  return vec4f(x * y);
}
`;

describe("generated WGSL compiles", () => {
  test("a shader that does not compile is reported", async (ctx) => {
    const messages = await validateWgsl(BROKEN);
    if (messages === undefined) return ctx.skip();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.map((m) => m.type)).toContain("error");
  });

  for (const [name, code] of SHADERS) {
    test(`${name} compiles`, async (ctx) => {
      const messages = await validateWgsl(code);
      if (messages === undefined) return ctx.skip();
      expect(messages).toEqual([]);
    });
  }
});
