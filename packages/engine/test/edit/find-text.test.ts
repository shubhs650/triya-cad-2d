// M4-09 part 2: FIND's text search, read as the text shows (AutoCAD 2024 Help, "Find and Replace
// Dialog Box": Match case, Find whole words only, Use wildcards, Match diacritics, Match
// half/full width forms), and replacing in the stored string with its formatting kept.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIND_OPTIONS,
  displayText,
  findInText,
  replaceInText,
  shownText,
  type FindOptions,
  type TextSyntax,
} from '../../src/index';

const opts = (o: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND_OPTIONS, ...o });
const spans = (raw: string, syntax: TextSyntax, find: string, o: Partial<FindOptions> = {}) =>
  findInText(raw, syntax, find, opts(o)).map((m) => shownText(raw, syntax).slice(m.start, m.end));
const replaced = (
  raw: string,
  syntax: TextSyntax,
  find: string,
  by: string,
  o: Partial<FindOptions> = {},
) => replaceInText(raw, syntax, findInText(raw, syntax, find, opts(o)), by);

describe('the text as it shows', () => {
  it("reads an MTEXT's codes: paragraphs, fonts, stacks, escapes and Unicode", () => {
    expect(shownText('{\\fArial|b1;BOLD} \\LNOTE\\l\\PSECOND', 'mtext')).toBe('BOLD NOTE\nSECOND');
    expect(shownText('1\\S1/2; IN', 'mtext')).toBe('11/2 IN');
    expect(shownText('A\\\\B\\{C\\}\\~D', 'mtext')).toBe('A\\B{C} D');
    expect(shownText('\\U+00D825 %%c10', 'mtext')).toBe('Ø25 Ø10');
    expect(shownText('\\H2.5x;\\C1;RED', 'mtext')).toBe('RED');
  });

  it("reads a TEXT's control codes; its backslashes are text", () => {
    expect(shownText('%%c25 %%p0.1 90%%d %%uSEE%%u %%%', 'text')).toBe('Ø25 ±0.1 90° SEE %');
    expect(shownText('C:\\P', 'text')).toBe('C:\\P');
  });

  it("a dimension's measurement and a field are never matched", () => {
    expect(spans('<> TYP', 'dimension', 'TYP')).toEqual(['TYP']);
    expect(spans('<> TYP', 'dimension', '<>')).toEqual([]);
    expect(spans('<> TYP', 'dimension', '*', { wildcards: true })).toEqual(['TYP']);
    expect(spans('DATE %<\\AcVar Date>% DATE', 'mtext', 'DATE')).toEqual(['DATE', 'DATE']);
    expect(displayText('<> TYP', 'dimension').text).toBe('<> TYP');
  });
});

describe('matching', () => {
  it('ignores case, accents and full width forms unless asked to match them', () => {
    expect(spans('Door door DOOR', 'plain', 'door')).toEqual(['Door', 'door', 'DOOR']);
    expect(spans('Door door DOOR', 'plain', 'door', { matchCase: true })).toEqual(['door']);
    expect(spans('Café CAFE', 'plain', 'cafe')).toEqual(['Café', 'CAFE']);
    expect(spans('Café CAFE', 'plain', 'cafe', { matchDiacritics: true })).toEqual(['CAFE']);
    expect(spans('ＡＢＣ ABC', 'plain', 'abc')).toEqual(['ＡＢＣ', 'ABC']);
    expect(spans('ＡＢＣ ABC', 'plain', 'abc', { matchWidth: true })).toEqual(['ABC']);
  });

  it('finds whole words only when asked', () => {
    expect(spans('DOOR DOORS D-DOOR', 'plain', 'door')).toEqual(['DOOR', 'DOOR', 'DOOR']);
    expect(spans('DOOR DOORS D-DOOR', 'plain', 'door', { wholeWords: true })).toEqual([
      'DOOR',
      'DOOR',
    ]);
  });

  it("reads AutoCAD's wildcards; * stays within a word", () => {
    const w = { wildcards: true };
    expect(spans('DOOR D1 D22 DESK', 'plain', 'D#', w)).toEqual(['D1', 'D2']);
    expect(spans('DOOR D1 D22 DESK', 'plain', 'D#', { ...w, wholeWords: true })).toEqual(['D1']);
    expect(spans('DOOR-1 DESK', 'plain', 'D*', w)).toEqual(['DOOR-1', 'DESK']);
    expect(spans('DOOR DESK', 'plain', 'D?SK', w)).toEqual(['DESK']);
    expect(spans('R1 RA R-', 'plain', 'R@', w)).toEqual(['RA']);
    expect(spans('R1 RA R-', 'plain', 'R.', w)).toEqual(['R-']);
    expect(spans('A1 B1 C1', 'plain', '[AB]1', w)).toEqual(['A1', 'B1']);
    expect(spans('A1 B1 C1', 'plain', '[~AB]1', w)).toEqual(['C1']);
    expect(spans('A*B AXB', 'plain', 'A`*B', w)).toEqual(['A*B']);
    // Without Use wildcards they are text.
    expect(spans('A*B AXB', 'plain', 'A*B')).toEqual(['A*B']);
  });

  it('a match across formatting is found; one through part of a stack is not', () => {
    expect(spans('{\\LUNDER}LINE', 'mtext', 'underline')).toEqual(['UNDERLINE']);
    expect(spans('1\\S1/2; IN', 'mtext', '1/2')).toEqual(['1/2']);
    expect(spans('1\\S1/2; IN', 'mtext', '/2 IN')).toEqual([]);
    expect(spans('FIRST\\PSECOND', 'mtext', 'first second')).toEqual([]);
  });
});

describe('replacing', () => {
  it('replaces every match, the stored codes kept', () => {
    expect(replaced('Door door', 'plain', 'door', 'GATE')).toBe('GATE GATE');
    expect(replaced('%%c25 HOLE', 'text', 'hole', 'BORE')).toBe('%%c25 BORE');
    expect(replaced('{\\fArial|b1;DOOR}\\PDOOR', 'mtext', 'door', 'GATE')).toBe(
      '{\\fArial|b1;GATE}\\PGATE',
    );
  });

  it('keeps the codes inside a match after the replacement, braces paired', () => {
    expect(replaced('AB{\\LCD}EF', 'mtext', 'bc', 'X')).toBe('AX{\\LD}EF');
    expect(replaced('{\\LUNDER}LINE', 'mtext', 'underline', 'U')).toBe('{\\LU}');
  });

  it("escapes what an MTEXT reads as codes, not a TEXT's", () => {
    expect(replaced('PATH', 'mtext', 'path', 'C:\\{X}')).toBe('C:\\\\\\{X\\}');
    expect(replaced('PATH', 'text', 'path', 'C:\\{X}')).toBe('C:\\{X}');
  });

  it("keeps a dimension's measurement", () => {
    expect(replaced('<> TYP', 'dimension', 'typ', '(4 PLACES)')).toBe('<> (4 PLACES)');
  });

  it('shows a match within the text a results list shows', () => {
    const raw = 'FIRST\\PSECOND <>';
    const [m] = findInText(raw, 'dimension', 'second', opts());
    expect(displayText(raw, 'dimension', m)).toEqual({
      text: 'FIRST SECOND <>',
      start: 6,
      end: 12,
    });
  });
});
