// M2-32 part 5: the Clipboard as the system clipboard carries it, a text another Triya window
// reads back. Whatever the structured clone between two drawings of one window keeps, the text
// keeps too: undefined fields, −0, non-finite numbers, bigints (xdata 1071), byte arrays (xdata
// 1004, binary chunks), Maps and Sets.
import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_DATA_VERSION,
  DocumentModel,
  clipboardData,
  copyToClipboard,
  mtextLiteral,
  readClipboardData,
  type Clipboard,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

declare function structuredClone<T>(value: T): T;

const roundTrip = <T>(value: T): T =>
  readClipboardData(clipboardData(value as unknown as Clipboard, 'w1'))!.clipboard as T;

describe('clipboardData and readClipboardData', () => {
  it('reads back a copied drawing as the structured clone does', () => {
    const model = DocumentModel.create(sampleInit());
    const ids = [...model.entities()].map((e) => e.id);
    const { clipboard } = copyToClipboard(model, ids, { x: 1, y: 2 });
    const read = readClipboardData(clipboardData(clipboard, 'window-7'));
    expect(read?.source).toBe('window-7');
    expect(read?.clipboard).toStrictEqual(structuredClone(clipboard));
  });

  it('keeps the values JSON alone loses', () => {
    const value = {
      entities: [],
      missing: undefined,
      list: [1, undefined, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      big: 12345678901234567890n,
      bytes: new Uint8Array([0, 1, 127, 128, 254, 255]),
      empty: new Uint8Array(0),
      odd: new Uint8Array([7, 8, 9, 10, 11]),
      floats: new Float64Array([0.5, -2]),
      map: new Map<string, unknown>([
        ['a', 1],
        ['b', { c: [2n] }],
      ]),
      set: new Set(['x', 'y']),
      // A field that looks like the tag the text uses for these.
      tagged: { $t: 'u' },
      text: 'line\nwith "quotes" and \\ and {braces}',
    };
    const back = roundTrip(value);
    expect(back).toStrictEqual(value);
    expect(Object.is(back.list[2], -0)).toBe(true);
    expect('missing' in back).toBe(true);
  });

  it('reads only the Clipboard text of this version', () => {
    expect(readClipboardData('hello')).toBeUndefined();
    expect(readClipboardData('{"a":1}')).toBeUndefined();
    expect(readClipboardData('[1,2]')).toBeUndefined();
    const text = clipboardData({ base: { x: 0, y: 0 } } as unknown as Clipboard, 's');
    const newer = text.replace(
      `"version":${CLIPBOARD_DATA_VERSION}`,
      `"version":${CLIPBOARD_DATA_VERSION + 1}`,
    );
    expect(newer).not.toBe(text);
    expect(readClipboardData(newer)).toBeUndefined();
  });
});

describe('mtextLiteral', () => {
  it('writes plain text as MTEXT contents: codes escaped, lines as paragraphs, tabs as ^I', () => {
    expect(mtextLiteral('a\\b {c} ^d\te')).toBe('a\\\\b \\{c\\} ^ d^Ie');
    expect(mtextLiteral('one\r\ntwo\rthree\nfour')).toBe('one\\Ptwo\\Pthree\\Pfour');
    // The line breaks a copied text ends with are not paragraphs of the pasted text.
    expect(mtextLiteral('last line\r\n\n')).toBe('last line');
  });
});
