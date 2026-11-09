// M2-20: the status bar's coordinates in the drawing's units (LUNITS, LUPREC), as AutoCAD
// shows them, or always decimal (the Settings "Coordinates" choice).
import { describe, expect, it } from 'vitest';
import { coordinateText } from '../src/coordinates';

const header = (lunits: number, luprec: number) =>
  new Map<string, unknown>([
    ['$LUNITS', lunits],
    ['$LUPREC', luprec],
  ]);

describe('status bar coordinates', () => {
  it('decimal drawings show LUPREC places, Z included', () => {
    expect(coordinateText({ x: 12.5, y: -3 }, header(2, 4), 'drawing')).toBe(
      '12.5000, -3.0000, 0.0000',
    );
    expect(coordinateText({ x: 1, y: 2 }, new Map(), 'drawing')).toBe('1.0000, 2.0000, 0.0000');
  });

  it('architectural drawings show feet and fractional inches to 1/2^LUPREC', () => {
    expect(coordinateText({ x: 126.5, y: 36 }, header(4, 4), 'drawing')).toBe(
      `10'-6 1/2", 3'-0", 0'-0"`,
    );
  });

  it('engineering, fractional and scientific drawings follow LUNITS', () => {
    expect(coordinateText({ x: 126.5, y: 0 }, header(3, 2), 'drawing')).toBe(
      `10'-6.50", 0'-0.00", 0'-0.00"`,
    );
    expect(coordinateText({ x: 2.25, y: 0 }, header(5, 3), 'drawing')).toBe('2 1/4, 0, 0');
    expect(coordinateText({ x: 1500, y: 0 }, header(1, 2), 'drawing')).toBe(
      '1.50E+03, 0.00E+00, 0.00E+00',
    );
  });

  it("'decimal' shows LUPREC decimal places whatever LUNITS says", () => {
    expect(coordinateText({ x: 126.5, y: 36 }, header(4, 3), 'decimal')).toBe(
      '126.500, 36.000, 0.000',
    );
  });
});
