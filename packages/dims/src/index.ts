// @triya/dims: Dimension geometry engine (all DIMVARs).
// Runs in Node and in a Web Worker: no DOM or browser globals (enforced by tsconfig `lib` and ESLint).
//
// `dimensionParts` draws a DIMENSION as AutoCAD would regenerate it (ARCHITECTURE.md §9): the
// lines, arcs, arrowheads, text and definition points its `*D` block holds. M2-10 part 1
// covers linear, aligned, radius, diameter and angular dimensions; part 2 ordinate, jogged
// radius and arc length dimensions, tolerances, limits, alternate units and DIMJUST 3/4.

export type { DimPart } from './geometry';
export { dimStyle, type DimStyle } from './style';
export { formatAngle, formatLinear, dimensionText, applyPost, linearText } from './format';
export { dimensionParts, generates } from './parts';
export * from './health';
