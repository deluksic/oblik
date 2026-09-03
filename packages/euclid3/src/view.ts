import { dist3, projectT3, type Drawable3, type Geom3, type Vec3 } from "@design-scenes/geom";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { Gizmo3 } from "./widgets";


const { PI, abs, cos, max, min, sin } = Math;
const COL = {
  bg: 0x12141c,
  geom: 0xd7d2c4,
  hover: 0xf0c14a,
  selected: 0x7ec8e3,
  gizmo: 0xe8876a,
  gizmoHot: 0xfff3e6,
  stock: 0x6a7388,
  cut: 0x1c1f28,
  pocket: 0x3a4254,
};

export type Hit3 = { target: "gizmo"; gizmo: Gizmo3 } | { target: "geom"; geom: Geom3 };

/** Overlay rest ink. Hover / select still win on color. */
export type RestInk = {
  color?: number;
  pointScale?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
};

export type InkLookup3 = (id: string) => RestInk | undefined;

export class SpaceView {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly raycaster = new THREE.Raycaster();

  private content = new THREE.Group();
  private gizmos = new THREE.Group();
  private geomById = new Map<string, Geom3>();
  private anim = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setClearColor(COL.bg, 1);
    this.renderer.setPixelRatio(min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(14, -16, 11);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 1);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.scene.add(new THREE.HemisphereLight(0xc8d4e8, 0x1a1c24, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(8, -12, 18);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88a0c0, 0.35);
    fill.position.set(-10, 6, 4);
    this.scene.add(fill);

    const grid = new THREE.GridHelper(24, 24, 0x3a4156, 0x1d2230);
    grid.rotation.x = PI / 2;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(2.2);
    this.scene.add(axes);

    this.scene.add(this.content);
    this.scene.add(this.gizmos);

    this.raycaster.params.Line = { threshold: 0.12 };
    this.resize();
    this.loop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.anim);
    this.anim = 0;
    this.controls.dispose();
    this.clearGroup(this.content);
    this.clearGroup(this.gizmos);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const w = max(1, r.width);
    const h = max(1, r.height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.disposed) return;
    this.anim = requestAnimationFrame(this.loop);
  };

  sync(
    drawables: readonly Drawable3[],
    gizmos: readonly Gizmo3[],
    hoverId: string | null,
    selectedId: string | null,
    hoverGizmoSite: string | null,
    selectedGizmoId: string | null,
    inkOf?: InkLookup3,
  ): void {
    this.clearGroup(this.content);
    this.clearGroup(this.gizmos);
    this.geomById.clear();

    for (const d of drawables) {
      const g = d.geom;
      this.geomById.set(g.id, g);
      const rest = inkOf?.(g.id);
      const color = g.id === selectedId ? COL.selected : g.id === hoverId ? COL.hover : (rest?.color ?? COL.geom);
      const obj = meshFor(g, color, g.id === selectedId || g.id === hoverId, rest);
      obj.userData.geomId = g.id;
      this.content.add(obj);
    }

    for (const gizmo of gizmos) {
      const obj = meshGizmo(gizmo, gizmoEmphasis(gizmo, hoverGizmoSite, selectedGizmoId), inkOf?.(gizmo.id));
      obj.userData.gizmo = gizmo;
      this.gizmos.add(obj);
    }
  }

  hitTest(clientX: number, clientY: number): Hit3 | null {
    const ndc = this.ndc(clientX, clientY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const giz = this.raycaster.intersectObject(this.gizmos, true);
    for (const hit of giz) {
      const g = findUserData(hit.object, "gizmo");
      if (g && typeof g === "object" && "kind" in (g as object)) {
        return { target: "gizmo", gizmo: g as Gizmo3 };
      }
    }
    const geoms = this.raycaster.intersectObject(this.content, true);
    for (const hit of geoms) {
      const id = findUserData(hit.object, "geomId");
      if (typeof id === "string") {
        const g = this.geomById.get(id);
        if (g) return { target: "geom", geom: g };
      }
    }
    return null;
  }

  dragPoint(g: { x: number; y: number; z: number }, clientX: number, clientY: number): Vec3 | null {
    const plane = cameraPlane(this.camera, g);
    const hit = this.intersectPlane(plane, clientX, clientY);
    return hit;
  }

  dragDistance(origin: Vec3, clientX: number, clientY: number): number | null {
    const plane = cameraPlane(this.camera, origin);
    const hit = this.intersectPlane(plane, clientX, clientY);
    if (!hit) return null;
    return max(0.05, dist3(origin, hit));
  }

  dragGlider(a: Vec3, b: Vec3, clientX: number, clientY: number): number | null {
    const mid = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
    };
    const plane = cameraPlane(this.camera, mid);
    const hit = this.intersectPlane(plane, clientX, clientY);
    if (!hit) return null;
    return min(1, max(0, projectT3(a, b, hit)));
  }

  private intersectPlane(plane: THREE.Plane, clientX: number, clientY: number): Vec3 | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(plane, p);
    if (!ok) return null;
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

function meshFor(g: Geom3, color: number, highlight: boolean, rest?: RestInk): THREE.Object3D {
  const group = new THREE.Group();
  const dashed = rest?.dashed === true;
  const edgeMat = dashed
    ? new THREE.LineDashedMaterial({
        color,
        dashSize: rest?.dashSize ?? 0.14,
        gapSize: rest?.gapSize ?? 0.1,
      })
    : new THREE.LineBasicMaterial({
        color,
        linewidth: highlight ? 2 : 1,
      });

  const stroke = (obj: THREE.Line | THREE.LineLoop | THREE.LineSegments) => {
    if (dashed) obj.computeLineDistances();
    group.add(obj);
  };

  if (g.kind === "box3") {
    const sx = abs(g.max.x - g.min.x);
    const sy = abs(g.max.y - g.min.y);
    const sz = abs(g.max.z - g.min.z);
    const cx = (g.min.x + g.max.x) / 2;
    const cy = (g.min.y + g.max.y) / 2;
    const cz = (g.min.z + g.max.z) / 2;
    const box = new THREE.BoxGeometry(max(sx, 0.02), max(sy, 0.02), max(sz, 0.02));
    const fill = new THREE.MeshLambertMaterial({
      color: COL.stock,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(box, fill);
    mesh.position.set(cx, cy, cz);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), edgeMat);
    edges.position.copy(mesh.position);
    group.add(mesh);
    stroke(edges);
  } else if (g.kind === "cylinder3") {
    const axis = new THREE.Vector3(
      g.top.x - g.bottom.x,
      g.top.y - g.bottom.y,
      g.top.z - g.bottom.z,
    );
    const h = axis.length();
    const cyl = new THREE.CylinderGeometry(
      abs(g.radius),
      abs(g.radius),
      max(h, 0.02),
      28,
      1,
      true,
    );
    const fill = new THREE.MeshLambertMaterial({
      color: COL.cut,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(cyl, fill);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    mesh.position.set(
      (g.bottom.x + g.top.x) / 2,
      (g.bottom.y + g.top.y) / 2,
      (g.bottom.z + g.top.z) / 2,
    );
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cyl, 30), edgeMat);
    edges.quaternion.copy(mesh.quaternion);
    edges.position.copy(mesh.position);
    group.add(mesh);
    stroke(edges);
  } else if (g.kind === "segment3") {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(g.a.x, g.a.y, g.a.z),
      new THREE.Vector3(g.b.x, g.b.y, g.b.z),
    ]);
    stroke(new THREE.Line(geo, edgeMat));
  } else if (g.kind === "circle3") {
    const pts: THREE.Vector3[] = [];
    const n = 48;
    const normal = new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z).normalize();
    const tmp = abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(normal, tmp).normalize();
    const y = new THREE.Vector3().crossVectors(normal, x).normalize();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * PI * 2;
      pts.push(
        new THREE.Vector3(
          g.center.x + (x.x * cos(a) + y.x * sin(a)) * g.radius,
          g.center.y + (x.y * cos(a) + y.y * sin(a)) * g.radius,
          g.center.z + (x.z * cos(a) + y.z * sin(a)) * g.radius,
        ),
      );
    }
    stroke(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  } else if (g.kind === "mesh3") {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(g.positions, 3));
    geo.setIndex(g.indices);
    geo.computeVertexNormals();
    const fill = new THREE.MeshLambertMaterial({
      color: highlight ? color : COL.geom,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(geo, fill));
  } else {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.08 * (rest?.pointScale ?? 1), 12, 10),
      new THREE.MeshLambertMaterial({ color }),
    );
    s.position.set(g.x, g.y, g.z);
    group.add(s);
  }

  group.userData.geomId = g.id;
  return group;
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

function meshGizmo(g: Gizmo3, emphasis: "selected" | "hover" | null, rest?: RestInk): THREE.Object3D {
  const group = new THREE.Group();
  const color =
    emphasis === "selected"
      ? COL.selected
      : emphasis === "hover"
        ? COL.gizmoHot
        : (rest?.color ?? COL.gizmo);
  const hot = emphasis != null;
  const r = (hot ? 0.16 : 0.13) * (rest?.pointScale ?? 1);
  const mat = new THREE.MeshLambertMaterial({ color });
  if (g.kind === "point3") {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    s.position.set(g.x, g.y, g.z);
    group.add(s);
  } else if (g.kind === "glider3") {
    const p = {
      x: g.a.x + (g.b.x - g.a.x) * g.t,
      y: g.a.y + (g.b.y - g.a.y) * g.t,
      z: g.a.z + (g.b.z - g.a.z) * g.t,
    };
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
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
          color: rest?.color ?? COL.gizmo,
          transparent: true,
          opacity: 0.45,
        }),
      ),
    );
  } else {
    const loops = unitCircles(g.origin, abs(g.d), color);
    group.add(...loops);
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
      const a = (i / 48) * PI * 2;
      pts.push(
        new THREE.Vector3(
          origin.x + (u.x * cos(a) + v.x * sin(a)) * r,
          origin.y + (u.y * cos(a) + v.y * sin(a)) * r,
          origin.z + (u.z * cos(a) + v.z * sin(a)) * r,
        ),
      );
    }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
    line.computeLineDistances();
    return line;
  });
}
