// Plain value types shared by the document model and the geometry kernel (`engine/geom`).
// They are structural and immutable so entities can carry them without copying.

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
