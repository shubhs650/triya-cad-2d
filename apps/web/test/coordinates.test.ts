// M2-20: the status bar's coordinates in the drawing's units (LUNITS, LUPREC), as AutoCAD
// shows them, or always decimal (the Settings "Coordinates" choice).
import { describe, expect, it } from 'vitest';
import type { ChangeSet } from '@triya/engine';
import { coordinateText, editedHeader } from '../src/coordinates';

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

  // M3-06 part 7: the current UCS's coordinates, model space's or (in a layout) paper space's.
  it('shows the coordinates in the current UCS', () => {
    const ucs = new Map<string, unknown>([
      ['$UCSORG', { x: 10, y: 10, z: 0 }],
      ['$UCSXDIR', { x: 0, y: 1, z: 0 }],
      ['$UCSYDIR', { x: -1, y: 0, z: 0 }],
    ]);
    expect(coordinateText({ x: 13, y: 14 }, ucs, 'drawing')).toBe('4.0000, -3.0000, 0.0000');
    expect(coordinateText({ x: 13, y: 14 }, ucs, 'drawing', true)).toBe('13.0000, 14.0000, 0.0000');
  });

  it("'decimal' shows LUPREC decimal places whatever LUNITS says", () => {
    expect(coordinateText({ x: 126.5, y: 36 }, header(4, 3), 'decimal')).toBe(
      '126.500, 36.000, 0.000',
    );
  });
});

// M2-73: the status bar follows units changed while the drawing is open (SETVAR LUNITS, UNITS,
// and their undo), so it reads the header as the drawing's change log leaves it.
describe('the header as edited', () => {
  const opened: [string, unknown][] = [
    ['$LUNITS', 2],
    ['$LUPREC', 4],
    ['$LWDISPLAY', 0],
  ];
  const set = (name: string, before: unknown, after: unknown): ChangeSet =>
    ({ header: [{ name, before, after }] }) as ChangeSet;

  it('is the header as opened when nothing changed it', () => {
    expect([...editedHeader(opened, [])]).toEqual(opened);
    expect([...editedHeader(undefined, [])]).toEqual([]);
  });

  it('takes each change in order, the last one standing', () => {
    const header = editedHeader(opened, [
      { entities: {} } as ChangeSet,
      set('$LUNITS', 2, 4),
      set('$LUPREC', 4, 3),
      set('$LUNITS', 4, 3),
    ]);
    expect(header.get('$LUNITS')).toBe(3);
    expect(header.get('$LUPREC')).toBe(3);
    expect(coordinateText({ x: 126.5, y: 0 }, header, 'drawing')).toBe(
      `10'-6.500", 0'-0.000", 0'-0.000"`,
    );
  });

  it('an undone change takes the value back, a removed entry is gone', () => {
    const header = editedHeader(opened, [
      set('$LUNITS', 2, 4),
      set('$LUNITS', 4, 2),
      set('$LWDISPLAY', 0, undefined),
    ]);
    expect(header.get('$LUNITS')).toBe(2);
    expect(header.has('$LWDISPLAY')).toBe(false);
    expect(coordinateText({ x: 1, y: 2 }, header, 'drawing')).toBe('1.0000, 2.0000, 0.0000');
  });
});
