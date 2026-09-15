/**
 * Compile generated WGSL with a real WGSL compiler.
 *
 * `tgpu.resolve()` returning text proves nothing: a type error in the generated
 * shader — the classic being `f32 * i32` from `select(0, 1, …)` — only surfaces
 * at pipeline creation, in the browser, which is a round trip through a person
 * looking at a blank pane. Resolving is not validating, so this runs what
 * actually validates: the device's own `createShaderModule` +
 * `getCompilationInfo`, over the same text the pipelines are built from.
 *
 * It is a **textual** check — no rendering, no pixels, no browser — over the
 * node WebGPU bindings, which is the only reason it can run in the suite. A
 * machine with no adapter reports `undefined` and the callers skip, so the suite
 * stays honest rather than silently vacuous.
 */

export type WgslDiagnostic = { type: string; message: string };

let device: GPUDevice | undefined;
/** One probe per run: a machine with no adapter must be able to answer "none"
 * as many times as it is asked, without asking the system again. */
let probed = false;

/** One device for the whole run: adapter creation is expensive, and the shaders
 * are validated against each other, not against a fresh device each time. */
async function sharedDevice(): Promise<GPUDevice | undefined> {
  if (probed) return device;
  probed = true;
  try {
    const { create, globals } = await import("webgpu");
    Object.assign(globalThis, globals);
    const adapter = await create([]).requestAdapter();
    if (adapter) device = await adapter.requestDevice();
  } catch {
    device = undefined;
  }
  if (!device) {
    // eslint-disable-next-line no-console
    console.warn("wgsl validation: no WebGPU adapter, skipping the shader checks");
  }
  return device;
}

/**
 * Every message the compiler has about `code`. An empty array means it compiles.
 * `undefined` means this machine could not compile it at all — a skip, not a pass.
 */
export async function validateWgsl(code: string): Promise<WgslDiagnostic[] | undefined> {
  const gpu = await sharedDevice();
  if (!gpu) return undefined;
  const info = await gpu.createShaderModule({ code }).getCompilationInfo();
  return info.messages.map((message) => ({ type: message.type, message: message.message }));
}
