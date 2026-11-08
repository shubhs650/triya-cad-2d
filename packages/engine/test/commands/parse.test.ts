// M2-01 parser tables: what the command line makes of typed numbers, angles, coordinates, point
// modifiers and keywords, as AutoCAD 2024 reads them (Help: "Enter Coordinates", "Point Filters",
// "Offset From Temporary Reference Points", "Prompts with Options").
import { describe, expect, it } from 'vitest';
import {
  formatPrompt,
  keywordShortcut,
  matchKeyword,
  parseAngle,
  parseCoordinate,
  parseNumber,
  parsePointModifier,
  prompts,
} from '../../src/index';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('parseNumber', () => {
  it.each([
    ['10', 10],
    ['-2.5', -2.5],
    ['.5', 0.5],
    ['10.', 10],
    ['1e3', 1000],
    ['2.5E-1', 0.25],
    ['12.5*2-1', 24],
    ['(1+2)*3', 9],
    ['1+2*3', 7],
    ['-(4/2)', -2],
    ['10/4', 2.5],
    ['  7 ', 7],
    ['--3', 3],
  ])('%s is %d', (text, value) => {
    expect(parseNumber(text)).toBeCloseTo(value, 12);
  });

  it.each(['', 'abc', '1/0', '(1+2', '1+', '2**3', '1,2', '10x', '()'])(
    '%j is not a number',
    (text) => {
      expect(parseNumber(text)).toBeUndefined();
    },
  );
});

describe('parseAngle', () => {
  it.each([
    ['45', deg(45)],
    ['-90', deg(-90)],
    ['30+15', deg(45)],
    ["45d30'", deg(45.5)],
    ['10d0\'36"', deg(10.01)],
    ['-45d', deg(-45)],
    ['1.5r', 1.5],
    ['100g', Math.PI / 2],
  ])('%s', (text, radians) => {
    expect(parseAngle(text)).toBeCloseTo(radians, 12);
  });

  it('measures from ANGBASE, clockwise when ANGDIR is 1', () => {
    expect(parseAngle('30', { base: deg(90), clockwise: false })).toBeCloseTo(deg(120), 12);
    expect(parseAngle('30', { base: deg(90), clockwise: true })).toBeCloseTo(deg(60), 12);
  });

  it.each(['', 'north', '45dd', 'r'])('%j is not an angle', (text) => {
    expect(parseAngle(text)).toBeUndefined();
  });
});

describe('parseCoordinate', () => {
  const last = { x: 10, y: 20 };
  it.each([
    ['3,4', { x: 3, y: 4 }],
    ['3,4,5', { x: 3, y: 4 }],
    [' -1.5 , 2 ', { x: -1.5, y: 2 }],
    ['2*5,1+1', { x: 10, y: 2 }],
    ['@3,4', { x: 13, y: 24 }],
    ['@', { x: 10, y: 20 }],
    ['@0,0', { x: 10, y: 20 }],
    ['#3,4', { x: 3, y: 4 }],
    ['*3,4', { x: 3, y: 4 }],
    ['10<90', { x: 0, y: 10 }],
    ['@100<45', { x: 10 + 100 * Math.SQRT1_2, y: 20 + 100 * Math.SQRT1_2 }],
    ['@5<180', { x: 5, y: 20 }],
  ])('%s', (text, point) => {
    const p = parseCoordinate(text, { lastPoint: last });
    expect(p).not.toBe('invalid');
    expect((p as { x: number }).x).toBeCloseTo(point.x, 9);
    expect((p as { y: number }).y).toBeCloseTo(point.y, 9);
  });

  it('takes @ from the origin before any point is given', () => {
    expect(parseCoordinate('@3,4')).toEqual({ x: 3, y: 4 });
  });

  it('turns polar angles by ANGBASE and ANGDIR', () => {
    const p = parseCoordinate('10<0', { angles: { base: deg(90), clockwise: false } });
    expect((p as { x: number }).x).toBeCloseTo(0, 12);
    expect((p as { y: number }).y).toBeCloseTo(10, 12);
  });

  it.each(['3,', ',4', '1,2,3,4', 'a,b', '10<', '<45', '1<2<3', '@abc', '@10'])(
    '%j is an invalid coordinate',
    (text) => {
      expect(parseCoordinate(text, { lastPoint: last })).toBe('invalid');
    },
  );

  it.each(['10', 'Close', ''])('%j is not a coordinate', (text) => {
    expect(parseCoordinate(text)).toBeUndefined();
  });
});

describe('parsePointModifier', () => {
  it.each([
    ['FROM', { kind: 'from' }],
    ['fro', { kind: 'from' }],
    ['M2P', { kind: 'm2p' }],
    ['mtp', { kind: 'm2p' }],
    ['.x', { kind: 'filter', take: 'x' }],
    ['.Y', { kind: 'filter', take: 'y' }],
    ['.xy', { kind: 'filter', take: 'xy' }],
    ['.xz', { kind: 'filter', take: 'x' }],
    ['.yz', { kind: 'filter', take: 'y' }],
    ['.z', { kind: 'filter', take: '' }],
  ])('%s', (text, modifier) => {
    expect(parsePointModifier(text)).toEqual(modifier);
  });

  it.each(['FR', 'MID', '.', '.w', 'x'])('%j is no modifier', (text) => {
    expect(parsePointModifier(text)).toBeUndefined();
  });
});

describe('keywords', () => {
  const options = ['Undo', 'Close', 'eXit', 'LAst', 'Cancel'];

  it.each([
    ['Undo', 'U'],
    ['eXit', 'X'],
    ['LAst', 'LA'],
    ['center', 'CENTER'],
  ])('%s is typed %s', (keyword, shortcut) => {
    expect(keywordShortcut(keyword)).toBe(shortcut);
  });

  it.each([
    ['u', 'Undo'],
    ['UND', 'Undo'],
    ['c', 'Close'],
    ['clo', 'Close'],
    ['x', 'eXit'],
    ['ex', 'eXit'],
    ['EXIT', 'eXit'],
    ['la', 'LAst'],
    ['last', 'LAst'],
    ['canc', 'Cancel'],
  ])('%s picks %s', (typed, keyword) => {
    expect(matchKeyword(typed, options)).toBe(keyword);
  });

  it.each(['', 'e', 'l', 'undone', 'z'])('%j picks nothing', (typed) => {
    expect(matchKeyword(typed, options)).toBeUndefined();
  });
});

describe('formatPrompt', () => {
  it('lays out options and default as AutoCAD does', () => {
    expect(formatPrompt(prompts.point({ message: 'Specify first point' }))).toBe(
      'Specify first point:',
    );
    expect(
      formatPrompt(prompts.point({ message: 'Specify next point or', options: ['Close', 'Undo'] })),
    ).toBe('Specify next point or [Close/Undo]:');
    expect(
      formatPrompt(
        prompts.distance({
          message: 'Specify radius of circle or',
          options: ['Diameter'],
          default: { kind: 'distance', value: 10 },
        }),
      ),
    ).toBe('Specify radius of circle or [Diameter] <10.0000>:');
    expect(
      formatPrompt(
        prompts.integer({
          message: 'Enter number of sides',
          default: { kind: 'number', value: 4 },
        }),
      ),
    ).toBe('Enter number of sides <4>:');
    expect(
      formatPrompt(
        prompts.keyword({
          message: 'Enter an option',
          options: ['Yes', 'No'],
          default: { kind: 'keyword', keyword: 'No' },
        }),
      ),
    ).toBe('Enter an option [Yes/No] <No>:');
    expect(
      formatPrompt(prompts.real({ message: 'Scale', default: { kind: 'number', value: 0.5 } }), 2),
    ).toBe('Scale <0.50>:');
  });
});
