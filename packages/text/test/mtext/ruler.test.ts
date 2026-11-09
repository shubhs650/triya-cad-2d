// The MTEXT editor's ruler (M2-07 part 3): indents and tab stops read from a paragraph's `\p`
// values and written back as one value, in the MTEXT's height units.
import { describe, expect, it } from 'vitest';
import {
  contentOf,
  parseMText,
  rulerOf,
  withRuler,
  writeMText,
  type MTextBase,
  type MTextRuler,
} from '../../src/index';

const base: MTextBase = {
  font: { name: 'txt', kind: 'shx', bold: false, italic: false },
  height: 2.5,
  widthFactor: 1,
  oblique: 0,
};
const none: MTextRuler = { indentFirst: 0, indentLeft: 0, tabs: [] };

describe('rulerOf', () => {
  it('reads indents and tabs through the chain', () => {
    expect(rulerOf([])).toEqual(none);
    expect(rulerOf(['xi-1,l2,t4,c8,r12', 'qc', 'i0.5'])).toEqual({
      indentFirst: 0.5,
      indentLeft: 2,
      tabs: [
        { at: 4, kind: 'left' },
        { at: 8, kind: 'center' },
        { at: 12, kind: 'right' },
      ],
    });
  });
});

describe('withRuler', () => {
  it('keeps the values when nothing changes', () => {
    const codes = ['qc', 'l2'];
    expect(withRuler(codes, rulerOf(codes))).toBe(codes);
  });

  it('appends the keys that differ, after the other values', () => {
    expect(withRuler(['qc'], { ...none, indentFirst: 1 })).toEqual(['qc', 'i1']);
    expect(
      withRuler([], {
        indentFirst: -1,
        indentLeft: 1.5,
        tabs: [
          { at: 8, kind: 'right' },
          { at: 3, kind: 'center' },
        ],
      }),
    ).toEqual(['i-1,l1.5,tc3,r8']);
  });

  it('replaces its own last value instead of piling values up', () => {
    let codes: readonly string[] = ['qr'];
    for (const l of [1, 2, 3]) codes = withRuler(codes, { ...none, indentLeft: l });
    expect(codes).toEqual(['qr', 'l3']);
    codes = withRuler(codes, { ...none, indentLeft: 3, tabs: [{ at: 5, kind: 'left' }] });
    expect(codes).toEqual(['qr', 'l3,t5']);
    expect(withRuler(codes, none)).toEqual(['qr']);
  });

  it('clears tab stops a carried value set', () => {
    const codes = withRuler(['qc,t4,8'], none);
    expect(codes).toEqual(['qc,t4,8', 'tz']);
    expect(rulerOf(codes).tabs).toEqual([]);
  });

  it('round-trips through writeMText and the parser', () => {
    const r: MTextRuler = { indentFirst: 0.75, indentLeft: 2, tabs: [{ at: 6, kind: 'center' }] };
    const first = withRuler([], r);
    const second = withRuler(['qc'], { ...r, tabs: [] });
    const contents = writeMText(
      [
        { type: 'text', text: 'one\ttwo', format: {} },
        { type: 'break', paragraph: second },
        { type: 'text', text: 'three', format: {} },
      ],
      base.font,
      first,
    );
    const doc = parseMText(contents, base);
    expect(doc.paragraphs.map((p) => rulerOf(p.codes ?? []))).toEqual([r, { ...r, tabs: [] }]);
    expect(contentOf(doc, base).paragraph).toEqual(first);
  });
});
