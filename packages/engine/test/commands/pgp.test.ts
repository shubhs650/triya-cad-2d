// M3-10: the user alias file in AutoCAD's acad.pgp syntax (AutoCAD 2024 Help, "To Create Command
// Aliases" and "Command Search Order"), and the registry's user aliases, which override the
// default acad.pgp table (the acceptance's alias override test).
import { describe, expect, it } from 'vitest';
import {
  ALIASES,
  aliasFileProblems,
  builtinCommands,
  EngineSession,
  formatAliasFile,
  parseAliasFile,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

describe('parseAliasFile', () => {
  it('reads alias lines, skipping comments and blank lines', () => {
    const r = parseAliasFile(
      '; my aliases\n\nC,  *COPY\n  zz ,*zoom ; trailing note\r\nRR,\t*-ARRAY\n',
    );
    expect(r.aliases).toEqual({ C: 'COPY', ZZ: 'ZOOM', RR: '-ARRAY' });
    expect(r.problems).toEqual([]);
  });

  it('lets a later line for the same alias win, as acad.pgp says', () => {
    const r = parseAliasFile('C,*COPY\nC,*CIRCLE\n');
    expect(r.aliases).toEqual({ C: 'CIRCLE' });
  });

  it('reports lines it cannot use, with their line numbers', () => {
    const r = parseAliasFile(
      [
        'C,COPY', // no asterisk: AutoCAD reads it as an external command
        'NOTEPAD,START NOTEPAD,1,*File to edit: ,',
        ',*LINE',
        'A B,*ARC',
        'Q,*',
        'just words',
        'Q2,*QUICK LINE',
      ].join('\n'),
    );
    expect(r.aliases).toEqual({});
    expect(r.problems.map((p) => p.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.problems[0]!.message).toMatch(/external command/i);
    expect(r.problems[2]!.message).toMatch(/no alias/i);
    expect(r.problems[3]!.message).toMatch(/space/i);
    expect(r.problems[4]!.message).toMatch(/no command/i);
    expect(r.problems[5]!.message).toMatch(/comma/i);
    expect(r.problems[6]!.message).toMatch(/space/i);
  });

  it('writes aliases back as pgp lines that read the same', () => {
    const text = formatAliasFile({ C: 'COPY', RR: '-ARRAY' });
    expect(text).toContain('C,       *COPY');
    expect(parseAliasFile(text).aliases).toEqual({ C: 'COPY', RR: '-ARRAY' });
  });
});

describe('aliasFileProblems', () => {
  it('warns of commands Triya does not have and of aliases a command name hides', () => {
    const registry = builtinCommands();
    const r = parseAliasFile('C,*COPY\nQQ,*NOSUCHCMD\nLINE,*PLINE\nRR,*-ARRAY\nZZ,*-LINE\n');
    const problems = aliasFileProblems(r, registry);
    expect(problems.map((p) => [p.line, p.message])).toEqual([
      [2, 'NOSUCHCMD is not a command.'],
      [3, 'LINE is a command name, which comes first: the alias is never used.'],
      [5, 'LINE has no -LINE form.'],
    ]);
  });
});

describe('CommandRegistry user aliases', () => {
  it('override the default acad.pgp aliases and add new ones', () => {
    const registry = builtinCommands();
    expect(registry.resolve('C')?.def.name).toBe('CIRCLE');
    registry.setUserAliases({ C: 'COPY', QQ: 'QSELECT', RR: '-ARRAY' });
    expect(registry.alias('C')).toBe('COPY');
    expect(registry.resolve('c')?.def.name).toBe('COPY');
    expect(registry.resolve('QQ')?.def.name).toBe('QSELECT');
    expect(registry.resolve('RR')).toMatchObject({ dash: true, def: { name: 'ARRAY' } });
    // The other defaults stay.
    expect(registry.resolve('L')?.def.name).toBe('LINE');
    expect(registry.aliasesOf('COPY')).toEqual(['C', 'CO', 'CP']);
    expect(registry.aliasesOf('CIRCLE')).toEqual([]);
    // Taking the user file away brings the defaults back.
    registry.setUserAliases({});
    expect(registry.resolve('C')?.def.name).toBe('CIRCLE');
    expect(registry.aliasesOf('CIRCLE')).toEqual(['C']);
    expect(ALIASES['C']).toBe('CIRCLE');
  });

  it('never lets an alias hide a command name', () => {
    const registry = builtinCommands();
    registry.setUserAliases({ LINE: 'PLINE' });
    expect(registry.resolve('LINE')?.def.name).toBe('LINE');
  });

  it('keeps a user alias to a command it does not have, which then runs as unknown', () => {
    const registry = builtinCommands();
    registry.setUserAliases({ QQ: 'NOSUCHCMD' });
    expect(registry.alias('QQ')).toBe('NOSUCHCMD');
    expect(registry.resolve('QQ')).toBeUndefined();
  });

  it('no default alias is a command name (they would never be used)', () => {
    const registry = builtinCommands();
    for (const alias of Object.keys(ALIASES)) expect(registry.get(alias)).toBeUndefined();
  });
});

describe('EngineSession aliases edit', () => {
  it('runs the command a user alias names, at Command: and transparently', async () => {
    const s = new EngineSession(sampleInit());
    const logs: string[] = [];
    s.onCommand((o) => {
      if (o.type === 'prompt') logs.push(o.text);
    });
    expect(s.edit({ kind: 'aliases', aliases: { C: 'COPY', ZZ: 'ZOOM' } })).toEqual({
      ok: true,
      change: {},
    });
    await s.command({ kind: 'submit', text: 'C' });
    expect(logs.at(-1)).toBe('Select objects:');
    await s.command({ kind: 'cancel' });
    await s.command({ kind: 'submit', text: 'L' });
    await s.command({ kind: 'submit', text: "'ZZ" });
    expect(logs.at(-1)).toMatch(/^>>Specify corner of window, enter a scale factor/);
    await s.command({ kind: 'cancel' });
    await s.command({ kind: 'cancel' });
    s.edit({ kind: 'aliases', aliases: {} });
    await s.command({ kind: 'submit', text: 'C' });
    expect(logs.at(-1)).toMatch(/^Specify center point for circle/);
  });
});
