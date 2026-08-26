import type { Glider } from "./gliders";
import type { Vec2 } from "./vec";

export type Branch = 1 | -1;

export type Point = Vec2 & { kind: "point" };
export type Segment = { kind: "segment"; a: Vec2; b: Vec2 };
export type Line = { kind: "line"; origin: Vec2; direction: Vec2 };
export type Circle = { kind: "circle"; center: Vec2; radius: number };
export type ParallelLine = { kind: "parallelLine"; line: Line; distance: number };
export type LineLike = Segment | Line | ParallelLine;

export type Along = { kind: "along"; carrier: Circle; k: Branch };
/** Unmarked vertex witness. `at` is the sharp corner; `r` is the join radius. */
export type Fillet = { kind: "fillet"; at: Vec2; r: number };
export type ProfileEdge = {
  a: Vec2;
  b: Vec2;
  carrier: LineLike | Circle;
  k?: Branch;
};
export type Profile = { kind: "profile"; outer: ProfileEdge[] };

export type Geom = Point | Segment | Line | Circle | ParallelLine | Glider | Profile;
