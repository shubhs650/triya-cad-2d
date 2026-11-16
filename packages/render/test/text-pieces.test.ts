// M3-12 part 7: an MTEXT laid out as the TEXT runs and strokes EXPLODE makes of it (AutoCAD Help,
// "EXPLODE (Command)": "Multiline Text: Explodes into text objects"), in the fonts loaded now,
// which the engine worker, having none, asks the canvas for.
import type { MTextGeometry, TextPiece, TextStyleRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { textMeasure, textPieces, type TextContext } from '../src/index';
import { fontBook } from './text-fonts';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const style = (handle: string, font: string): TextStyleRecord => ({
  handle,
  name: handle,
  font,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});
const STYLES = new Map([
  ['S1', style('S1', 'romans.shx')],
  ['V', { ...style('V', 'vert.shx'), flags: 4 }],
  ['NONE', style('NONE', 'not-loaded.shx')],
]);
const ctx: TextContext = { fonts: fontBook(), style: (h) => STYLES.get(h) };
const pieces = textPieces(ctx);

const mtext = (contents: string, extra: Partial<MTextGeometry> = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: 'S1',
  position: { x: 10, y: 20 },
  height: 2,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...extra,
});

const texts = (p: readonly TextPiece[]) =>
  p.filter((x): x is Extract<TextPiece, { kind: 'text' }> => x.kind === 'text');
const lines = (p: readonly TextPiece[]) =>
  p.filter((x): x is Extract<TextPiece, { kind: 'line' }> => x.kind === 'line');

describe('textPieces', () => {
  it('gives each line its run, from its baseline start, one line spacing apart', () => {
    const p = pieces(mtext('ONE\\PTWO'))!;
    expect(texts(p).map((t) => t.value)).toEqual(['ONE', 'TWO']);
    const [a, b] = texts(p);
    // Top left attached: the first baseline one cap height below the insertion point.
    expect(r6(a!.position.x)).toBe(10);
    expect(a!.position.y).toBeLessThan(20);
    // Single spacing is 5/3 of the height.
    expect(r6(a!.position.y - b!.position.y)).toBe(r6((5 / 3) * 2));
    expect([a!.height, a!.widthFactor, a!.oblique]).toEqual([2, 1, 0]);
    expect(a!.font).toBeUndefined();
  });

  it('splits runs at a format change, with their own height, width, oblique, colour and font', () => {
    const p = texts(pieces(mtext('A\\H3;B\\W0.5;C\\Q15;D\\C1;E\\ftestsans|b0|i0;F'))!);
    expect(p.map((t) => t.value)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(p.map((t) => t.height)).toEqual([2, 3, 3, 3, 3, 3]);
    expect(p.map((t) => t.widthFactor)).toEqual([1, 1, 0.5, 0.5, 0.5, 0.5]);
    expect(r6(p[3]!.oblique)).toBe(r6((15 * Math.PI) / 180));
    expect(p[4]!.color).toEqual({ kind: 'aci', index: 1 });
    expect(p[5]!.font).toMatchObject({ name: 'testsans', kind: 'ttf' });
    // Each run starts where the one before ends.
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.position.x).toBeGreaterThan(p[i - 1]!.position.x);
    }
  });

  it('turns underlines, fraction bars and the frame into lines, and the text with the MTEXT', () => {
    const p = pieces(mtext('\\LUNDER\\l 1\\S1/2;', { rotation: Math.PI / 2 }))!;
    expect(texts(p).map((t) => t.value)).toEqual(['UNDER', ' 1', '1', '2']);
    // Turned 90°: the lines' baselines run up, right of the insertion point (below the top).
    expect(texts(p).every((t) => r6(t.position.x) > 10)).toBe(true);
    // The underline and the fraction bar, both running up the turned baseline.
    expect(lines(p)).toHaveLength(2);
    for (const l of lines(p)) expect(r6(l.start.x)).toBe(r6(l.end.x));
    const framed = pieces(mtext('BOX', { background: { flags: 16, scale: 1.5 } }))!;
    expect(lines(framed)).toHaveLength(4);
  });

  it('leaves the colour ByBlock and ByLayer runs out, as the MTEXT draws them', () => {
    const p = texts(pieces(mtext('\\C0;A\\C256;B\\C5;C'))!);
    expect(p.map((t) => t.color)).toEqual([undefined, undefined, { kind: 'aci', index: 5 }]);
  });

  it('has nothing to give without the font, or for vertical text', () => {
    expect(pieces(mtext('A', { style: 'NONE' }))).toBeUndefined();
    expect(pieces(mtext('A', { style: 'V', direction: 3 }))).toBeUndefined();
    expect(pieces(mtext(''))).toEqual([]);
  });

  it('places runs so they span the width the text is measured at', () => {
    const g = mtext('WIDE TEXT');
    const [t] = texts(pieces(g)!);
    expect(r6(t!.position.x)).toBe(10);
    expect(textMeasure(ctx)(g)).toBeGreaterThan(0);
  });
});
