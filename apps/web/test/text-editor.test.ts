// The in-place MTEXT editor's edits on its spans (M2-07): offsets count UTF-16 units of text
// and one unit for each paragraph break, stack and field, as the editor's DOM does.
import type { MTextSpan } from '@triya/text';
import { describe, expect, it } from 'vitest';
import {
  autoStack,
  formatAt,
  paragraphAt,
  formatRange,
  hasFormat,
  insertSpans,
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
