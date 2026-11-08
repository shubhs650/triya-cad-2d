// SHX stroke interpreter (M1-08): a shape's specification bytes → pen-down polylines plus the
// pen's end position. Arcs stay exact as bulges, so nothing here depends on a zoom level;
// the renderer flattens them. Codes follow the AutoCAD Customization Guide, "Shape
// Descriptions" (vector bytes and special codes 0–14).
//
// Where the guide does not say, this follows the reading most SHX renderers share, noted at
// each place: a subshape continues with the caller's pen state and scale; restoring a pushed
// location moves the pen without drawing; a clockwise fractional arc mirrors the
// counter-clockwise offsets.

export interface ShxVertex {
  readonly x: number;
  readonly y: number;
  /** tan(θ/4) of the arc to the next vertex, > 0 counter-clockwise; 0 is a straight segment. */
  readonly bulge: number;
}

export interface ShxPath {
  readonly vertices: readonly ShxVertex[];
}

export interface ShxGlyph {
  readonly code: number;
  readonly name: string;
  /** Pen-down strokes in font units, from the character's origin. */
  readonly paths: readonly ShxPath[];
  /** Where the pen ends: the origin of the next character (exact advance width). */
  readonly advance: { readonly x: number; readonly y: number };
}

/** How the interpreter reaches other shapes (code 7) and how wide their numbers are. */
export interface ShapeSource {
  /** The spec bytes (after the name) of a shape, or undefined. */
  spec(code: number): Uint8Array | undefined;
  /** Subshape numbers take two bytes (high first) in Unicode fonts. */
  readonly wideSubshapes: boolean;
  /** Big fonts mark an extended subshape (with placement) by a 0 after code 7. */
  readonly bigfont: boolean;
  /** Character height in font units, for extended big-font subshapes. */
  readonly above: number;
}

/** The 16 standard vector directions (low nibble of a vector byte). */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [-0.5, 1],
  [-1, 1],
  [-1, 0.5],
  [-1, 0],
  [-1, -0.5],
  [-1, -1],
  [-0.5, -1],
  [0, -1],
  [0.5, -1],
  [1, -1],
  [1, -0.5],
];

const OCTANT = Math.PI / 4;
/** Location stack depth: AutoCAD allows four pushes. */
const MAX_STACK = 4;

const signed = (b: number): number => (b > 127 ? b - 256 : b);

class ShapeError extends Error {}

/** One command decoded from the bytes, before it is drawn (or skipped by code 14). */
type Command =
  | { readonly op: 'end' }
  | { readonly op: 'pen'; readonly down: boolean }
  | { readonly op: 'scale'; readonly factor: number }
  | { readonly op: 'push' }
  | { readonly op: 'pop' }
  | {
      readonly op: 'subshape';
      readonly code: number;
      readonly place?: { x: number; y: number; w: number; h: number };
    }
  | { readonly op: 'move'; readonly dx: number; readonly dy: number }
  | { readonly op: 'moves'; readonly steps: readonly (readonly [number, number])[] }
  | { readonly op: 'arc'; readonly radius: number; readonly start: number; readonly sweep: number }
  | { readonly op: 'bulges'; readonly steps: readonly (readonly [number, number, number])[] }
  | { readonly op: 'vertical' };

class Reader {
  at = 0;
  constructor(
    private readonly bytes: Uint8Array,
    private readonly label: string,
  ) {}
  get done(): boolean {
    return this.at >= this.bytes.length;
  }
  u8(): number {
    if (this.at >= this.bytes.length) throw new ShapeError(`${this.label} ends inside a command`);
    return this.bytes[this.at++]!;
  }
  s8(): number {
    return signed(this.u8());
  }
}

/** Octant byte of codes 10 and 11: [-]0SC, start octant S, span C (0 = all eight). */
function octants(byte: number): { start: number; span: number; cw: boolean } {
  const v = signed(byte);
  const a = Math.abs(v);
  return { start: (a >> 4) & 7, span: a & 7 || 8, cw: v < 0 };
}

function decode(r: Reader, src: ShapeSource): Command {
  const b = r.u8();
  const length = b >> 4;
  if (length > 0) {
    const [dx, dy] = DIRECTIONS[b & 15]!;
    return { op: 'move', dx: dx * length, dy: dy * length };
  }
  switch (b) {
    case 0:
      return { op: 'end' };
    case 1:
    case 2:
      return { op: 'pen', down: b === 1 };
    case 3:
      return { op: 'scale', factor: 1 / r.u8() };
    case 4:
      return { op: 'scale', factor: r.u8() };
    case 5:
      return { op: 'push' };
    case 6:
      return { op: 'pop' };
    case 7: {
      if (src.bigfont) {
        const first = r.u8();
        if (first !== 0) return { op: 'subshape', code: first };
        // Extended big-font subshape: number, origin and cell size, for composing glyphs.
        const code = (r.u8() << 8) | r.u8();
        const place = { x: r.u8(), y: r.u8(), w: r.u8(), h: r.u8() };
        return { op: 'subshape', code, place };
      }
      const code = src.wideSubshapes ? (r.u8() << 8) | r.u8() : r.u8();
      return { op: 'subshape', code };
    }
    case 8:
      return { op: 'move', dx: r.s8(), dy: r.s8() };
    case 9: {
      const steps: [number, number][] = [];
      for (;;) {
        const dx = r.s8();
        const dy = r.s8();
        if (dx === 0 && dy === 0) return { op: 'moves', steps };
        steps.push([dx, dy]);
      }
    }
    case 10: {
      const radius = r.u8();
      const o = octants(r.u8());
      const sweep = o.span * OCTANT;
      return { op: 'arc', radius, start: o.start * OCTANT, sweep: o.cw ? -sweep : sweep };
    }
    case 11: {
      // Offsets are in 1/256 of an octant from an octant boundary. The arc ends `endOffset`
      // into its last octant, or on the boundary after it when the offset is 0.
      const startOffset = r.u8();
      const endOffset = r.u8();
      const radius = (r.u8() << 8) | r.u8();
      const o = octants(r.u8());
      const dir = o.cw ? -1 : 1;
      const start = (o.start + (dir * startOffset) / 256) * OCTANT;
      const lastOctant = o.start + dir * (endOffset === 0 ? o.span : o.span - 1);
      const end = (lastOctant + (dir * endOffset) / 256) * OCTANT;
      return { op: 'arc', radius, start, sweep: end - start };
    }
    case 12:
      return { op: 'bulges', steps: [[r.s8(), r.s8(), r.s8()]] };
    case 13: {
      const steps: [number, number, number][] = [];
      for (;;) {
        const dx = r.s8();
        const dy = r.s8();
        if (dx === 0 && dy === 0) return { op: 'bulges', steps };
        steps.push([dx, dy, r.s8()]);
      }
    }
    case 14:
      return { op: 'vertical' };
    default:
      // Codes 15 and above with a zero length nibble do not exist; AutoCAD's compiler rejects
      // them. Treat as the end of the shape rather than guess at their operands.
      return { op: 'end' };
  }
}

/** Mutable drawing state shared with subshapes. */
interface Pen {
  x: number;
  y: number;
  down: boolean;
  scale: number;
  stack: { x: number; y: number }[];
  paths: ShxVertex[][];
  /** The path being drawn (its last vertex is the pen), or undefined after a pen-up move. */
  current: ShxVertex[] | undefined;
}

function lineTo(pen: Pen, x: number, y: number, bulge = 0): void {
  if (pen.down) {
    if (!pen.current) {
      pen.current = [{ x: pen.x, y: pen.y, bulge }];
      pen.paths.push(pen.current);
    } else {
      const last = pen.current[pen.current.length - 1]!;
      pen.current[pen.current.length - 1] = { x: last.x, y: last.y, bulge };
    }
    pen.current.push({ x, y, bulge: 0 });
  } else {
    pen.current = undefined;
  }
  pen.x = x;
  pen.y = y;
}

function moveTo(pen: Pen, x: number, y: number): void {
  pen.current = undefined;
  pen.x = x;
  pen.y = y;
}

/** An arc about the centre implied by the pen, split into pieces of at most 90°. */
function arc(pen: Pen, radius: number, start: number, sweep: number): void {
  const cx = pen.x - radius * Math.cos(start);
  const cy = pen.y - radius * Math.sin(start);
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  for (let i = 1; i <= pieces; i++) {
    const a = start + step * i;
    lineTo(pen, cx + radius * Math.cos(a), cy + radius * Math.sin(a), Math.tan(step / 4));
  }
}

function run(
  code: number,
  src: ShapeSource,
  pen: Pen,
  active: Set<number>,
  label: (code: number) => string,
  vertical: boolean,
): void {
  const spec = src.spec(code);
  if (!spec || active.has(code)) return; // a missing or cyclic subshape draws nothing
  active.add(code);
  const r = new Reader(spec, label(code));
  for (;;) {
    if (r.done) throw new ShapeError(`${label(code)} has no end (code 0)`);
    const cmd = decode(r, src);
    if (cmd.op === 'end') break;
    if (cmd.op === 'vertical') {
      // The next command belongs to vertical text: run in vertical text, skipped otherwise.
      if (!vertical) decode(r, src);
      continue;
    }
    execute(cmd, src, pen, active, label, vertical);
  }
  active.delete(code);
}

function execute(
  cmd: Command,
  src: ShapeSource,
  pen: Pen,
  active: Set<number>,
  label: (code: number) => string,
  vertical: boolean,
): void {
  const s = pen.scale;
  switch (cmd.op) {
    case 'pen':
      pen.down = cmd.down;
      if (!cmd.down) pen.current = undefined;
      return;
    case 'scale':
      pen.scale *= cmd.factor;
      return;
    case 'push':
      if (pen.stack.length < MAX_STACK) pen.stack.push({ x: pen.x, y: pen.y });
      return;
    case 'pop': {
      // Restoring moves the pen without drawing.
      const p = pen.stack.pop();
      if (p) moveTo(pen, p.x, p.y);
      return;
    }
    case 'subshape': {
      if (!cmd.place) {
        // The subshape continues with the caller's pen state and scale.
        run(cmd.code, src, pen, active, label, vertical);
        return;
      }
      // Extended big-font subshape: drawn in a w×h cell at (x, y) from the pen, scaled from
      // the font's character height.
      const { x, y, w, h } = cmd.place;
      const k = src.above || 1;
      const saved = { x: pen.x, y: pen.y, scale: pen.scale };
      moveTo(pen, pen.x + x * s, pen.y + y * s);
      pen.scale = (s * Math.max(w, h)) / k;
      run(cmd.code, src, pen, active, label, vertical);
      pen.scale = saved.scale;
      moveTo(pen, saved.x + w * s, saved.y);
      return;
    }
    case 'move':
      lineTo(pen, pen.x + cmd.dx * s, pen.y + cmd.dy * s);
      return;
    case 'moves':
      for (const [dx, dy] of cmd.steps) lineTo(pen, pen.x + dx * s, pen.y + dy * s);
      return;
    case 'arc':
      arc(pen, cmd.radius * s, cmd.start, cmd.sweep);
      return;
    case 'bulges':
      // Shape bulge = 127 · 2H/D, and 2H/D is the DXF bulge tan(θ/4).
      for (const [dx, dy, b] of cmd.steps) lineTo(pen, pen.x + dx * s, pen.y + dy * s, b / 127);
      return;
  }
}

/**
 * Interprets one shape and every subshape it calls, for horizontal text or, in a font that
 * supports both orientations, for vertical text (the commands after code 14 run).
 */
export function interpretShape(
  code: number,
  name: string,
  src: ShapeSource,
  label: (code: number) => string,
  vertical = false,
): ShxGlyph {
  const pen: Pen = {
    x: 0,
    y: 0,
    down: true,
    scale: 1,
    stack: [],
    paths: [],
    current: undefined,
  };
  try {
    run(code, src, pen, new Set(), label, vertical);
  } catch (e) {
    if (e instanceof ShapeError) throw new Error(e.message, { cause: e });
    throw e;
  }
  return {
    code,
    name,
    paths: pen.paths.filter((p) => p.length > 1).map((vertices) => ({ vertices })),
    advance: { x: pen.x, y: pen.y },
  };
}
