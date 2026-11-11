// The in-place MTEXT editor's edits on its spans (M2-07): offsets count UTF-16 units of text
// and one unit for each paragraph break, stack and field, as the editor's DOM does.
import { writeMText, type MTextSpan } from '@triya/text';
import { describe, expect, it } from 'vitest';
import {
  autoStack,
  formatAt,
  paragraphAt,
  formatRange,
  hasFormat,
  insertSpans,
  MEASUREMENT,
  mapParagraphs,
  measurementsWritten,
  withMeasurements,
  paragraphCodes,
  paragraphIndex,
  removeRange,
  toggleStack,
  unitsOf,
} from '../src/text-editor';

const t = (text: string, format = {}): MTextSpan => ({ type: 'text', text, format });
const br: MTextSpan = { type: 'break' };

describe('editor spans', () => {
  it('counts text by its characters and every other span as one unit', () => {
    expect(
      unitsOf([
        t('abc'),
        br,
        { type: 'stack', upper: '1', lower: '2', kind: 'fraction', format: {} },
      ]),
    ).toBe(5);
  });

  it('inserts into a run, merging what has its format', () => {
    expect(insertSpans([t('held')], 2, [t('XY')])).toEqual([t('heXYld')]);
    expect(insertSpans([t('ab')], 1, [t('U', { underline: true })])).toEqual([
      t('a'),
      t('U', { underline: true }),
      t('b'),
    ]);
    expect(insertSpans([t('ab')], 2, [br])).toEqual([t('ab'), br]);
  });

  it('removes a range across runs and breaks', () => {
    expect(removeRange([t('ab'), br, t('cd', { bold: true })], 1, 4)).toEqual([
      t('a'),
      t('d', { bold: true }),
    ]);
  });

  it('formats a range, splitting runs at its ends', () => {
    expect(formatRange([t('abcd')], 1, 3, { underline: true })).toEqual([
      t('a'),
      t('bc', { underline: true }),
      t('d'),
    ]);
    // An undefined value takes the format off (ByLayer colour, the style's height).
    expect(
      formatRange([t('ab', { color: { kind: 'aci', index: 1 } })], 0, 2, { color: undefined }),
    ).toEqual([t('ab')]);
  });

  it('says whether all of a range has a format, and the format typing at a point takes', () => {
    const s = [t('ab', { bold: true }), t('c')];
    expect(hasFormat(s, 0, 2, 'bold')).toBe(true);
    expect(hasFormat(s, 0, 3, 'bold')).toBe(false);
    expect(formatAt(s, 2)).toEqual({ bold: true });
    expect(formatAt(s, 3)).toEqual({});
    expect(formatAt(s, 0)).toEqual({ bold: true });
  });

  it('stacks selected text at its first separator, and unstacks a stack', () => {
    const r = toggleStack([t('x 1/2 y', { underline: true })], 2, 5);
    expect(r.spans).toEqual([
      t('x ', { underline: true }),
      { type: 'stack', upper: '1', lower: '2', kind: 'fraction', format: { underline: true } },
      t(' y', { underline: true }),
    ]);
    expect(r.caret).toBe(3);
    expect(toggleStack([t('3#4')], 0, 3).spans[0]).toMatchObject({ kind: 'diagonal' });
    expect(toggleStack([t('+1^-2')], 0, 5).spans[0]).toMatchObject({
      kind: 'tolerance',
      upper: '+1',
      lower: '-2',
    });
    expect(toggleStack([t('none')], 0, 4).spans).toEqual([t('none')]);
    const back = toggleStack(r.spans, 2, 3);
    expect(back.spans).toEqual([t('x 1/2 y', { underline: true })]);
    expect(back.caret).toBe(5);
  });
});

describe('AutoStack', () => {
  const stack = (upper: string, lower: string, kind: string, format = {}): MTextSpan =>
    ({ type: 'stack', upper, lower, kind, format }) as MTextSpan;

  it('stacks numbers around / as a diagonal fraction when a space follows', () => {
    expect(autoStack([t('Gap 1/2 ')], 8)).toEqual({
      spans: [t('Gap '), stack('1', '2', 'diagonal'), t(' ')],
      caret: 6,
    });
    expect(autoStack([t('3#4 more')], 4)).toEqual({
      spans: [stack('3', '4', 'diagonal'), t(' more')],
      caret: 2,
    });
    expect(autoStack([t('+0.1^0.05 ', { underline: true })], 10)?.spans).toEqual(
      [
        t('+'),
        stack('0.1', '0.05', 'tolerance', { underline: true }),
        t(' ', { underline: true }),
      ].map((s, i) => (i === 0 ? t('+', { underline: true }) : s)),
    );
  });

  it('leaves anything else', () => {
    expect(autoStack([t('a/b ')], 4)).toBeUndefined();
    expect(autoStack([t('1/2')], 3)).toBeUndefined();
    expect(autoStack([t('x1/2 ')], 5)).toBeUndefined();
    expect(autoStack([t('1/ 2 ')], 5)).toBeUndefined();
  });
});

describe('paragraph values', () => {
  it("is the first paragraph's, then each break's", () => {
    const spans: MTextSpan[] = [
      t('ab'),
      { type: 'break', paragraph: ['xqc'] },
      t('cd'),
      { type: 'break' },
      t('e'),
    ];
    expect(paragraphAt(spans, ['xqr'], 1)).toEqual(['xqr']);
    expect(paragraphAt(spans, ['xqr'], 4)).toEqual(['xqc']);
    expect(paragraphAt(spans, ['xqr'], 7)).toEqual([]);
  });
});

describe('paragraphs for the ruler (M2-07 part 3)', () => {
  const spans: MTextSpan[] = [
    t('ab'),
    { type: 'break', paragraph: ['qc'] },
    t('cd'),
    { type: 'break', end: 'column' },
    t('e'),
  ];

  it('finds the paragraph of an offset', () => {
    expect([0, 2, 3, 5, 6, 7].map((at) => paragraphIndex(spans, at))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('lists each paragraph`s values', () => {
    expect(paragraphCodes(spans, ['l1'])).toEqual([['l1'], ['qc'], []]);
  });

  it('maps the values of a range of paragraphs, keeping column breaks', () => {
    const r = mapParagraphs(spans, ['l1'], 1, 2, (c) => [...c, 'i2']);
    expect(r.first).toEqual(['l1']);
    expect(r.spans).toEqual([
      t('ab'),
      { type: 'break', paragraph: ['qc', 'i2'] },
      t('cd'),
      { type: 'break', end: 'column', paragraph: ['i2'] },
      t('e'),
    ]);
    expect(mapParagraphs(spans, ['l1'], 0, 0, () => []).first).toEqual([]);
    expect(mapParagraphs(spans, [], 1, 1, () => []).spans[1]).toEqual({ type: 'break' });
  });
});

describe("a dimension's measurement in the editor (M2-31 part 2)", () => {
  const m = (format = {}): MTextSpan => ({ type: 'field', code: MEASUREMENT, format });

  it('makes each <> an atom of one unit, keeping the text around it', () => {
    const bold = { bold: true };
    expect(withMeasurements([t('2X <> TYP', bold), br, t('<>')])).toEqual([
      t('2X ', bold),
      m(bold),
      t(' TYP', bold),
      br,
      m(),
    ]);
    expect(unitsOf(withMeasurements([t('<> TYP')]))).toBe(5);
    expect(withMeasurements([t('no measurement')])).toEqual([t('no measurement')]);
  });

  it('writes an atom back as <>', () => {
    const spans = withMeasurements([t('2X <> TYP')]);
    expect(
      measurementsWritten(
        writeMText(spans, { name: 'txt', kind: 'shx', bold: false, italic: false }),
      ),
    ).toBe('2X <> TYP');
    expect(measurementsWritten('%<\\AcVar Date>%')).toBe('%<\\AcVar Date>%');
  });
});
