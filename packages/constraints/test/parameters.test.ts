// M9-03: the Parameters Manager's table (Help, "Parameters Manager (Drawing)"): dimensional
// constraint and user parameters with Name, Expression, Value, Type and Description; each value
// evaluated after the parameters its expression names.
import { describe, expect, it } from 'vitest';
import { ParameterTable } from '../src/index';

function table(): ParameterTable {
  return new ParameterTable({ lunits: 2, random: () => 0.5 });
}

describe('adding parameters', () => {
  it('evaluates each parameter after the ones it names, whatever order they were added', () => {
    const t = ParameterTable.load(
      [
        { name: 'Area', expression: 'Length*Width' },
        { name: 'Length', expression: '20', kind: 'constraint', type: 'Horizontal' },
        { name: 'Width', expression: 'Length/2', kind: 'constraint', type: 'Vertical' },
      ],
      { lunits: 2 },
    );
    expect(t.value('Length')).toBe(20);
    expect(t.value('Width')).toBe(10);
    expect(t.value('Area')).toBe(200);
    expect(t.rows().map((r) => r.name)).toEqual(['Area', 'Length', 'Width']);
    expect(t.get('Width')).toEqual({
      name: 'Width',
      expression: 'Length/2',
      value: 10,
      kind: 'constraint',
      type: 'Vertical',
      description: '',
    });
  });

  it('a new user parameter is user1 = 1, then user2…, as the New User Parameter button makes', () => {
    const t = table();
    expect(t.addUser()).toEqual({ ok: true, name: 'user1' });
    expect(t.addUser()).toEqual({ ok: true, name: 'user2' });
    expect(t.get('user1')).toMatchObject({ expression: '1', value: 1, kind: 'user', type: 'User' });
    expect(t.nextName('d')).toBe('d1');
    t.add({ name: 'd1', expression: '5', kind: 'constraint', type: 'Aligned' });
    t.add({ name: 'd3', expression: '5', kind: 'constraint', type: 'Aligned' });
    expect(t.nextName('d')).toBe('d2');
  });

  it('refuses a bad name, a taken name, a bad expression or an unknown parameter', () => {
    const t = table();
    t.add({ name: 'd1', expression: '5' });
    expect(t.add({ name: '2x', expression: '1' })).toEqual({
      ok: false,
      error:
        'Invalid name "2x": a letter first, then letters, digits or underscores (at most 256).',
    });
    expect(t.add({ name: 'sin', expression: '1' })).toMatchObject({ ok: false });
    expect(t.add({ name: 'd1', expression: '1' })).toEqual({
      ok: false,
      error: 'A parameter named "d1" already exists.',
    });
    // Names are case sensitive: D1 is another parameter.
    expect(t.add({ name: 'D1', expression: 'd1*2' })).toEqual({ ok: true, name: 'D1' });
    expect(t.add({ name: 'x', expression: '1+' })).toEqual({
      ok: false,
      error: 'The expression ends early.',
    });
    expect(t.add({ name: 'x', expression: 'nope*2' })).toEqual({
      ok: false,
      error: 'Unknown parameter "nope".',
    });
    expect(t.add({ name: 'x', expression: 'x+1' })).toEqual({
      ok: false,
      error: 'Circular reference: x → x.',
    });
    expect(t.rows().map((r) => r.name)).toEqual(['d1', 'D1']);
  });
});

describe('editing expressions', () => {
  it('re-evaluates every parameter that depends on the one edited, and lists them in order', () => {
    const t = table();
    t.add({ name: 'a', expression: '2' });
    t.add({ name: 'b', expression: 'a*3' });
    t.add({ name: 'c', expression: 'b+a' });
    t.add({ name: 'z', expression: '7' });
    expect(t.dependents('a')).toEqual(['b', 'c']);
    expect(t.setExpression('a', '10')).toEqual({ ok: true, changed: ['a', 'b', 'c'] });
    expect(t.value('b')).toBe(30);
    expect(t.value('c')).toBe(40);
    expect(t.value('z')).toBe(7);
  });

  it('refuses an edit that makes a circular reference, keeping the old expression', () => {
    const t = table();
    t.add({ name: 'a', expression: '2' });
    t.add({ name: 'b', expression: 'a*3' });
    t.add({ name: 'c', expression: 'b+1' });
    expect(t.setExpression('a', 'c/2')).toEqual({
      ok: false,
      error: 'Circular reference: a → c → b → a.',
    });
    expect(t.get('a')).toMatchObject({ expression: '2', value: 2 });
  });

  it('refuses an edit that leaves a dependent without a value, naming it', () => {
    const t = table();
    t.add({ name: 'a', expression: '2' });
    t.add({ name: 'b', expression: '1/a' });
    expect(t.setExpression('a', '0')).toEqual({ ok: false, error: 'b: Division by zero.' });
    expect(t.value('a')).toBe(2);
    expect(t.value('b')).toBe(0.5);
  });

  it('refuses an edit of a parameter that does not exist', () => {
    expect(table().setExpression('q', '1')).toEqual({
      ok: false,
      error: 'No parameter named "q".',
    });
  });

  it('keeps the expression as typed, feet and inches too', () => {
    const t = new ParameterTable({ lunits: 4 });
    t.add({ name: 'Wall', expression: `8'-6"` });
    expect(t.get('Wall')).toMatchObject({ expression: `8'-6"`, value: 102 });
  });

  it('sets the description', () => {
    const t = table();
    t.add({ name: 'a', expression: '2' });
    expect(t.setDescription('a', 'Plate width')).toEqual({ ok: true });
    expect(t.get('a')?.description).toBe('Plate width');
    expect(t.setDescription('q', 'x')).toEqual({ ok: false, error: 'No parameter named "q".' });
  });
});

describe('renaming and deleting', () => {
  it('a rename updates every expression that names the parameter', () => {
    const t = table();
    t.add({ name: 'd1', expression: '4' });
    t.add({ name: 'd10', expression: '1' });
    t.add({ name: 'd2', expression: 'd1*2 + d10 + d1' });
    expect(t.rename('d1', 'Width')).toEqual({ ok: true, changed: ['d2'] });
    expect(t.get('d2')?.expression).toBe('Width*2 + d10 + Width');
    expect(t.get('Width')).toMatchObject({ value: 4 });
    expect(t.get('d1')).toBeUndefined();
    expect(t.rows().map((r) => r.name)).toEqual(['Width', 'd10', 'd2']);
    expect(t.rename('Width', 'd10')).toEqual({
      ok: false,
      error: 'A parameter named "d10" already exists.',
    });
    expect(t.rename('Width', 'two words')).toMatchObject({ ok: false });
    expect(t.rename('nope', 'x')).toEqual({ ok: false, error: 'No parameter named "nope".' });
    expect(t.rename('Width', 'Width')).toEqual({ ok: true, changed: [] });
  });

  it('a delete keeps the values of the parameters that named it, as constants', () => {
    const t = table();
    t.add({ name: 'a', expression: '1/3' });
    t.add({ name: 'b', expression: 'a*3 + 1' });
    t.add({ name: 'c', expression: 'b' });
    expect(t.delete('a')).toEqual({ ok: true, changed: ['b'] });
    expect(t.get('a')).toBeUndefined();
    expect(t.get('b')).toMatchObject({ expression: '2', value: 2 });
    expect(t.get('c')).toMatchObject({ expression: 'b', value: 2 });
    expect(t.delete('a')).toEqual({ ok: false, error: 'No parameter named "a".' });
  });

  it('a constant keeps the full precision of the value', () => {
    const t = table();
    t.add({ name: 'a', expression: '1/3' });
    t.add({ name: 'b', expression: 'a' });
    t.delete('a');
    expect(t.value('b')).toBe(1 / 3);
  });
});

describe('the Parameters Manager filter and loading', () => {
  it('lists the parameters other expressions use', () => {
    const t = table();
    t.add({ name: 'a', expression: '2' });
    t.add({ name: 'b', expression: 'a*3' });
    t.add({ name: 'c', expression: '5' });
    t.add({ name: 'd', expression: 'b+c' });
    expect(t.usedInExpressions()).toEqual(['a', 'b', 'c']);
  });

  it('loads a table with problems, showing each bad row with its error', () => {
    const t = ParameterTable.load(
      [
        { name: 'a', expression: 'b+1' },
        { name: 'b', expression: 'a+1' },
        { name: 'c', expression: 'gone*2' },
        { name: 'd', expression: '2+' },
        { name: 'e2', expression: 'c+1' },
        { name: 'ok', expression: '3' },
        { name: 'ok', expression: '4' },
        { name: '9bad', expression: '4' },
      ],
      { lunits: 2 },
    );
    expect(t.get('a')).toMatchObject({ value: undefined, error: 'Circular reference: a → b → a.' });
    expect(t.get('b')).toMatchObject({ value: undefined, error: 'Circular reference: b → a → b.' });
    expect(t.get('c')).toMatchObject({ value: undefined, error: 'Unknown parameter "gone".' });
    expect(t.get('d')).toMatchObject({ value: undefined, error: 'The expression ends early.' });
    expect(t.get('e2')).toMatchObject({ value: undefined, error: 'c has no value.' });
    expect(t.value('ok')).toBe(3);
    expect(t.rows().map((r) => r.name)).toEqual(['a', 'b', 'c', 'd', 'e2', 'ok']);
    expect(t.errors()).toEqual(['a', 'b', 'c', 'd', 'e2']);
    // Fixing a bad row brings back the rows that depend on it.
    expect(t.setExpression('c', '2')).toEqual({ ok: true, changed: ['c', 'e2'] });
    expect(t.value('e2')).toBe(3);
    expect(t.errors()).toEqual(['a', 'b', 'd']);
  });

  it('editing one row of a cycle to a constant breaks the cycle', () => {
    const t = ParameterTable.load(
      [
        { name: 'a', expression: 'b+1' },
        { name: 'b', expression: 'a+1' },
      ],
      { lunits: 2 },
    );
    expect(t.setExpression('a', '1')).toEqual({ ok: true, changed: ['a', 'b'] });
    expect(t.value('b')).toBe(2);
    expect(t.errors()).toEqual([]);
  });

  it('random uses the injected source', () => {
    const t = table();
    t.add({ name: 'r', expression: 'random*10' });
    expect(t.value('r')).toBe(5);
  });
});
