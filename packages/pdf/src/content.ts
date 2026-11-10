// A page's content stream (PDF 32000-1:2008 §8, "Graphics"): path construction and painting
// operators with the graphics state they use, written as text. The builder remembers the
// state it set (line width, caps, joins, dashes, colours, transparency), so a plot that sets
// the same pen for many objects writes it once; `save`/`restore` keep that memory in step with
// the PDF's own `q`/`Q` stack. Coordinates are PDF user space: points, origin at the page's
// lower-left corner, y up. No DOM here: this package runs in Node and in workers.

/** An sRGB colour, 0–255 per channel. */
export type Rgb = readonly [r: number, g: number, b: number];

/** PDF line cap (Table 54): butt, round, projecting square. */
export type LineCap = 0 | 1 | 2;
/** PDF line join (Table 55): miter, round, bevel. */
export type LineJoin = 0 | 1 | 2;

/**
 * A number as a PDF real: at most 4 decimals (1/10 000 pt is far below any device's
 * resolution), no exponent, no trailing zeros and no negative zero.
 */
export function pdfNumber(v: number): string {
  // No plot comes near 1e15 points; past it toFixed would write an exponent.
  if (!(Math.abs(v) < 1e15)) throw new RangeError(`not a PDF number: ${v}`);
  const s = v.toFixed(4);
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return t === '-0' ? '0' : t;
}

const n = pdfNumber;

interface GraphicsState {
  lineWidth: number | undefined;
  cap: LineCap | undefined;
  join: LineJoin | undefined;
  dash: string | undefined;
  stroke: string | undefined;
  fill: string | undefined;
  gs: string | undefined;
}

const unknownState = (): GraphicsState => ({
  lineWidth: undefined,
  cap: undefined,
  join: undefined,
  dash: undefined,
  stroke: undefined,
  fill: undefined,
  gs: undefined,
});

/** One channel as a PDF colour component, 0–1. */
const channel = (v: number) => n(Math.min(255, Math.max(0, v)) / 255);

/**
 * A colour operand: DeviceGray when the channels are equal (a monochrome plot then holds no
 * RGB at all), else DeviceRGB.
 */
function colorOperands([r, g, b]: Rgb): { readonly gray: boolean; readonly text: string } {
  return r === g && g === b
    ? { gray: true, text: channel(r) }
    : { gray: false, text: `${channel(r)} ${channel(g)} ${channel(b)}` };
}

export class ContentStream {
  private readonly ops: string[] = [];
  private state: GraphicsState = unknownState();
  private readonly stack: GraphicsState[] = [];

  /** `q`: pushes the graphics state (clip included). */
  save(): this {
    this.ops.push('q');
    this.stack.push({ ...this.state });
    return this;
  }

  /** `Q`: pops it, with whatever was set since `save`. */
  restore(): this {
    const s = this.stack.pop();
    if (!s) throw new Error('restore without save');
    this.ops.push('Q');
    this.state = s;
    return this;
  }

  /** Nesting depth of `save`, which must be back at zero when the page is written. */
  get depth(): number {
    return this.stack.length;
  }

  lineWidth(w: number): this {
    if (this.state.lineWidth !== w) {
      this.ops.push(`${n(w)} w`);
      this.state.lineWidth = w;
    }
    return this;
  }

  lineCap(c: LineCap): this {
    if (this.state.cap !== c) {
      this.ops.push(`${c} J`);
      this.state.cap = c;
    }
    return this;
  }

  lineJoin(j: LineJoin): this {
    if (this.state.join !== j) {
      this.ops.push(`${j} j`);
      this.state.join = j;
    }
    return this;
  }

  /** `d`: dash and gap lengths in points from `phase`; an empty array is a solid line. */
  dash(lengths: readonly number[], phase = 0): this {
    const text = `[${lengths.map(n).join(' ')}] ${n(phase)} d`;
    if (this.state.dash !== text) {
      this.ops.push(text);
      this.state.dash = text;
    }
    return this;
  }

  strokeColor(c: Rgb): this {
    const { gray, text } = colorOperands(c);
    const op = `${text} ${gray ? 'G' : 'RG'}`;
    if (this.state.stroke !== op) {
      this.ops.push(op);
      this.state.stroke = op;
    }
    return this;
  }

  fillColor(c: Rgb): this {
    const { gray, text } = colorOperands(c);
    const op = `${text} ${gray ? 'g' : 'rg'}`;
    if (this.state.fill !== op) {
      this.ops.push(op);
      this.state.fill = op;
    }
    return this;
  }

  /**
   * Fills with an uncoloured tiling pattern (`PdfPage.pattern`) painted in `c`, through the
   * page's pattern colour space over DeviceGray or DeviceRGB (`PdfPage.patternSpace`).
   */
  fillPattern(space: string, pattern: string, c: Rgb): this {
    const { text } = colorOperands(c);
    const op = `/${space} cs ${text} /${pattern} scn`;
    if (this.state.fill !== op) {
      this.ops.push(op);
      this.state.fill = op;
    }
    return this;
  }

  /**
   * `cm`: maps user space through `m` (x' = a·x + c·y + e, y' = b·x + d·y + f), its numbers
   * written by `write` (four decimals unless given).
   */
  transform(
    m: {
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly d: number;
      readonly e: number;
      readonly f: number;
    },
    write: (v: number) => string = n,
  ): this {
    const w = write;
    this.ops.push(`${w(m.a)} ${w(m.b)} ${w(m.c)} ${w(m.d)} ${w(m.e)} ${w(m.f)} cm`);
    return this;
  }

  /** `sh`: paints a shading of the page's resources over the current clip. */
  shade(name: string): this {
    this.ops.push(`/${name} sh`);
    return this;
  }

  /** `Do`: paints an XObject of the page's resources (an image fills the unit square). */
  xobject(name: string): this {
    this.ops.push(`/${name} Do`);
    return this;
  }

  /** `gs`: an ExtGState of the page's resources, by name (`PdfPage.alpha`). */
  graphicsState(name: string): this {
    if (this.state.gs !== name) {
      this.ops.push(`/${name} gs`);
      this.state.gs = name;
    }
    return this;
  }

  moveTo(x: number, y: number): this {
    this.ops.push(`${n(x)} ${n(y)} m`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.ops.push(`${n(x)} ${n(y)} l`);
    return this;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.ops.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)} c`);
    return this;
  }

  closePath(): this {
    this.ops.push('h');
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re`);
    return this;
  }

  stroke(): this {
    this.ops.push('S');
    return this;
  }

  /** `f` (nonzero winding) or `f*` (even-odd, as AutoCAD fills hatch loops). */
  fill(evenOdd = false): this {
    this.ops.push(evenOdd ? 'f*' : 'f');
    return this;
  }

  /** `W n` / `W* n`: intersects the clip with the current path and ends it unpainted. */
  clip(evenOdd = false): this {
    this.ops.push(evenOdd ? 'W* n' : 'W n');
    return this;
  }

  /**
   * A text object (§9.4) showing glyph runs in `font` (a page resource) at size 1: each run's
   * text matrix maps one em to user space, and its `TJ` array holds two-byte codes (Identity-H)
   * and, between them, adjustments in thousandths of an em (positive moves back).
   */
  text(
    font: string,
    runs: readonly {
      readonly m: {
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
        readonly e: number;
        readonly f: number;
      };
      readonly show: readonly (number | { readonly code: number })[];
    }[],
  ): this {
    if (runs.length === 0) return this;
    this.ops.push('BT', `/${font} 1 Tf`);
    for (const { m, show } of runs) {
      this.ops.push(`${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.e)} ${n(m.f)} Tm`);
      // Codes in a row share one hex string; an adjustment sits between strings.
      const parts: string[] = [];
      let codes = '';
      for (const s of show) {
        if (typeof s === 'number') {
          if (codes) parts.push(`<${codes}>`);
          codes = '';
          parts.push(n(s));
        } else codes += s.code.toString(16).toUpperCase().padStart(4, '0');
      }
      if (codes) parts.push(`<${codes}>`);
      this.ops.push(`[${parts.join(' ')}] TJ`);
    }
    this.ops.push('ET');
    return this;
  }

  /** The operators written so far, one per line. */
  toString(): string {
    return this.ops.length > 0 ? `${this.ops.join('\n')}\n` : '';
  }
}
