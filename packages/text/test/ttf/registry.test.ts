// Font resolution for TrueType text styles (M1-10): sources are tried in order (the app adds
// user-dropped fonts and the browser's local fonts; tests use memory), then fallbacks, and a
// substitution is reported so the health panel can list it.
import { describe, expect, it } from 'vitest';
import { TtfRegistry, type FontSource } from '../../src/index';
import { fontBytes, testFont } from './fonts';

const bytes = fontBytes(testFont());
const boldBytes = fontBytes(testFont({ styleName: 'Bold', weightClass: 700 }));

function memory(name: string, files: Record<string, Uint8Array>): FontSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    load(family, style) {
      const key = `${family.toLowerCase()}${style.bold ? '|bold' : ''}${style.italic ? '|italic' : ''}`;
      calls.push(key);
      return Promise.resolve(files[key]);
    },
  };
}

describe('TtfRegistry', () => {
  it('takes the first source that has the font', async () => {
    const first = memory('user', {});
    const second = memory('local', { arial: bytes });
    const reg = new TtfRegistry([first, second], []);
    const r = await reg.resolve('Arial', { bold: false, italic: false });
    expect(r?.source).toBe('local');
    expect(r?.family).toBe('Arial');
    expect(r?.substituted).toBe(false);
    expect(r?.font.family).toBe('Triya Test Sans');
    expect(first.calls).toEqual(['arial']);
  });

  it('keys by style, and resolves each family and style once', async () => {
    const src = memory('user', { arial: bytes, 'arial|bold': boldBytes });
    const reg = new TtfRegistry([src], []);
    const a = await reg.resolve('Arial', { bold: false, italic: false });
    const b = await reg.resolve('ARIAL', { bold: false, italic: false });
    const bold = await reg.resolve('Arial', { bold: true, italic: false });
    expect(a?.font).toBe(b?.font);
    expect(bold?.font.style.bold).toBe(true);
    expect(src.calls).toEqual(['arial', 'arial|bold']);
  });

  it('falls back in order and reports the substitution', async () => {
    const src = memory('bundled', { 'dejavu sans': bytes });
    const reg = new TtfRegistry([src], ['Liberation Sans', 'DejaVu Sans']);
    const r = await reg.resolve('Gill Sans MT', { bold: false, italic: false });
    expect(r?.substituted).toBe(true);
    expect(r?.family).toBe('DejaVu Sans');
    expect(r?.requested).toBe('Gill Sans MT');
  });

  it('gives undefined when nothing, fallbacks included, can be found', async () => {
    const reg = new TtfRegistry([memory('user', {})], ['Nope']);
    expect(await reg.resolve('Arial', { bold: false, italic: false })).toBeUndefined();
  });

  it('skips a source whose file does not parse, and says why', async () => {
    const broken = memory('user', { arial: new Uint8Array([0, 1, 2, 3]) });
    const good = memory('local', { arial: bytes });
    const reg = new TtfRegistry([broken, good], []);
    const r = await reg.resolve('Arial', { bold: false, italic: false });
    expect(r?.source).toBe('local');
    expect(reg.warnings).toHaveLength(1);
    expect(reg.warnings[0]).toMatchObject({ source: 'user', font: 'Arial' });
    expect(reg.warnings[0]?.problem).toMatch(/^not a usable font \(.+\)$/);
  });

  // M1-38 part 3: a file a source cannot read (an installed face whose bytes the browser
  // will not give) is skipped like one that does not parse, and named for the health report.
  it('skips a source that cannot read its file, and says why', async () => {
    const unreadable: FontSource = {
      name: 'This computer',
      load: () => Promise.reject(new Error('NotAllowedError')),
    };
    const good = memory('bundled', { arial: bytes });
    const reg = new TtfRegistry([unreadable, good], []);
    const r = await reg.resolve('Arial', { bold: false, italic: false });
    expect(r?.source).toBe('bundled');
    expect(reg.warnings).toEqual([
      { source: 'This computer', font: 'Arial', problem: 'could not be read (NotAllowedError)' },
    ]);
  });
});
