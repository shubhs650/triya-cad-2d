// MTEXT layout (M1-11): parsed paragraphs → positioned runs in the MTEXT's own frame (origin
// at the insertion point, x along the text direction, y up). The renderer applies the
// entity's position, rotation and `upsideDown`, and draws each run's glyphs from its font.
//
// AutoCAD rules encoded here, with sources:
// - Single line spacing is 1.66 (5/3) × the text height; "at least" grows a line for taller
//   characters, "exactly" never does (-MTEXT command, Line spacing).
// - `\p` indents and tab stops are factors of the MTEXT's own height; default tab stops are
//   every 4 heights (ezdxf MTEXT internals, "paragraph properties").
// - The background border is (scale − 1) × height beyond the text on each side: "a factor of
//   1.5 (the default) extends the background by 0.5 times the text height" (Background Mask
//   dialog box).
// Where AutoCAD documents no number, the choice is noted where it is made: the top of the
// text is the first line's cap height and the bottom the last baseline; stacked text is 70 %
// (the Stack Properties default); decoration offsets are fractions of the run's height.

import type { MTextCharStyle, MTextDocument, MTextItem, MTextParagraph } from './parse';

/** Exact advance widths, from the run's resolved font (SHX or TrueType). */
export interface MTextMeasure {
  /**
   * The advance of `text` in drawing units for the style's font, height and width factor;
   * tracking is applied by layout.
   */
  advance(text: string, style: MTextCharStyle): number;
  /** The advance of a big-font character; a square cell (the height) when absent. */
  mbcs?(codepage: number, code: number, style: MTextCharStyle): number;
}

export interface MTextColumns {
  /** DXF 75: static, or dynamic (auto height, or manual per-column heights). */
  readonly type: 'static' | 'dynamic';
  readonly count: number;
  readonly width: number;
  readonly gutter: number;
  /** Column height for static and auto-height dynamic columns (DXF 46). */
  readonly height?: number;
  /** Per-column heights of dynamic manual columns (DXF 50 list). */
  readonly heights?: readonly number[];
  readonly flowReversed?: boolean;
}

export interface MTextLayoutOptions {
  /** The MTEXT's own height (DXF 40): the unit of indents, tabs and "exactly" spacing. */
  readonly height: number;
  /** Reference rectangle width (DXF 41); 0 does not wrap. */
  readonly width: number;
  /** DXF 71: 1–9, top-left to bottom-right. */
  readonly attachment: number;
  /** DXF 73: 1 at least, 2 exactly. */
  readonly lineSpacingStyle: number;
  /** DXF 44: line spacing factor. */
  readonly lineSpacing: number;
  readonly columns?: MTextColumns;
  /** Background fill or mask with its border scale (DXF 45). */
  readonly background?: { readonly scale: number };
}

export interface MTextBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface MTextStackPart {
  readonly text: string;
  readonly x: number;
  /** Baseline. */
  readonly y: number;
  readonly width: number;
  readonly style: MTextCharStyle;
}

/** A positioned run; `x`, `y` are its baseline start and `width` its advance. */
export type MTextRun =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly style: MTextCharStyle;
      /** Set when the run shows a field's value. */
      readonly field?: string;
    }
  | {
      readonly kind: 'mbcs';
      readonly codepage: number;
      readonly code: number;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly style: MTextCharStyle;
    }
  | {
      readonly kind: 'stack';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly style: MTextCharStyle;
      readonly upper: MTextStackPart;
      readonly lower: MTextStackPart;
      /** The fraction bar or diagonal slash, x1 y1 x2 y2. */
      readonly bar?: readonly [number, number, number, number];
    };

export interface MTextDecoration {
  readonly kind: 'underline' | 'overline' | 'strike';
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
}

export interface MTextLine {
  readonly baseline: number;
  /** Where the line's content starts. */
  readonly x: number;
  /** Content width, trailing spaces excluded. */
  readonly width: number;
  /** Cap height of its tallest character. */
  readonly height: number;
  readonly runs: readonly MTextRun[];
  readonly decorations: readonly MTextDecoration[];
}

export interface MTextLayout {
  readonly lines: readonly MTextLine[];
  /** The text box: the reference (or column) width, or the widest line when it is 0. */
  readonly width: number;
  /** First line's cap height to the last baseline; the column height with columns. */
  readonly height: number;
  readonly bounds: MTextBox;
  /** One box per column, when the MTEXT has columns. */
  readonly columns: readonly MTextBox[];
  /**
   * With columns: how many the text reaches, column breaks included (a dynamic MTEXT's count,
   * M2-07 part 3).
   */
  readonly columnsUsed?: number;
  /** The background fill or mask, when the MTEXT has one. */
  readonly mask?: MTextBox;
}

/** Single line spacing as a multiple of the text height. */
const LINE_SPACING = 5 / 3;
/** Default tab interval, in MTEXT heights. */
const DEFAULT_TAB = 4;
/** Stacked text size: the Stack Properties default, 70 %. */
const STACK_SCALE = 0.7;
/** Gap between a fraction's parts and its bar, in run heights. */
const STACK_GAP = 0.1;
/** The diagonal slash's run, in stacked-text heights. */
const SLASH_WIDTH = 0.5;
const EPS = 1e-9;

type Piece =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly style: MTextCharStyle;
      readonly width: number;
      readonly space: boolean;
      readonly field?: string;
    }
  | {
      readonly kind: 'mbcs';
      readonly codepage: number;
      readonly code: number;
      readonly style: MTextCharStyle;
      readonly width: number;
    }
  | {
      readonly kind: 'stack';
      readonly item: Extract<MTextItem, { type: 'stack' }>;
      readonly style: MTextCharStyle;
      readonly width: number;
      readonly upperWidth: number;
      readonly lowerWidth: number;
    }
  | { readonly kind: 'tab'; readonly style: MTextCharStyle };

interface Placed {
  readonly piece: Piece;
  x: number;
  readonly width: number;
}

interface BuiltLine {
  readonly placed: Placed[];
  /** Content width without trailing spaces. */
  readonly width: number;
  readonly height: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly para: MTextParagraph;
}

/**
 * How many columns dynamic columns of `width`, `gutter` and `height` take for the text: those
 * it flows into and those its column breaks start (AutoCAD adds and removes dynamic columns as
 * the text needs them). At most `limit`.
 */
export function dynamicColumnCount(
  doc: MTextDocument,
  measure: MTextMeasure,
  options: Omit<MTextLayoutOptions, 'columns'> & {
    readonly columns: Pick<MTextColumns, 'width' | 'gutter' | 'height'>;
  },
  limit = 100,
): number {
  const layout = layoutMText(doc, measure, {
    ...options,
    columns: { ...options.columns, type: 'dynamic', count: limit },
  });
  return layout.columnsUsed ?? 1;
}

/** Lays out parsed MTEXT for a measure and the entity's box properties. */
export function layoutMText(
  doc: MTextDocument,
  measure: MTextMeasure,
  options: MTextLayoutOptions,
): MTextLayout {
  const h0 = options.height;
  const cols = options.columns && options.columns.count > 0 ? options.columns : undefined;
  const wrapWidth = cols ? cols.width : options.width;
  const advance = (text: string, style: MTextCharStyle): number =>
    measure.advance(text, style) * style.tracking;
  const scaled = (style: MTextCharStyle): MTextCharStyle => ({
    ...style,
    height: style.height * STACK_SCALE,
  });

  // 1. Paragraphs → pieces → lines (horizontal layout within each paragraph).
  const paragraphs: { lines: BuiltLine[]; end: MTextParagraph['end']; para: MTextParagraph }[] = [];
  for (const para of doc.paragraphs) {
    const pieces = toPieces(para.items, advance, measure, scaled);
    paragraphs.push({ lines: breakLines(para, pieces, wrapWidth, h0), end: para.end, para });
  }

  // 2. Box width: the reference or column width, else the widest line with its indents.
  let naturalWidth = 0;
  for (const p of paragraphs)
    for (const l of p.lines) naturalWidth = Math.max(naturalWidth, indentOf(l, h0) + l.width);
  const columnCount = cols ? Math.max(1, cols.count) : 1;
  const boxWidth = cols
    ? columnCount * cols.width + (columnCount - 1) * cols.gutter
    : options.width > 0
      ? options.width
      : naturalWidth;
  const lineBox = cols ? cols.width : boxWidth;

  // 3. Vertical layout, column by column; positions relative to the box's top-left.
  const columnHeight = (i: number): number =>
    cols ? (cols.heights?.[i] ?? cols.height ?? Infinity) : Infinity;
  const spacing = (prevH: number, nextH: number): number => {
    const exact = options.lineSpacing * LINE_SPACING * h0;
    if (options.lineSpacingStyle === 2) return exact;
    return Math.max(exact, options.lineSpacing * ((LINE_SPACING - 1) * prevH + nextH));
  };
  const out: { line: BuiltLine; column: number; baseline: number }[] = [];
  let column = 0;
  let prev: { baseline: number; height: number } | undefined;
  let gapBefore = 0;
  for (const p of paragraphs) {
    for (const line of p.lines) {
      let baseline = prev
        ? prev.baseline -
          spacing(prev.height, line.height) -
          gapBefore -
          (line.first ? (p.para.style.spaceBefore ?? 0) * h0 : 0)
        : -line.height;
      if (prev && baseline < -columnHeight(column) - EPS && column < columnCount - 1) {
        column++;
        baseline = -line.height;
      }
      gapBefore = 0;
      out.push({ line, column, baseline });
      prev = { baseline, height: line.height };
    }
    gapBefore = (p.para.style.spaceAfter ?? 0) * h0;
    if (p.end === 'column' && cols && column < columnCount - 1) {
      column++;
      prev = undefined;
      gapBefore = 0;
    }
  }
  const lastBaseline = out.length ? Math.min(...out.map((o) => o.baseline)) : 0;
  const textHeight = cols
    ? Math.max(
        ...Array.from({ length: columnCount }, (_, i) => columnHeight(i)).filter(Number.isFinite),
        -lastBaseline,
      )
    : -lastBaseline;

  // 4. Attachment: where the box sits relative to the insertion point.
  const a = Math.min(9, Math.max(1, Math.round(options.attachment))) - 1;
  const left = [0, -0.5, -1][a % 3]! * boxWidth;
  const top = [0, 0.5, 1][Math.floor(a / 3)]! * textHeight;
  const columnX = (i: number): number => {
    const k = cols?.flowReversed ? columnCount - 1 - i : i;
    return left + (cols ? k * (cols.width + cols.gutter) : 0);
  };
  const byAttachment = (['left', 'center', 'right'] as const)[a % 3]!;

  const lines: MTextLine[] = out.map(({ line, column: c, baseline }) =>
    finishLine(line, columnX(c), top + baseline, lineBox, byAttachment, h0),
  );

  const bounds: MTextBox = { minX: left, minY: top - textHeight, maxX: left + boxWidth, maxY: top };
  const columns: MTextBox[] = cols
    ? Array.from({ length: columnCount }, (_, i) => ({
        minX: columnX(i),
        minY: top - columnHeight(i),
        maxX: columnX(i) + cols.width,
        maxY: top,
      }))
    : [];
  const result: MTextLayout = {
    lines,
    width: boxWidth,
    height: textHeight,
    bounds,
    columns,
    ...(cols && { columnsUsed: column + 1 }),
  };
  if (!options.background) return result;
  const pad = (options.background.scale - 1) * h0;
  return {
    ...result,
    mask: {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    },
  };
}

function toPieces(
  items: readonly MTextItem[],
  advance: (text: string, style: MTextCharStyle) => number,
  measure: MTextMeasure,
  scaled: (style: MTextCharStyle) => MTextCharStyle,
): Piece[] {
  const pieces: Piece[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'text':
      case 'field':
        // Only U+0020 is a break opportunity; a non-breaking space stays inside its word.
        for (const part of item.text.split(/( +)/)) {
          if (part === '') continue;
          pieces.push({
            kind: 'text',
            text: part,
            style: item.style,
            width: advance(part, item.style),
            space: part[0] === ' ',
            ...(item.type === 'field' ? { field: item.code } : {}),
          });
        }
        break;
      case 'mbcs':
        pieces.push({
          kind: 'mbcs',
          codepage: item.codepage,
          code: item.code,
          style: item.style,
          width:
            (measure.mbcs?.(item.codepage, item.code, item.style) ?? item.style.height) *
            item.style.tracking,
        });
        break;
      case 'stack': {
        const s = scaled(item.style);
        const upperWidth = advance(item.upper, s);
        const lowerWidth = advance(item.lower, s);
        const width =
          item.kind === 'diagonal'
            ? upperWidth + SLASH_WIDTH * s.height + lowerWidth
            : Math.max(upperWidth, lowerWidth);
        pieces.push({ kind: 'stack', item, style: item.style, width, upperWidth, lowerWidth });
        break;
      }
      case 'tab':
        pieces.push({ kind: 'tab', style: item.style });
        break;
    }
  }
  return pieces;
}

/** Splits pieces into segments: a word (non-space pieces) with its trailing spaces, or a tab. */
function segments(pieces: readonly Piece[]): Piece[][] {
  const out: Piece[][] = [];
  let cur: Piece[] = [];
  let inSpaces = false;
  for (const p of pieces) {
    const isSpace = p.kind === 'text' && p.space;
    if (p.kind === 'tab' || (!isSpace && inSpaces)) {
      if (cur.length) out.push(cur);
      cur = [];
      inSpaces = false;
    }
    if (p.kind === 'tab') {
      out.push([p]);
      continue;
    }
    cur.push(p);
    if (isSpace) inSpaces = true;
  }
  if (cur.length) out.push(cur);
  return out;
}

const widthOf = (p: Piece): number => (p.kind === 'tab' ? 0 : p.width);
const isSpace = (p: Piece): boolean => p.kind === 'text' && p.space;
const firstIndent = (para: MTextParagraph, h0: number): number =>
  (para.style.indentLeft + para.style.indentFirst) * h0;

function indentOf(line: BuiltLine, h0: number): number {
  return line.first ? firstIndent(line.para, h0) : line.para.style.indentLeft * h0;
}

/** The next tab stop after `x` (measured from the line's left edge, indents included). */
function nextStop(
  para: MTextParagraph,
  x: number,
  h0: number,
): { at: number; kind: 'left' | 'center' | 'right' } {
  for (const t of para.style.tabs) if (t.at * h0 > x + EPS) return { at: t.at * h0, kind: t.kind };
  // Past the paragraph's own stops, the default interval continues. AutoCAD does not say
  // what a tab beyond the last stop does; repeating the default grid is the common reading.
  const step = DEFAULT_TAB * h0;
  return { at: (Math.floor(x / step + EPS) + 1) * step, kind: 'left' };
}

function breakLines(
  para: MTextParagraph,
  pieces: readonly Piece[],
  wrapWidth: number,
  h0: number,
): BuiltLine[] {
  const segs = segments(pieces);
  const lines: BuiltLine[] = [];
  let placed: Placed[] = [];
  let first = true;
  const lineStart = (): number => (first ? firstIndent(para, h0) : para.style.indentLeft * h0);
  const limit = (): number => (wrapWidth > 0 ? wrapWidth - para.style.indentRight * h0 : Infinity);
  // The pen is measured from the box's left side, so tab stops include the indents.
  let pen = lineStart();

  const close = (last: boolean): void => {
    let end = placed.length;
    while (end > 0 && isSpace(placed[end - 1]!.piece)) end--;
    const startX = lineStart();
    const contentEnd = end > 0 ? placed[end - 1]!.x + placed[end - 1]!.width : startX;
    const height = placed.reduce((m, p) => Math.max(m, p.piece.style.height), 0) || h0;
    lines.push({
      placed: placed.map((p) => ({ ...p, x: p.x - startX })),
      width: Math.max(0, contentEnd - startX),
      height,
      first,
      last,
      para,
    });
    placed = [];
    first = false;
    pen = lineStart();
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (seg[0]!.kind === 'tab') {
      const tab = seg[0]!;
      const stop = nextStop(para, pen, h0);
      let to = stop.at;
      if (stop.kind !== 'left') {
        // Centre and right stops align the text up to the next tab or the paragraph's end.
        let w = 0;
        for (let j = i + 1; j < segs.length && segs[j]![0]!.kind !== 'tab'; j++)
          for (const p of segs[j]!) w += widthOf(p);
        to = Math.max(pen, stop.at - (stop.kind === 'right' ? w : w / 2));
      }
      placed.push({ piece: tab, x: pen, width: to - pen });
      pen = to;
      continue;
    }
    let wordWidth = 0;
    for (const p of seg) if (!isSpace(p)) wordWidth += widthOf(p);
    const hasContent = placed.some((p) => p.piece.kind !== 'tab' || p.width > 0);
    if (hasContent && pen + wordWidth > limit() + EPS) close(false);
    for (const p of seg) {
      placed.push({ piece: p, x: pen, width: widthOf(p) });
      pen += widthOf(p);
    }
  }
  close(true);
  return lines;
}

function finishLine(
  line: BuiltLine,
  boxLeft: number,
  baseline: number,
  available: number,
  byAttachment: 'left' | 'center' | 'right',
  h0: number,
): MTextLine {
  const style = line.para.style;
  const indent = indentOf(line, h0);
  const room = available - indent - style.indentRight * h0;
  const align = style.align ?? byAttachment;
  let offset = indent;
  if (align === 'right') offset = indent + room - line.width;
  else if (align === 'center') offset = indent + (room - line.width) / 2;
  const x0 = boxLeft + offset;

  // Justify: widen the spaces between words (not trailing ones), except on a paragraph's
  // last line unless distributed.
  const placed = line.placed.map((p) => ({ ...p }));
  if ((align === 'justified' && !line.last) || align === 'distributed') {
    let end = placed.length;
    while (end > 0 && isSpace(placed[end - 1]!.piece)) end--;
    const inner = placed.slice(0, end).filter((p) => isSpace(p.piece));
    const count = inner.reduce(
      (n, p) => n + (p.piece.kind === 'text' ? p.piece.text.length : 0),
      0,
    );
    const extra = room - line.width;
    if (count > 0 && extra > EPS) {
      let shift = 0;
      for (const p of placed) {
        p.x += shift;
        if (isSpace(p.piece) && inner.includes(p) && p.piece.kind === 'text')
          shift += (extra * p.piece.text.length) / count;
      }
    }
  }

  const runs: MTextRun[] = [];
  for (const p of placed) {
    const x = x0 + p.x;
    const piece = p.piece;
    if (piece.kind === 'tab') continue;
    const y = baseline + valignOffset(piece.style, line.height);
    if (piece.kind === 'text') {
      const prev = runs[runs.length - 1];
      if (
        prev?.kind === 'text' &&
        prev.style === piece.style &&
        prev.field === undefined &&
        piece.field === undefined &&
        Math.abs(prev.x + prev.width - x) < EPS
      ) {
        runs[runs.length - 1] = {
          ...prev,
          text: prev.text + piece.text,
          width: prev.width + piece.width,
        };
      } else {
        runs.push({
          kind: 'text',
          text: piece.text,
          x,
          y,
          width: piece.width,
          style: piece.style,
          ...(piece.field === undefined ? {} : { field: piece.field }),
        });
      }
    } else if (piece.kind === 'mbcs') {
      runs.push({
        kind: 'mbcs',
        codepage: piece.codepage,
        code: piece.code,
        x,
        y,
        width: piece.width,
        style: piece.style,
      });
    } else {
      runs.push(stackRun(piece, x, y));
    }
  }

  return {
    baseline,
    x: x0,
    width:
      (align === 'justified' && !line.last) || align === 'distributed'
        ? Math.max(line.width, room)
        : line.width,
    height: line.height,
    runs,
    decorations: decorations(runs),
  };
}

/** `\A`: a run shorter than its line sits at the bottom, middle or top of the cap height. */
function valignOffset(style: MTextCharStyle, lineHeight: number): number {
  if (style.valign === 'middle') return (lineHeight - style.height) / 2;
  if (style.valign === 'top') return lineHeight - style.height;
  return 0;
}

function stackRun(piece: Extract<Piece, { kind: 'stack' }>, x: number, y: number): MTextRun {
  const h = piece.style.height;
  const s = { ...piece.style, height: h * STACK_SCALE };
  const { item, width, upperWidth, lowerWidth } = piece;
  if (item.kind === 'diagonal') {
    // Numerator raised to the cap line, a slash, then the denominator on the baseline.
    const slash = SLASH_WIDTH * s.height;
    return {
      kind: 'stack',
      x,
      y,
      width,
      style: piece.style,
      upper: { text: item.upper, x, y: y + h - s.height, width: upperWidth, style: s },
      lower: { text: item.lower, x: x + upperWidth + slash, y, width: lowerWidth, style: s },
      bar: [x + upperWidth, y, x + upperWidth + slash, y + h],
    };
  }
  // Fractions and tolerances: parts above and below mid cap height, apart by a small gap.
  // Fractions centre the parts over a bar; tolerances left-align them with no bar.
  const mid = y + h / 2;
  const gap = STACK_GAP * h;
  const centre = item.kind === 'fraction';
  return {
    kind: 'stack',
    x,
    y,
    width,
    style: piece.style,
    upper: {
      text: item.upper,
      x: centre ? x + (width - upperWidth) / 2 : x,
      y: mid + gap,
      width: upperWidth,
      style: s,
    },
    lower: {
      text: item.lower,
      x: centre ? x + (width - lowerWidth) / 2 : x,
      y: mid - gap - s.height,
      width: lowerWidth,
      style: s,
    },
    ...(centre ? { bar: [x, mid, x + width, mid] as const } : {}),
  };
}

/** Underline 0.2 h below the baseline, overline 0.2 h above the cap line, strike at mid height. */
function decorations(runs: readonly MTextRun[]): MTextDecoration[] {
  const out: MTextDecoration[] = [];
  const add = (kind: MTextDecoration['kind'], x1: number, x2: number, y: number): void => {
    const prev = [...out].reverse().find((d) => d.kind === kind);
    if (prev && Math.abs(prev.x2 - x1) < EPS && Math.abs(prev.y - y) < EPS) {
      out[out.lastIndexOf(prev)] = { ...prev, x2 };
      return;
    }
    out.push({ kind, x1, x2, y });
  };
  for (const r of runs) {
    const h = r.style.height;
    if (r.style.underline) add('underline', r.x, r.x + r.width, r.y - 0.2 * h);
    if (r.style.overline) add('overline', r.x, r.x + r.width, r.y + 1.2 * h);
    if (r.style.strike) add('strike', r.x, r.x + r.width, r.y + 0.5 * h);
  }
  return out;
}
