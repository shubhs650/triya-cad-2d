// MTEXT layout (M1-11): line breaking, justification, tabs, stacks, line spacing, columns
// and the background mask. A fixed-pitch measure (every character one text height wide)
// keeps the expected positions hand-checkable; real fonts plug in through `MTextMeasure`.
import { describe, expect, it } from 'vitest';
import {
  dynamicColumnCount,
  layoutMText,
  parseMText,
  type MTextBase,
  type MTextLayout,
  type MTextLayoutOptions,
  type MTextMeasure,
  type MTextRun,
} from '../../src/index';

const base: MTextBase = {
  font: { name: 'mono', kind: 'shx', bold: false, italic: false },
  height: 1,
  widthFactor: 1,
  oblique: 0,
};

const mono: MTextMeasure = {
  advance: (text, style) => [...text].length * style.height * style.widthFactor,
};

const SPACING = 5 / 3;

function lay(contents: string, options: Partial<MTextLayoutOptions> = {}): MTextLayout {
  return layoutMText(parseMText(contents, base), mono, {
    height: 1,
    width: 0,
    attachment: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    ...options,
  });
}

const textOf = (r: MTextRun): string =>
  r.kind === 'text' ? r.text : r.kind === 'stack' ? `${r.upper.text}/${r.lower.text}` : '?';
const lineTexts = (l: MTextLayout): string[] => l.lines.map((ln) => ln.runs.map(textOf).join(''));

describe('single lines and attachment', () => {
  it('puts a top-left line with its cap height below the insertion point', () => {
    const l = lay('abc');
    expect(l.lines).toHaveLength(1);
    const [run] = l.lines[0]!.runs;
    expect(run).toMatchObject({ kind: 'text', text: 'abc', x: 0, y: -1, width: 3 });
    expect(l.bounds).toEqual({ minX: 0, minY: -1, maxX: 3, maxY: 0 });
    expect(l.width).toBe(3);
    expect(l.height).toBe(1);
  });

  it('places the box by each of the nine attachment points', () => {
    const at = (attachment: number) => {
      const r = lay('abcd', { attachment }).lines[0]!.runs[0]!;
      return [r.x, r.y];
    };
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(at)).toEqual([
      [0, -1],
      [-2, -1],
      [-4, -1],
      [0, -0.5],
      [-2, -0.5],
      [-4, -0.5],
      [0, 0],
      [-2, 0],
      [-4, 0],
    ]);
  });

  it('measures the height from the first cap line to the last baseline', () => {
    const l = lay('a\\Pb', { attachment: 7 });
    expect(l.height).toBeCloseTo(1 + SPACING, 12);
    expect(l.lines[1]!.baseline).toBeCloseTo(0, 12);
    expect(l.lines[0]!.baseline).toBeCloseTo(SPACING, 12);
  });

  it('gives an empty paragraph a line of its own', () => {
    const l = lay('a\\P\\Pb');
    expect(l.lines.map((x) => x.baseline)).toEqual([-1, -1 - SPACING, -1 - 2 * SPACING]);
    expect(l.lines[1]!.runs).toEqual([]);
  });

  it('lays out nothing for empty contents but still gives a zero-width line', () => {
    const l = lay('');
    expect(l.lines).toHaveLength(1);
    expect(l.width).toBe(0);
  });
});

describe('word wrap', () => {
  it('breaks at spaces to fit the reference width', () => {
    const l = lay('aa bb cc', { width: 5 });
    expect(lineTexts(l)).toEqual(['aa bb ', 'cc']);
    expect(l.lines.map((x) => x.width)).toEqual([5, 2]);
    expect(l.lines[1]!.baseline).toBeCloseTo(-1 - SPACING, 12);
    expect(l.width).toBe(5);
  });

  it('keeps a word longer than the width on its own line', () => {
    expect(lineTexts(lay('a longword b', { width: 4 }))).toEqual(['a ', 'longword ', 'b']);
  });

  it('does not break at a non-breaking space', () => {
    expect(lineTexts(lay('aa b\u00a0c', { width: 4 }))).toEqual(['aa ', 'b\u00a0c']);
  });

  it('does not wrap when the width is 0', () => {
    expect(lineTexts(lay('aa bb cc dd ee ff'))).toEqual(['aa bb cc dd ee ff']);
  });

  it('wraps across style changes without losing runs', () => {
    const l = lay('aa {\\C1;bb} cc', { width: 5 });
    expect(lineTexts(l)).toEqual(['aa bb ', 'cc']);
    expect(l.lines[0]!.runs.map((r) => r.style.color)).toEqual([
      undefined,
      { kind: 'aci', index: 1 },
      undefined,
    ]);
  });
});

describe('horizontal alignment', () => {
  it('aligns lines in the reference box by the attachment column', () => {
    const x = (attachment: number) => lay('abc', { width: 10, attachment }).lines[0]!.x;
    expect([x(1), x(2), x(3)]).toEqual([0, -1.5, -3]);
    expect(lay('abc', { width: 10, attachment: 2 }).bounds).toMatchObject({ minX: -5, maxX: 5 });
  });

  it('lets a paragraph alignment override the attachment column', () => {
    expect(lay('\\pqr;abc', { width: 10 }).lines[0]!.x).toBe(7);
    expect(lay('\\pqc;abc', { width: 10 }).lines[0]!.x).toBe(3.5);
  });

  it('ignores trailing spaces when centring a wrapped line', () => {
    const l = lay('\\pqc;aa bb cc', { width: 7 });
    expect(l.lines[0]).toMatchObject({ x: 1, width: 5 });
  });

  it('justifies by widening spaces, except on a paragraph’s last line', () => {
    const l = lay('\\pqj;aa bb cc dd', { width: 9 });
    expect(lineTexts(l)).toEqual(['aa bb cc ', 'dd']);
    expect(l.lines[0]!.runs.map((r) => r.x)).toEqual([0, 3.5, 7]);
    expect(l.lines[0]!.width).toBe(9);
    expect(l.lines[1]!.runs[0]!.x).toBe(0);
  });

  it('distributes the last line too', () => {
    const l = lay('\\pqd;aa bb cc dd ee', { width: 9 });
    expect(lineTexts(l)).toEqual(['aa bb cc ', 'dd ee']);
    expect(l.lines[1]!.runs.map((r) => r.x)).toEqual([0, 7]);
  });
});

describe('paragraph indents and spacing', () => {
  it('indents in multiples of the MTEXT height, first line relative to the left indent', () => {
    const l = layoutMText(parseMText('\\pxi-1,l2;aa bb cc', { ...base, height: 2 }), mono, {
      height: 2,
      width: 14,
      attachment: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    });
    // left 4, first line 2; first line fits 12 units (aa bb = 10), next lines fit 10.
    expect(lineTexts(l)).toEqual(['aa bb ', 'cc']);
    expect(l.lines.map((x) => x.x)).toEqual([2, 4]);
  });

  it('honours the right indent when wrapping', () => {
    expect(lineTexts(lay('\\pr2;aa bb', { width: 6 }))).toEqual(['aa ', 'bb']);
  });

  it('adds space before and after paragraphs', () => {
    const l = lay('\\psa1;a\\Pb');
    expect(l.lines[1]!.baseline).toBeCloseTo(-1 - SPACING - 1, 12);
  });
});

describe('tabs', () => {
  it('uses default stops every 4 heights', () => {
    const l = lay('a\tb\tc');
    expect(l.lines[0]!.runs.map((r) => r.x)).toEqual([0, 4, 8]);
  });

  it('uses the paragraph’s stops, and default ones after the last', () => {
    const l = lay('\\pt2;a\tb\tc');
    expect(l.lines[0]!.runs.map((r) => r.x)).toEqual([0, 2, 4]);
  });

  it('ends text at a right stop and centres it on a centre stop', () => {
    expect(lay('\\ptr6;a\tbb').lines[0]!.runs[1]!.x).toBe(4);
    expect(lay('\\ptc6;a\tbb').lines[0]!.runs[1]!.x).toBe(5);
    // Text that would start before the pen stays after it.
    expect(lay('\\ptr5;abc\tdddd').lines[0]!.width).toBe(7);
  });
});

describe('heights and line spacing', () => {
  it('drops the first line by its tallest character', () => {
    const l = lay('a{\\H2;b}');
    expect(l.lines[0]!.baseline).toBe(-2);
    expect(l.lines[0]!.height).toBe(2);
  });

  it('scales line spacing by the factor', () => {
    const l = lay('a\\Pb', { lineSpacing: 2 });
    expect(l.lines[1]!.baseline).toBeCloseTo(-1 - 2 * SPACING, 12);
  });

  it('“at least” makes room for taller characters; “exactly” does not', () => {
    const atLeast = lay('a\\P{\\H2;b}');
    expect(atLeast.lines[1]!.baseline).toBeCloseTo(-1 - (2 / 3 + 2), 12);
    const exactly = lay('a\\P{\\H2;b}', { lineSpacingStyle: 2 });
    expect(exactly.lines[1]!.baseline).toBeCloseTo(-1 - SPACING, 12);
  });

  it('places small runs at the bottom, middle or top of the line (\\A)', () => {
    const l = lay('{\\H2;X}{\\H1;\\A0;a\\A1;b\\A2;c}');
    const ys = l.lines[0]!.runs.map((r) => r.y);
    expect(ys).toEqual([-2, -2, -1.5, -1]);
  });

  it('applies width factor and tracking to advances', () => {
    expect(lay('\\W2;ab').lines[0]!.width).toBe(4);
    expect(lay('\\T1.5;ab').lines[0]!.width).toBe(3);
  });
});

describe('stacks', () => {
  it('puts a fraction’s parts above and below a bar at mid cap height, at 70%', () => {
    const [s] = lay('\\S1/22;').lines[0]!.runs;
    if (s?.kind !== 'stack') throw new Error('not a stack');
    expect(s.width).toBeCloseTo(1.4, 12);
    expect(s.upper).toMatchObject({ text: '1' });
    expect(s.upper.style.height).toBeCloseTo(0.7, 12);
    expect(s.upper.x).toBeCloseTo(0.35, 12);
    expect(s.upper.y).toBeCloseTo(-1 + 0.6, 12);
    expect(s.lower.x).toBeCloseTo(0, 12);
    expect(s.lower.y).toBeCloseTo(-1 + 0.4 - 0.7, 12);
    expect(s.bar).toEqual([0, -0.5, expect.closeTo(1.4, 12), -0.5]);
  });

  it('left-aligns a tolerance stack with no bar', () => {
    const [s] = lay('\\S+0.1^-0.25;').lines[0]!.runs;
    if (s?.kind !== 'stack') throw new Error('not a stack');
    expect(s.upper.x).toBe(0);
    expect(s.lower.x).toBe(0);
    expect(s.bar).toBeUndefined();
    expect(s.width).toBeCloseTo(0.7 * 5, 12);
  });

  it('sets a diagonal fraction side by side across a slash', () => {
    const [s] = lay('\\S1#2;').lines[0]!.runs;
    if (s?.kind !== 'stack') throw new Error('not a stack');
    expect(s.upper).toMatchObject({ x: 0 });
    expect(s.upper.y).toBeCloseTo(-1 + 0.3, 12);
    expect(s.lower.x).toBeCloseTo(0.7 + 0.35, 12);
    expect(s.lower.y).toBe(-1);
    expect(s.width).toBeCloseTo(0.7 + 0.35 + 0.7, 12);
    expect(s.bar).toEqual([0.7, -1, expect.closeTo(1.05, 12), 0]);
  });
});

describe('decorations, fields and big-font characters', () => {
  it('draws underline, overline and strike-through across runs', () => {
    const l = lay('a\\Lbc\\l\\Od\\o\\Ke');
    expect(l.lines[0]!.decorations).toEqual([
      { kind: 'underline', x1: 1, x2: 3, y: expect.closeTo(-1.2, 12) },
      { kind: 'overline', x1: 3, x2: 4, y: expect.closeTo(0.2, 12) },
      { kind: 'strike', x1: 4, x2: 5, y: -0.5 },
    ]);
  });

  it('lays out a field by its text', () => {
    expect(lineTexts(lay('%<\\AcVar Date>%!'))).toEqual(['----!']);
  });

  it('measures a big-font character with the measure, else as a square cell', () => {
    const l = lay('\\M+18140a');
    expect(l.lines[0]!.runs[0]).toMatchObject({ kind: 'mbcs', code: 0x8140, width: 1 });
    const half = layoutMText(
      parseMText('\\M+18140a', base),
      { ...mono, mbcs: () => 0.5 },
      {
        height: 1,
        width: 0,
        attachment: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      },
    );
    expect(half.lines[0]!.runs[1]!.x).toBe(0.5);
  });
});

describe('columns', () => {
  const cols = { type: 'static' as const, count: 2, width: 4, gutter: 1, height: 3 };

  it('fills a column to its height, then moves to the next', () => {
    const l = lay('a\\Pb\\Pc', { columns: cols });
    expect(l.lines.map((x) => [x.runs.map(textOf).join(''), x.x, x.baseline])).toEqual([
      ['a', 0, -1],
      ['b', 0, -1 - SPACING],
      ['c', 5, -1],
    ]);
    expect(l.columns).toEqual([
      { minX: 0, minY: -3, maxX: 4, maxY: 0 },
      { minX: 5, minY: -3, maxX: 9, maxY: 0 },
    ]);
  });

  it('breaks to the next column at \\N, and wraps to the column width', () => {
    const l = lay('aa bb\\Nc', { columns: { ...cols, height: 10 } });
    expect(l.lines.map((x) => [x.runs.map(textOf).join(''), x.x])).toEqual([
      ['aa ', 0],
      ['bb', 0],
      ['c', 5],
    ]);
  });

  it('uses per-column heights for dynamic manual columns, and flows right to left reversed', () => {
    const l = lay('a\\Pb\\Pc', {
      columns: { type: 'dynamic', count: 2, width: 4, gutter: 1, heights: [1, 10] },
    });
    expect(l.lines.map((x) => x.x)).toEqual([0, 5, 5]);
    const rev = lay('a\\Pb\\Pc', { columns: { ...cols, flowReversed: true } });
    expect(rev.lines.map((x) => x.x)).toEqual([5, 5, 0]);
  });

  it('treats \\N as a paragraph break without columns', () => {
    expect(lineTexts(lay('a\\Nb'))).toEqual(['a', 'b']);
  });
});

describe('background mask', () => {
  it('extends the text box by (scale − 1) × height on every side', () => {
    expect(lay('abc', { background: { scale: 1.5 } }).mask).toEqual({
      minX: -0.5,
      minY: -1.5,
      maxX: 3.5,
      maxY: 0.5,
    });
    expect(lay('abc', { width: 10, background: { scale: 1 } }).mask).toEqual({
      minX: 0,
      minY: -1,
      maxX: 10,
      maxY: 0,
    });
    expect(lay('abc').mask).toBeUndefined();
  });
});

describe('dynamic column count (M2-07 part 3)', () => {
  const count = (contents: string, height: number) =>
    dynamicColumnCount(parseMText(contents, base), mono, {
      height: 1,
      width: 0,
      attachment: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
      columns: { width: 4, gutter: 1, height },
    });

  it('counts the columns the text flows into', () => {
    // Lines are 5/3 apart: a column 4 high takes three lines (baselines 1, 2.67, 4.33 > 4: two).
    expect(count('a', 4)).toBe(1);
    expect(count('a\\Pb', 4)).toBe(1);
    expect(count('a\\Pb\\Pc', 4)).toBe(2);
    expect(count('a\\Pb\\Pc\\Pd\\Pe', 4)).toBe(3);
  });

  it('counts manual heights, the columns past them as tall as `height` (M2-26)', () => {
    const six = parseMText('a\\Pb\\Pc\\Pd\\Pe\\Pf', base);
    const manual = (heights: readonly number[]) =>
      dynamicColumnCount(six, mono, {
        height: 1,
        width: 0,
        attachment: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
        columns: { width: 4, gutter: 1, height: 4, heights },
      });
    expect(manual([])).toBe(3);
    // Two lines, then one in each column 2 high, then two in a column 4 high.
    expect(manual([4, 2, 2])).toBe(4);
  });

  it('counts the columns breaks start', () => {
    expect(count('a\\Nb\\Nc', 100)).toBe(3);
  });

  it('reports the columns used in the layout', () => {
    const l = lay('a\\Nb', {
      columns: { type: 'static', count: 3, width: 4, gutter: 1, height: 9 },
    });
    expect(l.columnsUsed).toBe(2);
    expect(lay('a').columnsUsed).toBeUndefined();
  });
});
