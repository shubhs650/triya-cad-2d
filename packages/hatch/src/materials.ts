// The bundled material and architectural patterns (M4-12): `assets/patterns/triya-materials.pat`.
//
// Each pattern is a motif: strokes and dots drawn once in every cell of a lattice of tiles
// (`width` across, rows `height` up, each row `shift` along from the one below). A .pat file
// cannot hold a closed shape, only families of parallel dashed lines, so each stroke becomes a
// family of its own: the line through the stroke, which meets the stroke's copies every
// `period` along it (the shortest lattice vector in its direction), dashed as the stroke and a
// gap, and repeated across the lattice by a second lattice vector that, with the first, spans
// it. That is how pattern authors draw pebbles and aggregate in the documented format
// ("Overview of Hatch Pattern Definitions", AutoCAD help); a stroke must run along a lattice
// direction for its line to repeat, which `motifLines` checks.
//
// The material symbols themselves are drafting conventions (ASME Y14.2 section lining for the
// metals and plastics; the architectural symbols for concrete, earth, gravel, sand, insulation,
// wood, glass, liquids and masonry). The standards draw them without dimensions, so the sizes
// here are Triya's, chosen to read at scale 1 in a millimetre drawing (the masonry modules are
// full size, as TRIYA_BRICK's). Nothing is derived from an Autodesk file.
//
// The asset is generated from these motifs: a test keeps it equal to `TRIYA_MATERIALS_PAT`, and
// `TRIYA_UPDATE_PATTERNS=1` rewrites it (packages/hatch/test/materials.test.ts).

import type { PatLine } from './pat';

type Stroke = readonly [x0: number, y0: number, x1: number, y1: number];
type Dot = readonly [x: number, y: number];

export interface Motif {
  readonly name: string;
  readonly description: string;
  /** What the pattern shows and where its geometry comes from: the file's comment, wrapped. */
  readonly comment: readonly string[];
  /** The lattice: a tile every `width` across; each row `height` up and `shift` along. */
  readonly tile: { readonly width: number; readonly height: number; readonly shift?: number };
  /** Strokes drawn in every tile; one as long as its line's repeat is a continuous line. */
  readonly strokes?: readonly Stroke[];
  readonly dots?: readonly Dot[];
}

/** The polygon through `points`, closed, as strokes, its corners scaled by `k` about (0, 0) and moved by (x, y). */
function ring(x: number, y: number, k: number, points: readonly Dot[]): Stroke[] {
  return points.map(([px, py], i) => {
    const [qx, qy] = points[(i + 1) % points.length]!;
    return [x + k * px, y + k * py, x + k * qx, y + k * qy] as const;
  });
}

export const MATERIAL_MOTIFS: readonly Motif[] = [
  {
    name: 'TRIYA_STEEL',
    description: 'Steel, pairs of 45 degree lines',
    comment: [
      'Steel (ASME Y14.2 section lining): 45 degree lines in pairs about 1 mm apart,',
      'the pairs 4.24 mm apart (a 6 mm square lattice).',
    ],
    tile: { width: 6, height: 6 },
    strokes: [
      [0, 0, 6, 6],
      [1.5, 0, 7.5, 6],
    ],
  },
  {
    name: 'TRIYA_BRONZE',
    description: 'Bronze, brass, copper: solid and dashed 45 degree lines',
    comment: [
      'Bronze, brass and copper (ASME Y14.2 section lining): 45 degree lines, every',
      'other one dashed (2.12 mm dashes and gaps), 2.12 mm apart.',
    ],
    tile: { width: 6, height: 6 },
    strokes: [
      [0, 0, 6, 6],
      [3, 0, 4.5, 1.5],
      [6, 3, 7.5, 4.5],
    ],
  },
  {
    name: 'TRIYA_PLASTIC',
    description: 'Plastic and rubber, 45 degree lines in threes',
    comment: [
      'Plastic, rubber and electrical insulation: 45 degree lines in groups of three',
      '0.71 mm apart, the groups 5.66 mm apart. Standards draw this symbol differently;',
      "Triya's groups of three read apart from steel's pairs.",
    ],
    tile: { width: 8, height: 8 },
    strokes: [
      [0, 0, 8, 8],
      [1, 0, 9, 8],
      [2, 0, 10, 8],
    ],
  },
  {
    name: 'TRIYA_CONCRETE',
    description: 'Concrete, aggregate and sand',
    comment: [
      'Concrete in section: small triangles of aggregate and dots of sand, scattered',
      'over a 12 mm tile. Reinforced concrete: add TRIYA_LINES45 over it.',
    ],
    tile: { width: 12, height: 12 },
    strokes: [
      ...ring(1.5, 2, 0.8, [
        [0, 0],
        [2, 1],
        [1, 2],
      ]),
      ...ring(7, 6.5, 0.7, [
        [0, 0],
        [2, 0],
        [1, 2],
      ]),
      ...ring(3.5, 8.5, 0.6, [
        [0, 0],
        [1, 2],
        [-1, 1],
      ]),
      ...ring(9.5, 1.5, 0.3, [
        [0, 0],
        [4, 2],
        [1, 4],
      ]),
      ...ring(9, 9, 0.3, [
        [0, 0],
        [4, 2],
        [1, 5],
      ]),
    ],
    dots: [
      [5, 4.5],
      [10.6, 4.4],
      [1.2, 6.2],
      [8.2, 11],
      [5.8, 10.8],
      [11, 7.6],
      [4.6, 1.2],
      [5.6, 6.8],
    ],
  },
  {
    name: 'TRIYA_BLOCK',
    description: 'Concrete block, running bond, 400 x 200 mm module',
    comment: [
      'Concrete masonry units in running bond on a 400 x 200 mm module (390 x 190 mm',
      'blocks, 10 mm joints): bed joints every course, head joints every 400 mm along',
      'a course, offset half a block on the next.',
    ],
    tile: { width: 400, height: 200, shift: 200 },
    strokes: [
      [0, 0, 400, 0],
      [0, 0, 0, 200],
    ],
  },
  {
    name: 'TRIYA_EARTH',
    description: 'Earth, groups of horizontal and vertical strokes',
    comment: [
      'Earth (ground) in section: groups of three 2.2 mm strokes 1 mm apart, horizontal',
      'and vertical by turns in a 3 mm checkerboard.',
    ],
    tile: { width: 6, height: 6 },
    strokes: [0.5, 1.5, 2.5].flatMap((d): Stroke[] => [
      [0.4, d, 2.6, d],
      [3.4, 3 + d, 5.6, 3 + d],
      [3 + d, 0.4, 3 + d, 2.6],
      [d, 3.4, d, 5.6],
    ]),
  },
  {
    name: 'TRIYA_GRAVEL',
    description: 'Gravel, rounded stones',
    comment: [
      'Gravel or hardcore: stones of five shapes, 1.2 to 3.6 mm across, over a 15 mm',
      'tile.',
    ],
    tile: { width: 15, height: 15 },
    strokes: [
      ...ring(1, 1, 0.8, [
        [1, 0],
        [3, 0],
        [4, 1],
        [4, 2],
        [2, 3],
        [1, 3],
        [0, 2],
        [0, 1],
      ]),
      ...ring(8, 2, 0.7, [
        [0, 0],
        [2, 0],
        [3, 2],
        [2, 3],
        [0, 3],
        [-1, 1],
      ]),
      ...ring(3, 8, 0.9, [
        [0, 1],
        [1, 0],
        [3, 1],
        [3, 3],
        [1, 3],
      ]),
      ...ring(10, 9, 0.8, [
        [0, 0],
        [3, 0],
        [3, 1],
        [2, 2],
        [0, 2],
      ]),
      ...ring(7, 12, 0.6, [
        [0, 1],
        [1, 0],
        [2, 1],
        [1, 2],
      ]),
    ],
  },
  {
    name: 'TRIYA_SAND',
    description: 'Sand, mortar or plaster, stippled dots',
    comment: ['Sand, mortar and plaster: ten dots scattered over a 6 mm tile.'],
    tile: { width: 6, height: 6 },
    dots: [
      [0.5, 0.7],
      [2.3, 1.4],
      [4.1, 0.4],
      [5.2, 2.1],
      [1.2, 2.9],
      [3.4, 3.1],
      [0.4, 4.6],
      [2.6, 5.2],
      [4.6, 4.3],
      [5.6, 5.5],
    ],
  },
  {
    name: 'TRIYA_INSULATION',
    description: 'Batt insulation, zigzag bands',
    comment: [
      'Batt (quilt) insulation: zigzag bands 6 mm deep with 4 mm teeth, rows 8 mm apart.',
      'Scale it so one band fills the insulation layer.',
    ],
    tile: { width: 4, height: 8 },
    strokes: [
      [0, 1, 2, 7],
      [2, 7, 4, 1],
    ],
  },
  {
    name: 'TRIYA_INSULATION_RIGID',
    description: 'Rigid insulation, crossed boards',
    comment: ['Rigid (board) insulation: 10 x 5 mm boxes, each crossed by its diagonals.'],
    tile: { width: 10, height: 5 },
    strokes: [
      [0, 0, 10, 0],
      [0, 0, 0, 5],
      [0, 0, 10, 5],
      [0, 5, 10, 0],
    ],
  },
  {
    name: 'TRIYA_WOOD',
    description: 'Wood along the grain, wavy lines',
    comment: [
      'Wood along the grain: gently waving lines 3 mm apart, each row out of step',
      'with the next. Across the grain (rings) a .pat file cannot draw.',
    ],
    tile: { width: 12, height: 6 },
    strokes: [
      [0, 0, 6, 0.75],
      [6, 0.75, 12, 0],
      [3, 3, 9, 4],
      [9, 4, 15, 3],
    ],
  },
  {
    name: 'TRIYA_GLASS',
    description: 'Glass, groups of three short 45 degree strokes',
    comment: ['Glass and glazing: three short 45 degree strokes in every 12 mm tile.'],
    tile: { width: 12, height: 12 },
    strokes: [
      [3, 3, 8, 8],
      [4.5, 3, 8, 6.5],
      [6, 3, 8, 5],
    ],
  },
  {
    name: 'TRIYA_LIQUID',
    description: 'Water and other liquids, horizontal dashes',
    comment: [
      'Water and other liquids: horizontal lines growing shorter downwards, 10, 6 and',
      '2 mm long, 1.5 mm apart, in 6 mm rows.',
    ],
    tile: { width: 12, height: 6 },
    strokes: [
      [0, 4, 10, 4],
      [2, 2.5, 8, 2.5],
      [4, 1, 6, 1],
    ],
  },
];

/** The largest lattice step along a stroke's direction tried before giving up. */
const MAX_STEP = 24;

/** Integers x, y with a·x + b·y = gcd(a, b), the gcd positive. */
function bezout(a: number, b: number): [number, number, number] {
  if (b === 0) return a < 0 ? [-a, -1, 0] : [a, 1, 0];
  const [g, x, y] = bezout(b, a % b);
  return [g, y, x - Math.trunc(a / b) * y];
}

/**
 * The .pat lines of a motif: one family per stroke (and per dot, a dot being a dash of no
 * length on a horizontal line). Throws when a stroke does not run along a lattice direction, or
 * is longer than its line's repeat, since such a stroke cannot be drawn by one family.
 */
export function motifLines(m: Motif): PatLine[] {
  const { width: w, height: h, shift: s = 0 } = m.tile;
  const size = Math.max(w, h);
  const line = (x0: number, y0: number, dx: number, dy: number, length: number): PatLine => {
    // The direction in lattice coordinates (a, b): dx = a·w + b·s, dy = b·h.
    const beta = dy / h;
    const alpha = (dx - beta * s) / w;
    const big = Math.max(Math.abs(alpha), Math.abs(beta));
    let a = 0;
    let b = 0;
    for (let k = 1; k <= MAX_STEP && a === 0 && b === 0; k++) {
      const ka = (alpha / big) * k;
      const kb = (beta / big) * k;
      if (Math.abs(ka - Math.round(ka)) < 1e-9 * k && Math.abs(kb - Math.round(kb)) < 1e-9 * k) {
        a = Math.round(ka);
        b = Math.round(kb);
      }
    }
    if (a === 0 && b === 0)
      throw new Error(`${m.name}: a stroke's direction (${dx}, ${dy}) is not along the lattice`);
    const lx = a * w + b * s;
    const ly = b * h;
    const period = Math.hypot(lx, ly);
    if (length > period * (1 + 1e-9))
      throw new Error(`${m.name}: a stroke is longer than its line's repeat (${period})`);
    // A second lattice vector v = c·e1 + d·e2 with a·d − b·c = 1, so the two span the lattice:
    // the next line of the family is v away, across by w·h / period, along by v's projection.
    const [, x, y] = bezout(a, b);
    const c = -y;
    const d = x;
    const vx = c * w + d * s;
    const vy = d * h;
    const ux = lx / period;
    const uy = ly / period;
    const along = vx * ux + vy * uy;
    const across = ux * vy - uy * vx;
    // Any v plus a whole number of repeats spans the lattice too: keep the shift in [0, period).
    const shift = along - Math.floor(along / period + 1e-12) * period;
    const continuous = length >= period * (1 - 1e-9);
    return {
      angle: (Math.atan2(ly, lx) * 180) / Math.PI,
      origin: { x: x0, y: y0 },
      delta: { x: shift, y: across },
      dashes: continuous ? [] : [length, -(period - length)],
    };
  };
  return [
    ...(m.strokes ?? []).map(([x0, y0, x1, y1]) => {
      // Drawn from the end that keeps the line's angle in (−90°, 90°].
      if (x1 < x0 || (x1 === x0 && y1 < y0)) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (!(length > 1e-9 * size)) throw new Error(`${m.name}: a stroke has no length`);
      return line(x0, y0, x1 - x0, y1 - y0, length);
    }),
    ...(m.dots ?? []).map(([x, y]) => {
      const l = line(x, y, w, 0, 0);
      return { ...l, dashes: [0, -w] };
    }),
  ];
}

/** A number as the file writes it: at most 7 decimals, no trailing zeros. */
function num(v: number): string {
  const t = v.toFixed(7).replace(/\.?0+$/, '');
  return t === '-0' ? '0' : t;
}

/** Text in lines of at most 77 characters, so each comment line keeps to AutoCAD's 80. */
function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > 77) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const HEADER = `;; Triya CAD 2D bundled material and architectural hatch patterns (MIT, see
;; LICENSE). Authored for Triya in the .pat format AutoCAD documents
;; ("Overview of Hatch Pattern Definitions"); not derived from any Autodesk
;; file. Generated from the motifs in packages/hatch/src/materials.ts: edit
;; those, not this file.
;;
;; Lengths are millimetres: hatch a drawing in inches at a pattern scale of
;; 1/25.4. Each line: angle, x-origin, y-origin, delta-x (along), delta-y
;; (across), dashes. Each stroke of a motif is a family of its own, dashed so it
;; repeats once in every tile.
`;

/** The material patterns' .pat file. */
export function materialsPat(): string {
  const out = [HEADER];
  for (const m of MATERIAL_MOTIFS) {
    out.push(';;\n');
    for (const c of wrap(m.comment.join(' '))) out.push(`;; ${c}\n`);
    out.push(`*${m.name}, ${m.description}\n`);
    for (const l of motifLines(m)) {
      const head = [l.angle, l.origin.x, l.origin.y, l.delta.x, l.delta.y].map(num);
      const fields = [head[0], `${head[1]},${head[2]}`, `${head[3]},${head[4]}`];
      if (l.dashes.length > 0) fields.push(l.dashes.map(num).join(','));
      out.push(`${fields.join(', ')}\n`);
    }
  }
  return out.join('');
}

export const TRIYA_MATERIALS_PAT = materialsPat();

/** The material patterns' names, in the file's order (the Hatch Pattern Palette's tab). */
export const materialPatternNames = (): string[] => MATERIAL_MOTIFS.map((m) => m.name);
