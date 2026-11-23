// M9-03: expressions of dimensional constraints and user parameters, as AutoCAD 2024 evaluates
// them (Help, "About Controlling Geometry With the Parameters Manager": operators, functions and
// constants supported in expressions).
import { describe, expect, it } from 'vitest';
import {
  evaluateExpression,
  expressionReferences,
  isValidParameterName,
  parseExpression,
  renameInExpression,
  type ExpressionResult,
} from '../src/index';

/** The value of `text` with `vars` as the named parameters, or the error message. */
function calc(text: string, vars: Record<string, number> = {}, lunits = 2): number | string {
  const r: ExpressionResult = evaluateExpression(text, (n) => vars[n], {
    lunits,
    random: () => 0.25,
  });
  return r.ok ? r.value : r.error;
}

describe('operators', () => {
  it('adds, subtracts, multiplies, divides, takes the modulo and the power', () => {
    expect(calc('1+2')).toBe(3);
    expect(calc('10 - 4')).toBe(6);
    expect(calc('3*4')).toBe(12);
    expect(calc('7/2')).toBe(3.5);
    expect(calc('7.5 % 2')).toBe(1.5);
    expect(calc('-7 % 3')).toBe(-1);
    expect(calc('2^10')).toBe(1024);
    expect(calc('.5*4')).toBe(2);
    expect(calc('1.5e2')).toBe(150);
    expect(calc('2E-1*10')).toBe(2);
  });

  it('evaluates parentheses first, then negation, exponents, * / %, + -', () => {
    expect(calc('1+2*3')).toBe(7);
    expect(calc('(1+2)*3')).toBe(9);
    expect(calc('((1+2)*(3+4))')).toBe(21);
    expect(calc('2*3^2')).toBe(18);
    expect(calc('10-4-3')).toBe(3);
    expect(calc('64/4/2')).toBe(8);
    expect(calc('10 % 4 * 3')).toBe(6);
    // Unary negation binds before the exponent in AutoCAD's order of evaluation.
    expect(calc('-2^2')).toBe(4);
    expect(calc('-(2^2)')).toBe(-4);
    expect(calc('--3')).toBe(3);
    expect(calc('+3')).toBe(3);
    expect(calc('2*-3')).toBe(-6);
    // Operators of equal precedence go left to right, the exponent too.
    expect(calc('2^3^2')).toBe(64);
  });

  it('ignores white space', () => {
    expect(calc('  ( 1 +\t2 ) *  3 ')).toBe(9);
  });
});

describe('functions and constants', () => {
  it('trigonometric functions take and give degrees', () => {
    // Ambiguity: AutoCAD's Help does not say. Angular parameters hold degrees (ang1 = 30), so
    // the drafter writes sin(ang1); d2r and r2d convert for formulas written in radians.
    expect(calc('sin(30)')).toBeCloseTo(0.5, 12);
    expect(calc('cos(60)')).toBeCloseTo(0.5, 12);
    expect(calc('tan(45)')).toBeCloseTo(1, 12);
    expect(calc('asin(0.5)')).toBeCloseTo(30, 12);
    expect(calc('acos(0.5)')).toBeCloseTo(60, 12);
    expect(calc('atan(1)')).toBeCloseTo(45, 12);
    expect(calc('sin(ang1)', { ang1: 90 })).toBe(1);
  });

  it('hyperbolic functions', () => {
    expect(calc('cosh(0)')).toBe(1);
    expect(calc('sinh(1)')).toBeCloseTo(Math.sinh(1), 12);
    expect(calc('tanh(1)')).toBeCloseTo(Math.tanh(1), 12);
    expect(calc('acosh(1)')).toBe(0);
    expect(calc('asinh(1)')).toBeCloseTo(Math.asinh(1), 12);
    expect(calc('atanh(0.5)')).toBeCloseTo(Math.atanh(0.5), 12);
  });

  it('roots, signs, rounding, logs and exponents', () => {
    expect(calc('sqrt(16)')).toBe(4);
    expect(calc('sign(-3)')).toBe(-1);
    expect(calc('sign(0)')).toBe(0);
    expect(calc('sign(2.5)')).toBe(1);
    expect(calc('round(2.5)')).toBe(3);
    expect(calc('round(-2.5)')).toBe(-3);
    expect(calc('trunc(-2.7)')).toBe(-2);
    expect(calc('floor(-2.2)')).toBe(-3);
    expect(calc('ceil(2.2)')).toBe(3);
    expect(calc('abs(-4)')).toBe(4);
    expect(calc('ln(e)')).toBeCloseTo(1, 12);
    expect(calc('log(1000)')).toBeCloseTo(3, 12);
    expect(calc('exp(0)')).toBe(1);
    expect(calc('exp10(3)')).toBe(1000);
    expect(calc('d2r(180)')).toBeCloseTo(Math.PI, 12);
    expect(calc('r2d(pi)')).toBeCloseTo(180, 12);
  });

  it('two-argument functions take a semicolon, or a comma, between their arguments', () => {
    expect(calc('max(3;7)')).toBe(7);
    expect(calc('min(3;7)')).toBe(3);
    expect(calc('pow(2;5)')).toBe(32);
    expect(calc('pow(2, 5)')).toBe(32);
    expect(calc('max(d1 ; d2*2)', { d1: 3, d2: 4 })).toBe(8);
  });

  it('random gives a decimal from 0 to 1, with or without parentheses', () => {
    expect(calc('random')).toBe(0.25);
    expect(calc('Random()*4')).toBe(1);
  });

  it('pi and e, function and constant names in any case', () => {
    expect(calc('pi')).toBe(Math.PI);
    expect(calc('PI*2')).toBe(Math.PI * 2);
    expect(calc('Pi')).toBe(Math.PI);
    expect(calc('E')).toBe(Math.E);
    expect(calc('SQRT(9)+Abs(-1)')).toBe(4);
  });

  it('refuses a wrong number of arguments', () => {
    expect(calc('pow(2)')).toBe('pow takes 2 arguments.');
    expect(calc('sin(1;2)')).toBe('sin takes 1 argument.');
    expect(calc('random(1)')).toBe('random takes no arguments.');
  });
});

describe('named parameters', () => {
  it('reads parameters by name, case sensitively', () => {
    expect(calc('d1*2 + Width', { d1: 3, Width: 10 })).toBe(16);
    expect(calc('width', { Width: 10 })).toBe('Unknown parameter "width".');
    expect(calc('Length_2/2', { Length_2: 9 })).toBe(4.5);
  });

  it('lists the parameters an expression names, once each, in order', () => {
    expect(expressionReferences('d1 + d2*sin(ang1) - d1 + pi')).toEqual(['d1', 'd2', 'ang1']);
    expect(expressionReferences('2+2')).toEqual([]);
    expect(expressionReferences('2+')).toEqual([]);
  });

  it('renames a parameter where the expression names it, keeping the rest as typed', () => {
    expect(renameInExpression('d1 + d10*2 - (d1)', 'd1', 'Width')).toBe('Width + d10*2 - (Width)');
    expect(renameInExpression('sin(d1)', 'sin', 'x')).toBe('sin(d1)');
    expect(renameInExpression('d1+', 'd1', 'x')).toBe('d1+');
  });

  it('validates names: a letter first, then letters, digits or underscores, at most 256', () => {
    expect(isValidParameterName('d1')).toBe(true);
    expect(isValidParameterName('Wall_Height2')).toBe(true);
    expect(isValidParameterName('1d')).toBe(false);
    expect(isValidParameterName('_d')).toBe(false);
    expect(isValidParameterName('wall height')).toBe(false);
    expect(isValidParameterName('a-b')).toBe(false);
    expect(isValidParameterName('')).toBe(false);
    expect(isValidParameterName('a'.repeat(256))).toBe(true);
    expect(isValidParameterName('a'.repeat(257))).toBe(false);
    // Function and constant names would be read as the function or constant.
    expect(isValidParameterName('sin')).toBe(false);
    expect(isValidParameterName('PI')).toBe(false);
    expect(isValidParameterName('e')).toBe(false);
    expect(isValidParameterName('Random')).toBe(false);
  });
});

describe('feet and inches', () => {
  it('reads foot and inch marks in Engineering and Architectural units (inches)', () => {
    expect(calc(`5'`, {}, 4)).toBe(60);
    expect(calc(`9"`, {}, 4)).toBe(9);
    // A dash between feet and inches separates them; with a space it subtracts (Help example).
    expect(calc(`5'-9"`, {}, 4)).toBe(69);
    expect(calc(`5' -9"`, {}, 4)).toBe(51);
    expect(calc(`5'- 9"`, {}, 3)).toBe(51);
    expect(calc(`5'9"`, {}, 4)).toBe(69);
    expect(calc(`2.5'*2`, {}, 4)).toBe(60);
    expect(calc(`d1 + 1'`, { d1: 3 }, 4)).toBe(15);
  });

  it('refuses the marks in other units', () => {
    expect(calc(`5'`, {}, 2)).toBe(`Unexpected "'".`);
    expect(calc(`9"`, {}, 5)).toBe('Unexpected """.');
  });
});

describe('errors', () => {
  it('says what is wrong with the syntax', () => {
    expect(calc('')).toBe('The expression is empty.');
    expect(calc('   ')).toBe('The expression is empty.');
    expect(calc('1+')).toBe('The expression ends early.');
    expect(calc('(1+2')).toBe('")" expected.');
    expect(calc('1+2)')).toBe('Unexpected ")".');
    expect(calc('2 3')).toBe('Unexpected "3".');
    expect(calc('1 # 2')).toBe('Unexpected "#".');
    expect(calc('foo(2)')).toBe('Unknown function "foo".');
    expect(calc('1..2')).toBe('Unexpected ".2".');
    expect(calc('.')).toBe('Unexpected ".".');
    expect(calc('10^400')).toBe('The value is out of range (-1e100 to 1e100).');
    expect(calc('max(1;)')).toBe('Unexpected ")".');
  });

  it('gives the position of a syntax error', () => {
    const r = parseExpression('1 + * 2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.at).toBe(4);
  });

  it('refuses results that are not real numbers or are out of range', () => {
    expect(calc('1/0')).toBe('Division by zero.');
    expect(calc('5 % 0')).toBe('Division by zero.');
    expect(calc('sqrt(-1)')).toBe('The result is not a real number.');
    expect(calc('ln(0)')).toBe('The result is not a real number.');
    expect(calc('acos(2)')).toBe('The result is not a real number.');
    // AutoCAD keeps expression values within -1e100 to 1e100.
    expect(calc('1e100')).toBe(1e100);
    expect(calc('1e101')).toBe('The value is out of range (-1e100 to 1e100).');
    expect(calc('-10^101')).toBe('The value is out of range (-1e100 to 1e100).');
  });

  it('a parsed expression evaluates again with new parameter values', () => {
    const r = parseExpression('d1*2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expression.evaluate((n) => (n === 'd1' ? 2 : undefined))).toEqual({
      ok: true,
      value: 4,
    });
    expect(r.expression.evaluate((n) => (n === 'd1' ? 5 : undefined))).toEqual({
      ok: true,
      value: 10,
    });
    expect(r.expression.references).toEqual(['d1']);
  });
});
