// @triya/dims: Dimension geometry engine (all DIMVARs).
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
//
// `dimensionParts` draws a DIMENSION as AutoCAD would regenerate it (ARCHITECTURE.md §9): the
// lines, arcs, arrowheads, text and definition points its `*D` block holds. M2-10 part 1
// covers linear, aligned, radius, diameter and angular dimensions; ordinate, jogged radius and
// arc length dimensions, tolerances, limits and alternate units come later (ROADMAP M2-10).

export type { DimPart } from './geometry';
export { dimStyle, type DimStyle } from './style';
export { formatAngle, formatLinear, dimensionText, applyPost } from './format';
export { dimensionParts, generates } from './parts';
export * from './health';
