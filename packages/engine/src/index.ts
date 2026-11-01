// @triya/engine: Document model, geometry, spatial index, undo, selection, commands.
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
export * from './model/index';
export type { Vec2, Vec3 } from './geom/types';
