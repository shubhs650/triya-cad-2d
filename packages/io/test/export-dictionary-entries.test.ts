// Renaming dictionary-named objects in place (M1-95): the checks the style and image writers
// share. The writers' own tests save renames to DXF and DWG.
import { CadDictionary, CadDocument, MultiLeaderStyle, XRecord } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { entryRenameProblems, renameEntries } from '../src/export/dictionary-entries';

function styles() {
  const doc = new CadDocument();
  const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadMLeaderStyle)!;
  const [a, b] = ['ALPHA', 'BRAVO'].map((name) => {
    const s = new MultiLeaderStyle(name);
    dict.add(s);
    return s;
  });
  return { dict, a: a!, b: b! };
}

describe('dictionary entry renames', () => {
  it('refuses an object no dictionary lists', () => {
    expect(entryRenameProblems(new MultiLeaderStyle('LOOSE'), 'X', () => true)).toEqual([
      'it is not an entry of a dictionary, which is where its name is kept',
    ]);
  });

  it('refuses a name an entry Triya does not map holds, without regard to case', () => {
    const { dict, a, b } = styles();
    const other = new XRecord('NOTES');
    dict.add(other);
    expect(entryRenameProblems(a, 'notes', (o) => o !== other)).toEqual([
      'the dictionary has another entry named notes',
    ]);
    // A mapped entry's name is checked against the model, where it may be renamed away.
    expect(entryRenameProblems(a, 'BRAVO', (o) => o === b)).toEqual([]);
    expect(entryRenameProblems(a, 'alpha', () => false)).toEqual([]);
  });

  it('renames entries in place, letting them trade names', () => {
    const { dict, a, b } = styles();
    const names = dict.entryNames;
    const handles = dict.entryHandles;
    renameEntries([
      { acad: a, name: 'BRAVO' },
      { acad: b, name: 'ALPHA' },
    ]);
    expect(dict.entryNames).toEqual(names.map((n) => ({ ALPHA: 'BRAVO', BRAVO: 'ALPHA' })[n] ?? n));
    expect(dict.entryHandles).toEqual(handles);
    expect([a.name, b.name]).toEqual(['BRAVO', 'ALPHA']);
    expect(dict.getEntry('alpha')).toBe(b);
  });
});
