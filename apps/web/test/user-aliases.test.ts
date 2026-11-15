// M3-10: the user alias file the app keeps (FR-C4). Its aliases reach the command line's
// completion and the Ctrl+K palette through the app's registry, over the default acad.pgp ones.
import { describe, expect, it } from 'vitest';
import { completions } from '../src/command-line';
import { commandItems } from '../src/palette';
import { aliasFileVersion, aliasesOf, appRegistry, applyAliasFile } from '../src/user-aliases';

describe('user alias file', () => {
  it('overrides the default aliases in completion and the palette, and tells its listeners', () => {
    let heard = 0;
    const stop = aliasFileVersion.subscribe(() => heard++);
    const before = aliasFileVersion.get();
    expect(applyAliasFile('; mine\nC,*COPY\nQQ,*QSELECT\n')).toBe(true);
    expect(applyAliasFile('; mine\nC,*COPY\nQQ,*QSELECT\n')).toBe(false);
    expect(heard).toBe(1);
    expect(aliasFileVersion.get()).toBe(before + 1);
    expect(completions(appRegistry, 'C')[0]).toEqual({ name: 'COPY', alias: 'C' });
    expect(completions(appRegistry, 'qq')[0]).toEqual({ name: 'QSELECT', alias: 'QQ' });
    const items = commandItems(appRegistry);
    expect(items.find((i) => i.id === 'COPY')?.aliases).toEqual(['C', 'CO', 'CP']);
    expect(items.find((i) => i.id === 'CIRCLE')?.aliases).toEqual([]);
    applyAliasFile('');
    expect(completions(appRegistry, 'C')[0]).toEqual({ name: 'CIRCLE', alias: 'C' });
    stop();
  });

  it('gives a file its aliases, leaving out lines it cannot read', () => {
    expect(aliasesOf('C,*COPY\nNOTEPAD,START NOTEPAD,1,*File: ,\n')).toEqual({ C: 'COPY' });
  });
});
