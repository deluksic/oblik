import type { Glider } from "./gliders";
import type { Vec2 } from "./vec";

export type Point = Vec2 & { kind: "point" };
export type Segment = { kind: "segment"; a: Vec2; b: Vec2 };
export type Line = { kind: "line"; origin: Vec2; direction: Vec2 };
export type Circle = { kind: "circle"; center: Vec2; radius: number };
export type ParallelLine = { kind: "parallelLine"; line: Line; distance: number };

export type Geom = Point | Segment | Line | Circle | ParallelLine | Glider;
export type LineLike = Segment | Line | ParallelLine;

export type Branch = 1 | -1;
