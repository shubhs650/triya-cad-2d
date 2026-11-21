// The ribbon's custom CAD glyphs (M7-02, UI_SPEC.md §2, .claude/rules/ui.md): drawn by Triya for
// the commands Fluent has no icon for (arcs, splines, trims, dimensions…), on Fluent's 20 × 20
// grid with its 1 px line weight (strokes on half pixels so they land crisp at 20 px) and round
// ends. `d` is stroked, never filled; `dots` are the 2.5 px vertex dots AutoCAD's glyphs show at
// picked points.

export interface CadGlyph {
  readonly d: string;
  readonly dots?: readonly (readonly [number, number])[];
}

/** A revision-cloud outline: bulging arcs of about `step` along a clockwise polygon's edges. */
function cloud(points: readonly (readonly [number, number])[], step = 3): string {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    const dx = (x1 - x0) / n;
    const dy = (y1 - y0) / n;
    const r = +(Math.hypot(dx, dy) * 0.6).toFixed(2);
    for (let k = 0; k < n; k++) d += `a${r} ${r} 0 0 1 ${+dx.toFixed(2)} ${+dy.toFixed(2)}`;
  }
  return d;
}

/** A `cols` × `rows` grid of 3 px squares from (x, y), `gap` apart. */
function squares(x: number, y: number, cols: number, rows: number, gap: number): string {
  let d = '';
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) d += `M${x + c * gap} ${y + r * gap}h3v3h-3z`;
  return d;
}

const CIRCLE = 'M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13';
const ELLIPSE = 'M2.5 10a7.5 4.5 0 1 0 15 0 7.5 4.5 0 1 0-15 0';
const LAYER = 'M10 4.5l6.5 3-6.5 3-6.5-3z';

export const CAD_GLYPHS = {
  // Draw
  polyline: {
    d: 'M2.5 15.5 7 6.5l5 7 5.5-9',
    dots: [
      [7, 6.5],
      [12, 13.5],
    ],
  },
  arc: {
    d: 'M3.5 14.5a6.5 6.5 0 0 1 13 0',
    dots: [
      [3.5, 14.5],
      [10, 8],
      [16.5, 14.5],
    ],
  },
  'arc-cse': {
    d: 'M3.5 14.5a6.5 6.5 0 0 1 13 0',
    dots: [
      [10, 14.5],
      [3.5, 14.5],
      [16.5, 14.5],
    ],
  },
  'circle-cr': { d: `${CIRCLE}M10 10h6.5`, dots: [[10, 10]] },
  'circle-2p': {
    d: `${CIRCLE}M3.5 10h13`,
    dots: [
      [3.5, 10],
      [16.5, 10],
    ],
  },
  'circle-3p': {
    d: CIRCLE,
    dots: [
      [10, 3.5],
      [4.4, 13.25],
      [15.6, 13.25],
    ],
  },
  'circle-ttr': { d: 'M2.5 2.5v15h15M8.5 5.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12' },
  'ellipse-axis': {
    d: `${ELLIPSE}M2.5 10h15`,
    dots: [
      [2.5, 10],
      [17.5, 10],
    ],
  },
  'ellipse-center': { d: ELLIPSE, dots: [[10, 10]] },
  'ellipse-arc': {
    d: 'M2.5 11.5a7.5 4.5 0 0 1 15 0',
    dots: [
      [2.5, 11.5],
      [17.5, 11.5],
    ],
  },
  hatch: { d: 'M3.5 3.5h13v13h-13zM3.5 9.5l6-6M3.5 15.5l12-12M9.5 16.5l7-7' },
  gradient: { d: 'M3.5 3.5h13v13h-13zM6.5 3.5v13M9 3.5v13M11 3.5v13M12.5 3.5v13M13.5 3.5v13' },
  'spline-fit': {
    d: 'M2.5 14.5c2.5-8 5-8 7.5-4.5s5 3.5 7.5-5',
    dots: [
      [2.5, 14.5],
      [10, 10],
      [17.5, 5],
    ],
  },
  'spline-cv': {
    d: 'M2.5 15.5c2.5-8 5-8 7.5-4.5s5 3.5 7.5-5M2.5 15.5 6 4.5l8 11 3.5-10.5',
    dots: [
      [6, 4.5],
      [14, 15.5],
    ],
  },
  xline: { d: 'M2.5 17.5l15-15M14.5 2.5h3v3M2.5 14.5v3h3', dots: [[10, 10]] },
  ray: { d: 'M3.5 16.5l14-14M14.5 2.5h3v3', dots: [[3.5, 16.5]] },
  point: { d: 'M10 3.5v13M3.5 10h13M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6' },
  divide: { d: 'M2.5 10.5h15M2.5 8v5M7.5 8.5v4M12.5 8.5v4M17.5 8v5' },
  measure: { d: 'M2.5 12.5h15M2.5 10v5M6.5 11v3M10.5 11v3M14.5 11v3M2.5 6.5h5M6 5l1.5 1.5L6 8' },
  'revcloud-rect': {
    d: cloud([
      [3.5, 5.5],
      [16.5, 5.5],
      [16.5, 14.5],
      [3.5, 14.5],
    ]),
  },
  'revcloud-poly': {
    d: cloud([
      [10, 3.5],
      [17, 15.5],
      [3, 15.5],
    ]),
  },
  'revcloud-free': {
    d: cloud([
      [4, 6],
      [12, 3.5],
      [17, 9],
      [13, 16],
      [5, 14.5],
    ]),
  },
  'revcloud-object': {
    d: `${cloud(
      [
        [6.5, 3.5],
        [13.5, 3.5],
        [17, 10],
        [13.5, 16.5],
        [6.5, 16.5],
        [3, 10],
      ],
      2.5,
    )}`,
    dots: [[10, 10]],
  },
  wipeout: { d: 'M4.5 5.5h11v9h-11zM1.5 8h3M15.5 8h3M1.5 12h3M15.5 12h3' },
  // Modify
  stretch: {
    d: 'M2.5 5.5h7v9h-7zM9.5 10h8M15.5 8l2 2-2 2',
    dots: [[9.5, 10]],
  },
  trim: { d: 'M10.5 2.5v15M2.5 10.5h8M13 10.5h1.5M16.5 10.5h1' },
  extend: { d: 'M16.5 2.5v15M2.5 10.5h6M10.5 10.5h4M12.5 8.5l2 2-2 2' },
  fillet: { d: 'M4.5 2.5v7a7 7 0 0 0 7 7h6' },
  chamfer: { d: 'M4.5 2.5v9l5 5h8' },
  'array-rect': { d: squares(3.5, 3.5, 3, 3, 5) },
  'array-polar': {
    d: 'M8.5 2.5h3v3h-3zM14.5 8.5h3v3h-3zM8.5 14.5h3v3h-3zM2.5 8.5h3v3h-3z',
    dots: [[10, 10]],
  },
  'array-path': { d: 'M2.5 17.5c2-9 9-14 15-15M3.5 12.5h3v3h-3zM7.5 6.5h3v3h-3zM13.5 3.5h3v3h-3z' },
  offset: { d: 'M3.5 17.5c0-8 4-14 14-14M7.5 17.5c0-6 3-10 10-10' },
  explode: {
    d: 'M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4M10 7v1.5M10 11.5V13M7 10h1.5M11.5 10H13',
  },
  break: {
    d: 'M2.5 10.5h5M12.5 10.5h5',
    dots: [
      [7.5, 10.5],
      [12.5, 10.5],
    ],
  },
  'break-at-point': { d: 'M2.5 10.5h15M10 6.5v2M10 12.5v2', dots: [[10, 10.5]] },
  join: {
    d: 'M2.5 14.5l6.5-6M11 8.5l6.5 6',
    dots: [
      [9, 8.5],
      [11, 8.5],
    ],
  },
  lengthen: { d: 'M2.5 14.5l8-8M12 5l3.5-3.5M12.5 1.5h3v3', dots: [[2.5, 14.5]] },
  align: { d: 'M2.5 13.5l4-6 4 6zM12.5 7.5h5v8h-5zM6.5 4.5h7M11.5 2.5l2 2-2 2' },
  overkill: { d: 'M2.5 6.5h15M2.5 9h15M11.5 12.5l5 5M16.5 12.5l-5 5' },
  // Annotation
  'dim-linear': { d: 'M3.5 4.5v12M16.5 4.5v12M3.5 8.5h13M5.5 6.5l-2 2 2 2M14.5 6.5l2 2-2 2' },
  'dim-aligned': {
    d: 'M4 16 1.5 13.5M16 4l-2.5-2.5M1.5 13.5l12-12M3.5 13.5h-2v-2M11.5 1.5h2v2',
    dots: [
      [4, 16],
      [16, 4],
    ],
  },
  'dim-angular': { d: 'M3.5 16.5h14M3.5 16.5l9-11M12.5 16.5a9 9 0 0 0-3.3-6.97' },
  'dim-arc': { d: 'M5.5 17.5a4.5 4.5 0 0 1 9 0M2.5 17.5a7.5 7.5 0 0 1 15 0M8 6.5a2 2 0 0 1 4 0' },
  'dim-radius': { d: `${CIRCLE}M10 10l4.6-4.6M12.1 5.4h2.5v2.5`, dots: [[10, 10]] },
  'dim-diameter': { d: `${CIRCLE}M5.4 14.6l9.2-9.2M12.1 5.4h2.5v2.5M5.4 12.1v2.5h2.5` },
  'dim-jogged': { d: `${CIRCLE}M10 10l2 2-1 1 4.5 4.5`, dots: [[10, 10]] },
  'dim-ordinate': { d: 'M3.5 2.5v15h14M3.5 12.5h4l2-3h8M13.5 6.5h4', dots: [[3.5, 12.5]] },
  mleader: { d: 'M3.5 16.5l7-7h7M3.5 13.5v3h3M12.5 6.5h5M12.5 4h5' },
  'mleader-add': { d: 'M3.5 16.5l7-7h7M3.5 13.5v3h3M14.5 2.5v6M11.5 5.5h6' },
  'mleader-remove': { d: 'M3.5 16.5l7-7h7M3.5 13.5v3h3M11.5 5.5h6' },
  centerline: { d: 'M3.5 4.5h13M3.5 15.5h13M1.5 10h4M7.5 10h1M10.5 10h4M16.5 10h2' },
  centermark: {
    d: 'M10 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3M9 10h2M10 9v2',
  },
  // Annotate > Dimensions, Leaders (M7-02 part 2)
  'dim-quick': { d: 'M2.5 4.5v12M9.5 8.5v8M16.5 6.5v10M2.5 13.5h14M13 2.5l-2 3h3l-2 3' },
  'dim-continue': { d: 'M2.5 5.5v11M10 5.5v11M17.5 5.5v11M2.5 9.5h15', dots: [[10, 9.5]] },
  'dim-baseline': { d: 'M2.5 3.5v13M10 9.5v7M17.5 9.5v7M2.5 7.5h7.5M2.5 11.5h15' },
  'dim-space': { d: 'M3.5 4.5v12M16.5 4.5v12M3.5 7.5h13M3.5 12.5h13M10 9l0 2M9 10l1-1 1 1' },
  'dim-break': { d: 'M3.5 4.5v12M16.5 4.5v12M3.5 8.5h4M12.5 8.5h4M8.5 12.5l3-8' },
  'dim-jogline': { d: 'M3.5 4.5v12M16.5 4.5v12M3.5 10.5h5l1.5-3 1 6 1.5-3h4.5' },
  'dim-inspect': {
    d: 'M3.5 4.5v12M16.5 4.5v12M3.5 8.5h13M7 12.5h6a1.5 1.5 0 0 1 0 3H7a1.5 1.5 0 0 1 0-3z',
  },
  'dim-oblique': { d: 'M4.5 16.5l3-12M14.5 16.5l3-12M5.5 9.5h10.5' },
  'dim-text-angle': { d: 'M3.5 4.5v12M16.5 4.5v12M3.5 12.5h13M7.5 9.5l5-4M10 4.5h2.5V7' },
  'dim-override': { d: 'M3.5 4.5v12M16.5 4.5v12M3.5 8.5h13M8 15.5l5.5-5.5 1.5 1.5-5.5 5.5H8z' },
  'mleader-align': { d: 'M2.5 9.5l5-5h4M2.5 17.5l5-5h4M14.5 2.5v15' },
  'mleader-collect': { d: 'M2.5 16.5l7-7h3M12.5 5.5h2v2h-2zM15.5 5.5h2v2h-2zM12.5 9.5h2v2h-2z' },
  // Text Editor (M7-02 part 5): an overlined T; a stacked fraction.
  'text-overline': { d: 'M4.5 3.5h11M6.5 6.5h7M10 6.5v10' },
  'text-stack': { d: 'M5.5 3.5v5M3.5 10.5h13M12.5 12.5h3l-3 4h3M14.5 3.5l-9 13' },
  // View, Tools (M7-02 part 2)
  'ucs-icon': { d: 'M4.5 3.5v13h12M2.5 5.5l2-2 2 2M14.5 14.5l2 2-2 2', dots: [[4.5, 16.5]] },
  ucs: { d: 'M4.5 3.5v13h12M2.5 5.5l2-2 2 2M14.5 14.5l2 2-2 2M7.5 13.5l6-6' },
  linetype: {
    d: 'M2.5 5.5h15M2.5 10h4M8.5 10h4M14.5 10h3M2.5 14.5h3M7.5 14.5h1M10.5 14.5h3M15.5 14.5h1',
  },
  lineweight: { d: 'M2.5 4.5h15M2.5 9h15M2.5 9.5h15M2.5 14h15M2.5 14.5h15M2.5 15h15' },
  // Layers, measuring
  'layer-isolate': { d: `${LAYER}M3.5 11.5l6.5 3 6.5-3`, dots: [[10, 7.5]] },
  area: { d: 'M3.5 6.5l6-3 7 4v6l-5 3.5-8-2.5zM6.5 9.5l3 2M8.5 7.5l5 3.5M10.5 14l3-2' },
  distance: {
    d: 'M3.5 15.5l13-11M3.5 11.5v4h4M12.5 4.5h4v4',
    dots: [
      [3.5, 15.5],
      [16.5, 4.5],
    ],
  },
} as const satisfies Record<string, CadGlyph>;

export type CadIconName = keyof typeof CAD_GLYPHS;
