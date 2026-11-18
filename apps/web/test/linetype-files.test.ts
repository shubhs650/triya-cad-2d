// M5-08: the files the linetype loader reads: the bundled set, then the user's .lin files, found
// by name (case and `.lin` ignored, the user's winning), read into the engine's definitions.
import { describe, expect, it } from 'vitest';
import {
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
      ['pipes.lin', false],
    ]);
    expect(linetypeFileSources().map((f) => f.name)).toEqual([
      'triya-iso.lin',
      'triya-utilities.lin',
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
