// M8-01: the ASME B16.5 tables against values published elsewhere, and the rules the standard
// sets on them (README.md, "Provenance", lists the sources and how disagreements were settled).
import { describe, expect, it } from 'vitest';
import {
  B16_5_CLASSES,
  B16_5_SIZES,
  B16_5_TABLES,
  FLANGE_TYPES,
  b165Flange,
  b165Sizes,
  npsLabel,
  pipeBore,
  pipeOutsideDiameter,
  type B165Class,
  type FlangeDimensions,
} from '../src/index';

/** "2-3/8" or "17" as a number. */
function inches(s: string | number): number {
  if (typeof s === 'number') return s;
  return s
    .split('-')
    .map((p) => (p.includes('/') ? Number(p.split('/')[0]) / Number(p.split('/')[1]) : Number(p)))
    .reduce((a, b) => a + b, 0);
}

const flange = (
  flangeClass: B165Class,
  nps: number,
  type: FlangeDimensions['spec']['type'] = 'WN',
) => b165Flange({ flangeClass, nps, type })!;

// engineeringtoolbox.com, "ASME/ANSI B16.5 Flanges and Bolt Dimensions - Class 150 to 2500"
// (read 2026-11-28): [class, NPS, O, bolts, bolt diameter, hole diameter, bolt circle], as
// printed there.
const BOLTING: readonly (readonly [B165Class, number, string, number, string, number, string])[] = [
  [150, 0.5, '3-1/2', 4, '1/2', 0.62, '2-3/8'],
  [150, 2, '6', 4, '5/8', 0.75, '4-3/4'],
  [150, 6, '11', 8, '3/4', 0.88, '9-1/2'],
  [150, 12, '19', 12, '7/8', 1, '17'],
  [150, 24, '32', 20, '1-1/4', 1.38, '29-1/2'],
  [300, 0.5, '3-3/4', 4, '1/2', 0.62, '2-5/8'],
  [300, 2, '6-1/2', 8, '5/8', 0.75, '5'],
  [300, 6, '12-1/2', 12, '3/4', 0.88, '10-5/8'],
  [300, 12, '20-1/2', 16, '1-1/8', 1.25, '17-3/4'],
  [300, 24, '36', 24, '1-1/2', 1.62, '32'],
  [400, 0.5, '3-3/4', 4, '1/2', 0.62, '2-5/8'],
  [400, 1, '4-7/8', 4, '5/8', 0.75, '3-1/2'],
  [400, 4, '10', 8, '7/8', 1, '7-7/8'],
  [400, 12, '20-1/2', 16, '1-1/4', 1.38, '17-3/4'],
  [400, 24, '36', 24, '1-3/4', 1.88, '32'],
  [600, 0.5, '3-3/4', 4, '1/2', 0.62, '2-5/8'],
  [600, 4, '10-3/4', 8, '7/8', 1, '8-1/2'],
  [600, 12, '22', 20, '1-1/4', 1.38, '19-1/4'],
  [600, 24, '37', 24, '1-7/8', 2, '33'],
  [900, 0.5, '4-3/4', 4, '3/4', 0.88, '3-1/4'],
  [900, 3, '9-1/2', 8, '7/8', 1, '7-1/2'],
  [900, 12, '24', 20, '1-3/8', 1.5, '21'],
  [900, 24, '41', 20, '2-1/2', 2.62, '35-1/2'],
  [1500, 0.5, '4-3/4', 4, '3/4', 0.88, '3-1/4'],
  [1500, 3, '10-1/2', 8, '1-1/8', 1.25, '8'],
  [1500, 12, '26-1/2', 16, '2', 2.12, '22-1/2'],
  [1500, 24, '46', 16, '3-1/2', 3.62, '39'],
  [2500, 0.5, '5-1/4', 4, '3/4', 0.88, '3-1/2'],
  [2500, 3, '12', 8, '1-1/4', 1.38, '9'],
  [2500, 12, '30', 12, '2-3/4', 2.88, '24-3/8'],
];

// Weld neck flanges: [class, NPS, tf, Y, X, A, R]. Classes 150 and 300 from API
// International's weld neck charts (apiint.com), 900 and 1500 from Thermometrics' charts
// (rtd.thermometricscorp.com, "Dimensions for Class 900/1500 Flanges").
const WELD_NECK: readonly (readonly [B165Class, number, number, number, number, number, number])[] =
  [
    [150, 0.5, 0.38, 1.81, 1.19, 0.84, 1.375],
    [150, 2, 0.69, 2.44, 3.06, 2.38, 3.625],
    [150, 6, 0.94, 3.44, 7.56, 6.63, 8.5],
    [150, 12, 1.19, 4.44, 14.38, 12.75, 15],
    [150, 24, 1.81, 5.94, 26.12, 24, 27.25],
    [300, 0.5, 0.5, 2, 1.5, 0.84, 1.375],
    [300, 2, 0.81, 2.69, 3.31, 2.38, 3.625],
    [300, 6, 1.38, 3.82, 8.12, 6.63, 8.5],
    [300, 12, 1.94, 5.06, 14.75, 12.75, 15],
    [300, 24, 2.69, 6.56, 27.62, 24, 27.25],
    [900, 3, 1.5, 4, 5, 3.5, 5],
    [900, 12, 3.12, 7.88, 16.5, 12.75, 15],
    [900, 24, 5.5, 11.5, 29.5, 24, 27.25],
    [1500, 0.5, 0.88, 2.38, 1.5, 0.84, 1.38],
    [1500, 3, 1.88, 4.62, 5.25, 3.5, 5],
    [1500, 12, 4.88, 11.12, 17.75, 12.75, 15],
    [1500, 24, 8, 16, 30, 24, 27.25],
  ];

describe('ASME B16.5 tables (M8-01)', () => {
  it.each(BOLTING)(
    'Class %i NPS %s: O, bolting and bolt circle as published',
    (c, nps, o, n, bolt, hole, w) => {
      const d = flange(c, nps);
      // The standard prints fractions as two decimals (2⅝ as 2.62): within 0.01.
      expect(d.outsideDiameter).toBeCloseTo(inches(o), 1.9);
      expect(d.bolting.count).toBe(n);
      expect(d.bolting.boltDiameter).toBe(inches(bolt));
      expect(d.bolting.holeDiameter).toBeCloseTo(hole, 1.9);
      expect(d.bolting.circleDiameter).toBeCloseTo(inches(w), 1.9);
    },
  );

  it.each(WELD_NECK)(
    'Class %i NPS %s weld neck: tf, Y, X, A, R as published',
    (c, nps, tf, y, x, a, r) => {
      const d = flange(c, nps);
      expect(d.thickness).toBeCloseTo(tf, 1.9);
      expect(d.hub!.length).toBeCloseTo(y, 1.9);
      expect(d.hub!.baseDiameter).toBeCloseTo(x, 1.9);
      expect(d.hub!.endDiameter).toBeCloseTo(a, 1.9);
      expect(d.raisedFace!.diameter).toBeCloseTo(r, 1.9);
    },
  );

  it('keeps the values where the sources disagreed as the majority has them', () => {
    // Class 900 NPS 16's bolt circle: 24¼ (Texas Flange, Thermometrics, engineeringtoolbox's
    // Class 900 page) over the 24½ of its bolting table.
    expect(flange(900, 16).bolting.circleDiameter).toBe(24.25);
    // Class 400 NPS 1's holes: ¾ (engineeringtoolbox, and Class 600, whose dimensions B16.5
    // gives Class 400 in this size) where Texas Flange prints ".075".
    expect(flange(400, 1).bolting.holeDiameter).toBe(0.75);
    // Class 300 NPS ½'s holes: 0.62 (Texas Flange, engineeringtoolbox) over apiint's 0.75.
    expect(flange(300, 0.5).bolting.holeDiameter).toBe(0.62);
    // Class 1500 NPS 18's weld neck length through hub: 12.88 (Texas Flange; it rises with
    // size) over Thermometrics' 12.00, which is under NPS 16's 12.25.
    expect(flange(1500, 18).hub!.length).toBe(12.88);
  });

  it('has every size B16.5 lists for each class, and no others', () => {
    const sizes = (c: B165Class) => b165Sizes(c, 'BL');
    const all = [...B16_5_SIZES];
    for (const c of [150, 300, 400, 600] as const) expect(sizes(c)).toEqual(all);
    // No NPS 3½ or 22 in Classes 900 and up; Class 2500 stops at NPS 12.
    expect(sizes(900)).toEqual(all.filter((n) => n !== 3.5 && n !== 22));
    expect(sizes(1500)).toEqual(all.filter((n) => n !== 3.5 && n !== 22));
    expect(sizes(2500)).toEqual(all.filter((n) => n <= 12 && n !== 3.5));
    expect(b165Flange({ flangeClass: 150, nps: 26, type: 'WN' })).toBeUndefined();
  });

  it('makes each type only where B16.5 does', () => {
    const upTo = (max: number, but: number[] = []) =>
      B16_5_SIZES.filter((n) => n <= max && !but.includes(n));
    // Slip-on: not in Class 2500, Class 1500 to NPS 2½.
    expect(b165Sizes(1500, 'SO')).toEqual(upTo(2.5));
    expect(b165Sizes(2500, 'SO')).toEqual([]);
    expect(b165Sizes(900, 'SO')).toEqual(upTo(24, [3.5, 22]));
    // Socket welding: NPS ½ to 3 (Class 1500 and 900 to 2½), not in Class 2500.
    for (const c of [150, 300, 400, 600] as const) expect(b165Sizes(c, 'SW')).toEqual(upTo(3));
    expect(b165Sizes(900, 'SW')).toEqual(upTo(2.5));
    expect(b165Sizes(1500, 'SW')).toEqual(upTo(2.5));
    expect(b165Sizes(2500, 'SW')).toEqual([]);
    // Threaded: Classes 1500 and 2500 to NPS 2½; no Class 400 or 600 NPS 22.
    expect(b165Sizes(1500, 'TH')).toEqual(upTo(2.5));
    expect(b165Sizes(2500, 'TH')).toEqual(upTo(2.5));
    expect(b165Sizes(600, 'TH')).toEqual(upTo(24, [22]));
    // Weld neck, lap joint and blind in every size of the class.
    for (const c of B16_5_CLASSES) {
      for (const type of ['WN', 'LJ', 'BL'] as const) {
        expect(b165Sizes(c, type)).toEqual(b165Sizes(c, 'BL'));
      }
    }
  });

  it('gives Class 400 under NPS 4 the Class 600 flange and Class 900 under NPS 3 the Class 1500', () => {
    for (const type of FLANGE_TYPES) {
      for (const nps of [0.5, 1, 2.5, 3.5]) {
        const four = b165Flange({ flangeClass: 400, nps, type });
        const six = b165Flange({ flangeClass: 600, nps, type });
        expect({ ...four, spec: undefined }).toEqual({ ...six, spec: undefined });
      }
      for (const nps of [0.5, 1.5, 2.5]) {
        const nine = b165Flange({ flangeClass: 900, nps, type });
        const fifteen = b165Flange({ flangeClass: 1500, nps, type });
        expect({ ...nine, spec: undefined }).toEqual({ ...fifteen, spec: undefined });
      }
    }
    expect(B16_5_TABLES[400][0]![0]).toBe(4);
    expect(B16_5_TABLES[900][0]![0]).toBe(3);
  });

  describe.each(B16_5_CLASSES.map((c) => [c] as const))('Class %i', (c) => {
    it('holds to B16.5 rules in every size', () => {
      for (const nps of b165Sizes(c, 'BL')) {
        const wn = flange(c, nps);
        const lj = flange(c, nps, 'LJ');
        const { count, holeDiameter, circleDiameter, boltDiameter } = wn.bolting;
        // Bolt counts are multiples of four; holes are 1/8 in. over the bolt.
        expect(count % 4).toBe(0);
        expect(holeDiameter - boltDiameter).toBeCloseTo(0.125, 1.9);
        // The holes clear the hub and the raised face, and stay inside the rim.
        const holeIn = (circleDiameter - holeDiameter) / 2;
        expect(wn.hub!.baseDiameter / 2).toBeLessThan(holeIn);
        expect(wn.raisedFace!.diameter / 2).toBeLessThan(holeIn);
        expect((circleDiameter + holeDiameter) / 2).toBeLessThan(wn.outsideDiameter / 2);
        // The hub tapers to the pipe; the bore is inside it.
        expect(wn.hub!.endDiameter).toBeCloseTo(pipeOutsideDiameter(nps)!, 1.9);
        expect(wn.hub!.endDiameter).toBeLessThan(wn.hub!.baseDiameter);
        expect(wn.bore!).toBeLessThan(wn.hub!.endDiameter);
        expect(wn.hub!.length).toBeGreaterThan(wn.thickness);
        // Raised face 1/16 in. in Classes 150 and 300, 1/4 in. above; none on a lap joint.
        expect(wn.raisedFace!.height).toBe(c <= 300 ? 0.06 : 0.25);
        expect(lj.raisedFace).toBeUndefined();
        expect(lj.thickness).toBeGreaterThanOrEqual(wn.thickness);
        expect(lj.bore!).toBeGreaterThan(wn.hub!.endDiameter);
        // A slip-on's bore takes the pipe.
        const so = b165Flange({ flangeClass: c, nps, type: 'SO' });
        if (so) expect(so.bore!).toBeGreaterThan(wn.hub!.endDiameter);
        const th = b165Flange({ flangeClass: c, nps, type: 'TH' });
        if (th) {
          expect(th.thread!.counterbore).toBeGreaterThan(th.thread!.diameter);
          // T counts the raised face, Y does not.
          expect(th.thread!.length).toBeLessThanOrEqual(
            th.hub!.length + th.raisedFace!.height + 0.011,
          );
        }
        const sw = b165Flange({ flangeClass: c, nps, type: 'SW' });
        if (sw) expect(sw.socket!.depth).toBeLessThan(sw.hub!.length + sw.thickness);
        // Sizes go up: a bigger size is bigger all round, but for Class 900 NPS 3, the first
        // size of its own table after the Class 1500 flanges it takes below.
        const next = b165Sizes(c, 'BL').find((n) => n > nps);
        if (next !== undefined && !(c === 900 && next === 3)) {
          const up = flange(c, next);
          expect(up.outsideDiameter).toBeGreaterThanOrEqual(wn.outsideDiameter);
          expect(up.bolting.circleDiameter).toBeGreaterThan(circleDiameter);
          expect(up.raisedFace!.diameter).toBeGreaterThan(wn.raisedFace!.diameter);
        }
      }
    });
  });

  it('bores weld neck flanges to the pipe schedule asked for', () => {
    // Standard wall: the B2 bore of B16.5's Class 150 and 300 charts, to two decimals.
    const b2: Record<number, number> = { 0.5: 0.62, 2: 2.07, 6: 6.07, 12: 12, 24: 23.25 };
    for (const [nps, bore] of Object.entries(b2)) {
      expect(flange(150, Number(nps)).bore).toBeCloseTo(bore, 1.9);
      expect(flange(300, Number(nps)).bore).toBeCloseTo(bore, 1.9);
    }
    // 4 in. schedule 80: 4.500 − 2 × 0.337; schedule 160: 4.500 − 2 × 0.531.
    expect(b165Flange({ flangeClass: 600, nps: 4, type: 'WN', schedule: '80' })!.bore).toBe(3.826);
    expect(b165Flange({ flangeClass: 600, nps: 4, type: 'WN', schedule: '160' })!.bore).toBe(3.438);
    expect(pipeBore(12, 'STD')).toBe(12);
    expect(pipeBore(12, '40')).toBe(11.938);
    // No schedule 20 in NPS 6: no such flange.
    expect(b165Flange({ flangeClass: 150, nps: 6, type: 'WN', schedule: '20' })).toBeUndefined();
    expect(flange(150, 6).spec.schedule).toBe('STD');
  });

  it('labels sizes as drafters write them', () => {
    expect([0.5, 0.75, 1, 1.25, 1.5, 2.5, 24].map(npsLabel)).toEqual([
      '½',
      '¾',
      '1',
      '1¼',
      '1½',
      '2½',
      '24',
    ]);
  });
});
