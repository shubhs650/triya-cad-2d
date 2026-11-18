// M5-08: the files the linetype loader reads: the bundled set, then the user's .lin files, found
// by name (case and `.lin` ignored, the user's winning), read into the engine's definitions.
import { describe, expect, it } from 'vitest';
import {
  createLinetype,
  findLinetypeFile,
  linetypeFileReply,
  linetypeFileSources,
  linetypesOf,
} from '../src/linetype-files';

const kept = (files: Record<string, string>) => ({
  getSnapshot: () => ({ files: Object.keys(files).map((name) => ({ name })) }),
  file: (name: string) =>
    files[name] === undefined ? undefined : new TextEncoder().encode(files[name]),
});

describe('linetype files', () => {
  it('lists the bundled files first, then the user’s', () => {
    const files = linetypeFileSources(kept({ 'pipes.lin': '*P,Pipe\nA,1,-1\n' }));
    expect(files.map((f) => [f.name, f.bundled])).toEqual([
      ['triya-iso.lin', true],
      ['triya-utilities.lin', true],
      ['triya-drafting.lin', true],
      ['triya-drafting-iso.lin', true],
      ['pipes.lin', false],
    ]);
    expect(linetypeFileSources().map((f) => f.name)).toEqual([
      'triya-iso.lin',
      'triya-utilities.lin',
      'triya-drafting.lin',
      'triya-drafting-iso.lin',
    ]);
  });

  it('finds a file ignoring case and the extension, the user’s winning over a bundled one', () => {
    const files = linetypeFileSources(
      kept({ 'Pipes.LIN': '*P,Pipe\nA,1,-1\n', 'triya-iso.lin': '*MINE\nA,1,-1\n' }),
    );
    expect(findLinetypeFile(files)?.name).toBe('triya-iso.lin');
    expect(findLinetypeFile(files)?.bundled).toBe(true);
    expect(findLinetypeFile(files, 'pipes')?.name).toBe('Pipes.LIN');
    expect(findLinetypeFile(files, 'TRIYA-ISO.lin')?.bundled).toBe(false);
    expect(findLinetypeFile(files, 'nope')).toBeUndefined();
  });

  it('reads definitions with text as the engine loads them, leaving out bad ones', () => {
    const [file] = linetypeFileSources(
      kept({
        'x.lin': '*T,Text\nA,1,["X",Standard,S=.1,U=0],-1\n*BAD\nB,1,-1\n',
      }),
    ).filter((f) => !f.bundled);
    expect(linetypesOf(file!)).toEqual([
      {
        name: 'T',
        description: 'Text',
        elements: [
          {
            length: 1,
            embed: {
              kind: 'text',
              text: 'X',
              style: 'Standard',
              scale: 0.1,
              rotation: 0,
              rotationMode: 'upright',
              offset: { x: 0, y: 0 },
            },
          },
          { length: -1 },
        ],
      },
    ]);
  });

  it('answers -LINETYPE with the file read, or with none', () => {
    const files = linetypeFileSources();
    const r = linetypeFileReply(files, 'triya-utilities');
    expect(r.ok && r.linetypeFile?.name).toBe('triya-utilities.lin');
    // Create (M5-08 part 4) is told which files ship with Triya.
    expect(r.ok && r.linetypeFile?.bundled).toBe(true);
    const mine = linetypeFileReply(
      linetypeFileSources(kept({ 'pipes.lin': '*P,Pipe\nA,1,-1\n' })),
      'pipes',
    );
    expect(mine.ok && mine.linetypeFile?.bundled).toBeUndefined();
    expect(r.ok && r.linetypeFile?.linetypes.map((l) => l.name)).toEqual([
      'TRIYA_GAS',
      'TRIYA_WATER',
      'TRIYA_HOT_WATER',
    ]);
    const bundled = linetypeFileReply(files);
    expect(bundled.ok && bundled.linetypeFile?.linetypes).toHaveLength(14);
    expect(linetypeFileReply(files, 'missing')).toEqual({ ok: true });
  });
});

// M5-08 part 4: -LINETYPE Create writes the definition typed to one of the user's .lin files.
describe('-LINETYPE Create: writing a definition', () => {
  /** A store keeping what is added, as `LinetypeFiles.add` does. */
  function store(files: Record<string, string>) {
    const written: Record<string, string> = {};
    const add = (name: string, bytes: Uint8Array) => {
      written[name] = new TextDecoder('windows-1252').decode(bytes);
      return Promise.resolve({ name });
    };
    return { list: () => linetypeFileSources(kept(files)), add, written };
  }
  const create = (file: string, name: string, description: string, pattern: string) => ({
    op: 'linetypeCreate' as const,
    file,
    name,
    description,
    pattern,
  });

  it('starts a new file, CRLF lines as AutoCAD writes them, and answers with what it holds', async () => {
    const s = store({});
    const r = await createLinetype(s, create('custom.lin', 'FENCE', 'Fence', 'A,.5,-.25,0,-.25'));
    expect(s.written).toEqual({ 'custom.lin': '*FENCE,Fence\r\nA,.5,-.25,0,-.25\r\n' });
    expect(r.ok && r.linetypeFile).toEqual({
      name: 'custom.lin',
      linetypes: [
        {
          name: 'FENCE',
          description: 'Fence',
          elements: [{ length: 0.5 }, { length: -0.25 }, { length: 0 }, { length: -0.25 }],
        },
      ],
    });
  });

  it("appends to a user's file, or replaces the definition of that name in place", async () => {
    const source = ';; pipes\n*P,Pipe\nA,1,-1\n\n*Q,Other\nA,2,-2\n';
    const s = store({ 'Pipes.lin': source });
    await createLinetype(s, create('pipes.lin', 'R', '', 'A,3,-3'));
    expect(s.written['Pipes.lin']).toBe(`${source}*R,\nA,3,-3\n`);
    const t = store({ 'Pipes.lin': source });
    await createLinetype(t, create('pipes.lin', 'p', 'New pipe', 'A,4,-1'));
    expect(t.written['Pipes.lin']).toBe(';; pipes\n*p,New pipe\nA,4,-1\n\n*Q,Other\nA,2,-2\n');
  });

  it('refuses a bad pattern, a bundled file and what the store refuses', async () => {
    const s = store({});
    const bad = await createLinetype(s, create('custom.lin', 'X', '', 'A,-1,1'));
    expect(bad).toEqual({
      ok: false,
      message: 'The linetype pattern is not valid: the first dash must be 0 or greater.',
    });
    const one = await createLinetype(s, create('custom.lin', 'X', '', 'A,1'));
    expect(!one.ok && one.message).toMatch(/at least two dash specifications/);
    const bundled = await createLinetype(s, create('TRIYA-ISO.LIN', 'X', '', 'A,1,-1'));
    expect(bundled).toEqual({
      ok: false,
      message: 'triya-iso.lin is bundled with Triya and cannot be changed.',
    });
    expect(s.written).toEqual({});
    const full = {
      list: () => linetypeFileSources(),
      add: () => Promise.resolve({ error: 'No room.' }),
    };
    expect(await createLinetype(full, create('custom.lin', 'X', '', 'A,1,-1'))).toEqual({
      ok: false,
      message: 'No room.',
    });
  });
});
