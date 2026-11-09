import { describe, expect, it } from 'vitest';
import { ContentStream, pdfNumber } from '../src/content';

describe('pdfNumber', () => {
  it('writes reals with at most four decimals, no exponent and no negative zero', () => {
    expect(pdfNumber(1)).toBe('1');
    expect(pdfNumber(0.5)).toBe('0.5');
    expect(pdfNumber(1 / 3)).toBe('0.3333');
    expect(pdfNumber(-0.00001)).toBe('0');
    expect(pdfNumber(1e-7)).toBe('0');
    expect(pdfNumber(123456.78901)).toBe('123456.789');
    expect(() => pdfNumber(2.5e21)).toThrow(RangeError);
    expect(() => pdfNumber(NaN)).toThrow(RangeError);
  });
});

describe('ContentStream', () => {
  it('writes the graphics state once while it does not change', () => {
    const cs = new ContentStream();
    cs.lineWidth(1).lineWidth(1).strokeColor([255, 0, 0]).strokeColor([255, 0, 0]);
    cs.lineCap(1).lineCap(1).lineJoin(2).lineJoin(2).dash([3, 1]).dash([3, 1]);
    cs.graphicsState('GSa500').graphicsState('GSa500');
    expect(cs.toString()).toBe('1 w\n1 0 0 RG\n1 J\n2 j\n[3 1] 0 d\n/GSa500 gs\n');
  });

  it('writes equal channels as DeviceGray and others as DeviceRGB', () => {
    const cs = new ContentStream();
    cs.fillColor([0, 0, 0]).strokeColor([128, 128, 128]).fillColor([0, 128, 255]);
    expect(cs.toString()).toBe('0 g\n0.502 G\n0 0.502 1 rg\n');
  });

  it('forgets what was set inside save once restored', () => {
    const cs = new ContentStream();
    cs.lineWidth(1).save().lineWidth(2).restore().lineWidth(1).lineWidth(2);
    expect(cs.toString()).toBe('1 w\nq\n2 w\nQ\n2 w\n');
    expect(cs.depth).toBe(0);
    expect(() => cs.restore()).toThrow('restore without save');
  });

  it('writes path construction and painting operators', () => {
    const cs = new ContentStream();
    cs.moveTo(0, 0).lineTo(10, 0).curveTo(1, 2, 3, 4, 5, 6).closePath().stroke();
    cs.rect(0, 0, 5, 5).fill().rect(1, 1, 2, 2).fill(true).rect(0, 0, 1, 1).clip(true);
    expect(cs.toString().split('\n')).toEqual([
      '0 0 m',
      '10 0 l',
      '1 2 3 4 5 6 c',
      'h',
      'S',
      '0 0 5 5 re',
      'f',
      '1 1 2 2 re',
      'f*',
      '0 0 1 1 re',
      'W* n',
      '',
    ]);
    expect(new ContentStream().toString()).toBe('');
  });

  it('writes text objects of glyph runs with Identity-H codes and TJ adjustments (M2-16 part 3)', () => {
    const cs = new ContentStream();
    cs.text('F1', []);
    expect(cs.toString()).toBe('');
    cs.text('F1', [
      { m: { a: 10, b: 0, c: 0, d: 10, e: 72, f: 144.5 }, show: [{ code: 1 }, { code: 0x2a }] },
      {
        m: { a: 0, b: 10, c: -10, d: 0, e: 0, f: 0 },
        show: [{ code: 3 }, -250, { code: 300 }, 12.5],
      },
    ]);
    expect(cs.toString().split('\n')).toEqual([
      'BT',
      '/F1 1 Tf',
      '10 0 0 10 72 144.5 Tm',
      '[<0001002A>] TJ',
      '0 10 -10 0 0 0 Tm',
      '[<0003> -250 <012C> 12.5] TJ',
      'ET',
      '',
    ]);
  });
});
