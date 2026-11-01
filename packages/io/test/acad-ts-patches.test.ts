// One test per local acad-ts patch (third_party/acad-ts/PATCHES.md). Each must fail when the
// patch is reverted, which is what proves the patch is still needed after an upstream sync.
import { CadDictionary, Line } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';

describe('acad-ts local patches', () => {
  it('0001 createExtendedDictionary works under ESM', () => {
    const line = new Line();

    const dict = line.createExtendedDictionary();

    expect(dict).toBeInstanceOf(CadDictionary);
    expect(line.xDictionary).toBe(dict);
    expect(dict.owner).toBe(line);
    // Idempotent: a second call returns the same dictionary.
    expect(line.createExtendedDictionary()).toBe(dict);
  });
});
