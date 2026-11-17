// The in-place MTEXT editor's edits on its spans (M2-07): offsets count UTF-16 units of text
// and one unit for each paragraph break, stack and field, as the editor's DOM does.
import { writeMText, type MTextSpan } from '@triya/text';
import { describe, expect, it } from 'vitest';
import {
  autoStack,
  cellAhead,
  cellMoveFor,
  fieldAsText,
  formatAt,
  lineEdited,
  lineFieldAt,
  lineParts,
  lineShown,
  lineSplit,
  lineValue,
  markField,
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

describe('table cell moves (M4-05 part 2)', () => {
  const two = [t('ab'), br, t('cd')];
  it('moves on Tab and Shift+Tab wherever the caret is', () => {
    expect(cellMoveFor('Tab', false, two, 1, 1)).toBe('next');
    expect(cellMoveFor('Tab', true, two, 1, 3)).toBe('previous');
  });

  it('moves on an arrow only from the edge of the text, with nothing selected', () => {
    expect(cellMoveFor('ArrowLeft', false, two, 0, 0)).toBe('left');
    expect(cellMoveFor('ArrowLeft', false, two, 1, 1)).toBeUndefined();
    expect(cellMoveFor('ArrowRight', false, two, 5, 5)).toBe('right');
    expect(cellMoveFor('ArrowRight', false, two, 4, 4)).toBeUndefined();
    expect(cellMoveFor('ArrowUp', false, two, 2, 2)).toBe('up');
    expect(cellMoveFor('ArrowUp', false, two, 4, 4)).toBeUndefined();
    expect(cellMoveFor('ArrowDown', false, two, 4, 4)).toBe('down');
    expect(cellMoveFor('ArrowDown', false, two, 1, 1)).toBeUndefined();
    expect(cellMoveFor('ArrowLeft', false, two, 0, 2)).toBeUndefined();
    expect(cellMoveFor('ArrowLeft', true, two, 0, 0)).toBeUndefined();
    expect(cellMoveFor('ArrowDown', false, [], 0, 0)).toBe('down');
    expect(cellMoveFor('a', false, two, 0, 0)).toBeUndefined();
  });
});

describe('keys typed while the editor moves to the next cell (M4-05 part 7)', () => {
  const k = (key: string, shift = false) => ({ key, shift });
  it('types the characters, Backspace and Enter in order, merging the characters', () => {
    expect(cellAhead([k('N'), k('3'), k('Backspace'), k('4'), k('Enter'), k('x')])).toEqual({
      ops: [
        { kind: 'text', text: 'N3' },
        { kind: 'backspace' },
        { kind: 'text', text: '4' },
        { kind: 'break' },
        { kind: 'text', text: 'x' },
      ],
      rest: [],
    });
  });

  it('stops at Tab, Shift+Tab or Esc, the keys after it left for the cell it leads to', () => {
    expect(cellAhead([k('a'), k('Tab'), k('b'), k('Tab', true)])).toEqual({
      ops: [
        { kind: 'text', text: 'a' },
        { kind: 'move', move: 'next' },
      ],
      rest: [k('b'), k('Tab', true)],
    });
    expect(cellAhead([k('Tab', true), k('c')])).toEqual({
      ops: [{ kind: 'move', move: 'previous' }],
      rest: [k('c')],
    });
    expect(cellAhead([k('d'), k('Escape'), k('e')])).toEqual({
      ops: [{ kind: 'text', text: 'd' }, { kind: 'cancel' }],
      rest: [],
    });
  });

  it('ends the editing at Ctrl+Enter', () => {
    expect(cellAhead([k('f'), { key: 'Enter', shift: false, ctrl: true }, k('g')])).toEqual({
      ops: [{ kind: 'text', text: 'f' }, { kind: 'finish' }],
      rest: [],
    });
  });

  it('drops keys that do not type, such as an arrow, Shift alone or a Ctrl chord', () => {
    expect(
      cellAhead([k('Shift'), k('ArrowLeft'), { key: 'b', shift: false, ctrl: true }, k('F', true)]),
    ).toEqual({
      ops: [{ kind: 'text', text: 'F' }],
      rest: [],
    });
  });
});

// M4-10 part 4: Edit Field marks a field for the Field dialog; Convert Field to Text keeps its
// value as text. TEXT's line editor holds fields too, each one atom shown by its value.
describe('fields in the editors', () => {
  const f = (code: string, format = {}): MTextSpan => ({ type: 'field', code, format });

  it('marks the field at an offset for Edit Field, or turns it into its value', () => {
    const spans = [t('Rev '), f('\\AcVar Date', { bold: true }), t('!')];
    expect(markField(spans, 4, '\u0000EDIT')).toEqual([
      t('Rev '),
      f('\u0000EDIT\\AcVar Date', { bold: true }),
      t('!'),
    ]);
    expect(fieldAsText(spans, 4, '2026')).toEqual([t('Rev '), t('2026', { bold: true }), t('!')]);
    // No field there: as they were.
    expect(markField(spans, 1, '\u0000EDIT')).toEqual(spans);
    expect(fieldAsText(spans, 5, 'x')).toEqual(spans);
  });

  const code = '\\AcVar Date \\f "yyyy"';
  const fields = { [code]: '2020' };
  const parts = lineParts(`Rev %<${code}>% A`, fields);

  it('reads a line into text and fields, shown by their values', () => {
    expect(parts).toEqual([{ text: 'Rev ' }, { code, value: '2020' }, { text: ' A' }]);
    expect(lineShown(parts)).toBe('Rev 2020 A');
    expect(lineValue(parts)).toBe(`Rev %<${code}>% A`);
    // Nested object ids stay in their field; a field with no value shows ----.
    const obj = '\\AcObjProp Object(%<\\_ObjId 2A>%).Area';
    expect(lineParts(`%<${obj}>%`, {})).toEqual([{ code: obj, value: '----' }]);
    // Without fields the line is its text, codes and all.
    expect(lineParts(`a %<${code}>%`, undefined)).toEqual([{ text: `a %<${code}>%` }]);
    expect(lineParts('', fields)).toEqual([]);
  });

  it('keeps fields the typing does not touch', () => {
    // Typed before, after and next to the field.
    expect(lineValue(lineEdited(parts, 'Rev. 2020 A', 4))).toBe(`Rev. %<${code}>% A`);
    expect(lineValue(lineEdited(parts, 'Rev 2020 AB', 11))).toBe(`Rev %<${code}>% AB`);
    expect(lineValue(lineEdited(parts, 'Rev 2020x A', 9))).toBe(`Rev %<${code}>%x A`);
    expect(lineValue(lineEdited(parts, 'Rev x2020 A', 5))).toBe(`Rev x%<${code}>% A`);
    // A character like the field's own next to it.
    expect(lineValue(lineEdited(parts, 'Rev 20200 A', 9))).toBe(`Rev %<${code}>%0 A`);
    expect(lineValue(lineEdited(parts, 'Rev 22020 A', 5))).toBe(`Rev 2%<${code}>% A`);
  });

  it('deletes a field whole when the typing reaches into it', () => {
    // Backspace at its end, Delete at its start, typing inside, a selection over it.
    expect(lineValue(lineEdited(parts, 'Rev 202 A', 7))).toBe('Rev  A');
    expect(lineValue(lineEdited(parts, 'Rev 020 A', 4))).toBe('Rev  A');
    expect(lineValue(lineEdited(parts, 'Rev 20x20 A', 7))).toBe('Rev x A');
    expect(lineValue(lineEdited(parts, 'ReB', 3))).toBe('ReB');
  });

  it('splits a line at a place, a field across it before', () => {
    expect(lineSplit(parts, 2)).toEqual([[{ text: 'Re' }], [{ text: 'v ' }, parts[1], parts[2]]]);
    expect(lineSplit(parts, 6)).toEqual([[parts[0], parts[1]], [parts[2]]]);
    expect(lineSplit(parts, 4)).toEqual([[parts[0]], [parts[1], parts[2]]]);
    expect(lineSplit(parts, 10)).toEqual([parts, []]);
  });

  it('finds the field at a place in the line', () => {
    expect(lineFieldAt(parts, 3)).toBeUndefined();
    expect(lineFieldAt(parts, 4)).toEqual({ index: 1, start: 4, end: 8 });
    expect(lineFieldAt(parts, 7)).toEqual({ index: 1, start: 4, end: 8 });
    expect(lineFieldAt(parts, 8)).toBeUndefined();
  });
});
