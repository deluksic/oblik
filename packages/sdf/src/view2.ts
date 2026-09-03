import * as THREE from "three";

import { compileSdf2, sdf2MapSignature, type CompiledSdf2 } from "./compile2";
import { BLIT_FRAG, BLIT_VERT, SDF_VERT, sdf2FragSource } from "./shader";
import type { Sdf2 } from "./tree2";


const { floor, max } = Math;
export type Cam2 = { x: number; y: number; scale: number };

const COL = {
  bg: 0x12141c,
};

/** Field resolution as a fraction of CSS pixels. Overlay stays 1×. */
const FIELD_SCALE = 1;

export class Sdf2View {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;

  private wrap: HTMLDivElement;
  private rayScene = new THREE.Scene();
  private rayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private fieldTarget: THREE.WebGLRenderTarget;
  private blitScene = new THREE.Scene();
  private blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitQuad: THREE.Mesh;
  private cam: Cam2 = { x: 0, y: 0, scale: 100 };
  private lastSig = "";
  private compiled: CompiledSdf2 | null = null;
  private anim = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const parent = canvas.parentElement;
    this.wrap = document.createElement("div");
    this.wrap.style.cssText = "position:relative;width:100%;height:100%";
    parent?.insertBefore(this.wrap, canvas);
    this.wrap.appendChild(canvas);
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    this.wrap.appendChild(this.overlay);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(COL.bg, 1);
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), emptySdf2Material());
    this.quad.frustumCulled = false;
    this.rayScene.add(this.quad);

    this.fieldTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.blitQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: BLIT_VERT,
        fragmentShader: BLIT_FRAG,
        uniforms: { uField: { value: this.fieldTarget.texture } },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.blitQuad.frustumCulled = false;
    this.blitScene.add(this.blitQuad);

    this.resize();
    this.loop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.anim);
    this.anim = 0;
    this.fieldTarget.dispose();
    (this.blitQuad.material as THREE.Material).dispose();
    this.blitQuad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.quad.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    const parent = this.wrap.parentElement;
    if (parent) {
      parent.insertBefore(this.canvas, this.wrap);
      this.wrap.remove();
    }
  }

  setCamera(cam: Cam2): void {
    this.cam = cam;
  }

  setSdf(sdf: Sdf2): void {
    const compiled = compileSdf2(sdf);
    const sig = sdf2MapSignature(compiled);
    this.compiled = compiled;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      const prev = this.quad.material as THREE.ShaderMaterial;
      this.quad.material = makeSdf2Material(compiled);
      prev.dispose();
    }
    this.applyUniforms();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = max(1, r.width);
    const h = max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.fieldTarget.setSize(
      max(1, floor(w * FIELD_SCALE)),
      max(1, floor(h * FIELD_SCALE)),
    );
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.pushCamera();
    this.renderer.setRenderTarget(this.fieldTarget);
    this.renderer.render(this.rayScene, this.rayCam);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCam);
    if (this.disposed) return;
    this.anim = requestAnimationFrame(this.loop);
  };

  private applyUniforms(): void {
    const mat = this.quad.material as THREE.ShaderMaterial;
    if (!this.compiled) return;
    for (const u of this.compiled.uniforms) {
      const slot = mat.uniforms[u.name];
      if (!slot) continue;
      if (u.kind === "f") slot.value = u.value;
      else (slot.value as THREE.Vector2).set(u.value[0], u.value[1]);
    }
  }

  private pushCamera(): void {
    const mat = this.quad.material as THREE.ShaderMaterial;
    mat.uniforms.uCam.value.set(this.cam.x, this.cam.y, this.cam.scale);
    mat.uniforms.uRes.value.set(this.fieldTarget.width, this.fieldTarget.height);
  }
}

function emptySdf2Material(): THREE.ShaderMaterial {
  return makeSdf2Material({ expr: "1000.0", uniforms: [] });
}

function makeSdf2Material(compiled: CompiledSdf2): THREE.ShaderMaterial {
  const decls = compiled.uniforms
    .map((u) => (u.kind === "f" ? `uniform float ${u.name};` : `uniform vec2 ${u.name};`))
    .join("\n");
  const uniforms: Record<string, THREE.IUniform> = {
    uCam: { value: new THREE.Vector3() },
    uRes: { value: new THREE.Vector2(1, 1) },
  };
  for (const u of compiled.uniforms) {
    uniforms[u.name] =
      u.kind === "f"
        ? { value: u.value }
        : { value: new THREE.Vector2(u.value[0], u.value[1]) };
  }
  return new THREE.ShaderMaterial({
    vertexShader: SDF_VERT,
    fragmentShader: sdf2FragSource(decls, compiled.expr),
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
