import type { Vec3 } from "@design-scenes/geom";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { compileSdf, sdfMapSignature, type CompiledSdf } from "./compile";
import { BLIT_FRAG, BLIT_VERT, SDF_VERT, sdfFragSource } from "./shader";
import type { Sdf } from "./tree";

type Gizmo3 =
  | {
      kind: "point3";
      site: string;
      id: string;
      at: { line: number; column: number };
      x: number;
      y: number;
      z: number;
    }
  | {
      kind: "distance3";
      site: string;
      id: string;
      at: { line: number; column: number };
      origin: Vec3;
      d: number;
    }
  | {
      kind: "glider3";
      site: string;
      id: string;
      at: { line: number; column: number };
      a: Vec3;
      b: Vec3;
      t: number;
    };

const COL = {
  bg: 0x12141c,
  hover: 0xf0c14a,
  selected: 0x7ec8e3,
  gizmo: 0xe8876a,
  gizmoHot: 0xfff3e6,
};

/** Raymarch at this fraction of CSS pixels. Gizmos stay 1×. */
const FIELD_SCALE = 1;

export type HitSdf = { target: "gizmo"; gizmo: Gizmo3 };

export class SdfView {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly raycaster = new THREE.Raycaster();

  private rayScene = new THREE.Scene();
  private rayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private fieldTarget: THREE.WebGLRenderTarget;
  private blitScene = new THREE.Scene();
  private blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitQuad: THREE.Mesh;
  private world = new THREE.Scene();
  private gizmos = new THREE.Group();
  private invVP = new THREE.Matrix4();
  private lastSig = "";
  private compiled: CompiledSdf | null = null;
  private anim = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(COL.bg, 1);
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(14, -24, 16);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 1.5);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), emptySdfMaterial());
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

    const axes = new THREE.AxesHelper(1.6);
    this.world.add(axes);
    this.world.add(this.gizmos);
    this.world.add(new THREE.HemisphereLight(0xc8d4e8, 0x1a1c24, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(8, -12, 18);
    this.world.add(key);

    this.resize();
    this.loop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.anim);
    this.anim = 0;
    this.controls.dispose();
    this.clearGroup(this.gizmos);
    this.fieldTarget.dispose();
    (this.blitQuad.material as THREE.Material).dispose();
    this.blitQuad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.quad.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.fieldTarget.setSize(
      Math.max(1, Math.floor(w * FIELD_SCALE)),
      Math.max(1, Math.floor(h * FIELD_SCALE)),
    );
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.controls.update();
    this.pushCamera();
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.fieldTarget);
    this.renderer.render(this.rayScene, this.rayCam);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCam);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.world, this.camera);
    if (this.disposed) return;
    this.anim = requestAnimationFrame(this.loop);
  };

  setSdf(sdf: Sdf): void {
    const compiled = compileSdf(sdf);
    const sig = sdfMapSignature(compiled);
    this.compiled = compiled;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      const prev = this.quad.material as THREE.ShaderMaterial;
      this.quad.material = makeSdfMaterial(compiled);
      prev.dispose();
    }
    this.applyUniforms();
  }

  syncGizmos(
    gizmos: readonly Gizmo3[],
    hoverGizmoSite: string | null,
    selectedGizmoId: string | null,
  ): void {
    this.clearGroup(this.gizmos);
    for (const g of gizmos) {
      const obj = meshGizmo(g, gizmoEmphasis(g, hoverGizmoSite, selectedGizmoId));
      obj.userData.gizmo = g;
      this.gizmos.add(obj);
    }
  }

  hitTest(clientX: number, clientY: number): HitSdf | null {
    const ndc = this.ndc(clientX, clientY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const giz = this.raycaster.intersectObject(this.gizmos, true);
    for (const hit of giz) {
      const g = findUserData(hit.object, "gizmo");
      if (g && typeof g === "object" && "kind" in (g as object)) {
        return { target: "gizmo", gizmo: g as Gizmo3 };
      }
    }
    return null;
  }

  dragPoint(g: { x: number; y: number; z: number }, clientX: number, clientY: number): Vec3 | null {
    return this.intersectPlane(cameraPlane(this.camera, g), clientX, clientY);
  }

  dragDistance(origin: Vec3, clientX: number, clientY: number): number | null {
    const hit = this.intersectPlane(cameraPlane(this.camera, origin), clientX, clientY);
    if (!hit) return null;
    return Math.max(0.05, Math.hypot(hit.x - origin.x, hit.y - origin.y, hit.z - origin.z));
  }

  dragGlider(a: Vec3, b: Vec3, clientX: number, clientY: number): number | null {
    const mid = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
    };
    const hit = this.intersectPlane(cameraPlane(this.camera, mid), clientX, clientY);
    if (!hit) return null;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    if (l2 < 1e-12) return 0;
    const t = ((hit.x - a.x) * ab.x + (hit.y - a.y) * ab.y + (hit.z - a.z) * ab.z) / l2;
    return Math.min(1, Math.max(0, t));
  }

  private applyUniforms(): void {
    const mat = this.quad.material as THREE.ShaderMaterial;
    if (!this.compiled) return;
    for (const u of this.compiled.uniforms) {
      const slot = mat.uniforms[u.name];
      if (!slot) continue;
      if (u.kind === "f") slot.value = u.value;
      else if (u.kind === "v2") (slot.value as THREE.Vector2).set(u.value[0], u.value[1]);
      else (slot.value as THREE.Vector3).set(u.value[0], u.value[1], u.value[2]);
    }
  }

  private pushCamera(): void {
    const mat = this.quad.material as THREE.ShaderMaterial;
    this.camera.updateMatrixWorld();
    this.invVP.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.invVP.invert();
    mat.uniforms.uCamPos.value.copy(this.camera.position);
    mat.uniforms.uInvVP.value.copy(this.invVP);
    mat.uniforms.uRes.value.set(this.fieldTarget.width, this.fieldTarget.height);
  }

  private intersectPlane(plane: THREE.Plane, clientX: number, clientY: number): Vec3 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    return { x: p.x, y: p.y, z: p.z };
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private clearGroup(g: THREE.Group): void {
    while (g.children.length) {
      const c = g.children[0]!;
      g.remove(c);
      c.traverse((o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
    }
  }
}

function emptySdfMaterial(): THREE.ShaderMaterial {
  return makeSdfMaterial({ expr: "1000.0", map2: "1000.0", uniforms: [] });
}

function makeSdfMaterial(compiled: CompiledSdf): THREE.ShaderMaterial {
  const decls = compiled.uniforms
    .map((u) =>
      u.kind === "f"
        ? `uniform float ${u.name};`
        : u.kind === "v2"
          ? `uniform vec2 ${u.name};`
          : `uniform vec3 ${u.name};`,
    )
    .join("\n");
  const uniforms: Record<string, THREE.IUniform> = {
    uCamPos: { value: new THREE.Vector3() },
    uInvVP: { value: new THREE.Matrix4() },
    uRes: { value: new THREE.Vector2(1, 1) },
  };
  for (const u of compiled.uniforms) {
    uniforms[u.name] =
      u.kind === "f"
        ? { value: u.value }
        : u.kind === "v2"
          ? { value: new THREE.Vector2(u.value[0], u.value[1]) }
          : { value: new THREE.Vector3(u.value[0], u.value[1], u.value[2]) };
  }
  return new THREE.ShaderMaterial({
    vertexShader: SDF_VERT,
    fragmentShader: sdfFragSource(decls, compiled.expr, compiled.map2),
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

function cameraPlane(camera: THREE.Camera, through: Vec3): THREE.Plane {
  const n = new THREE.Vector3();
  camera.getWorldDirection(n);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(
    n,
    new THREE.Vector3(through.x, through.y, through.z),
  );
}

function findUserData(obj: THREE.Object3D, key: string): unknown {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o.userData[key] !== undefined) return o.userData[key];
    o = o.parent;
  }
  return undefined;
}

function gizmoEmphasis(
  g: { site: string; id: string },
  hoverSite: string | null,
  selectedId: string | null,
): "selected" | "hover" | null {
  if (g.id === selectedId) return "selected";
  if (hoverSite && g.site === hoverSite) return "hover";
  return null;
}

function meshGizmo(g: Gizmo3, emphasis: "selected" | "hover" | null): THREE.Object3D {
  const group = new THREE.Group();
  const color =
    emphasis === "selected" ? COL.selected : emphasis === "hover" ? COL.gizmoHot : COL.gizmo;
  const hot = emphasis != null;
  const mat = new THREE.MeshLambertMaterial({ color });
  if (g.kind === "point3") {
    const s = new THREE.Mesh(new THREE.SphereGeometry(hot ? 0.16 : 0.13, 16, 12), mat);
    s.position.set(g.x, g.y, g.z);
    group.add(s);
  } else if (g.kind === "glider3") {
    const p = {
      x: g.a.x + (g.b.x - g.a.x) * g.t,
      y: g.a.y + (g.b.y - g.a.y) * g.t,
      z: g.a.z + (g.b.z - g.a.z) * g.t,
    };
    const s = new THREE.Mesh(new THREE.SphereGeometry(hot ? 0.16 : 0.13, 16, 12), mat);
    s.position.set(p.x, p.y, p.z);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(g.a.x, g.a.y, g.a.z),
      new THREE.Vector3(g.b.x, g.b.y, g.b.z),
    ]);
    group.add(
      s,
      new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: COL.gizmo,
          transparent: true,
          opacity: 0.45,
        }),
      ),
    );
  } else {
    group.add(...unitCircles(g.origin, Math.abs(g.d), color));
  }
  group.userData.gizmo = g;
  return group;
}

function unitCircles(origin: Vec3, r: number, color: number): THREE.Object3D[] {
  const mat = new THREE.LineDashedMaterial({
    color,
    dashSize: 0.12,
    gapSize: 0.1,
  });
  const axes: [Vec3, Vec3][] = [
    [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
    [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
  ];
  return axes.map(([u, v]) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          origin.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r,
          origin.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r,
          origin.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r,
        ),
      );
    }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.computeLineDistances();
    return line;
  });
}
