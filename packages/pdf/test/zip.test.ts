// M2-39 part 4: the sheets of an SVG or PNG publish travel as one ZIP, a file each.
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { uniqueFileNames, zipFiles } from '../src/zip';

describe('uniqueFileNames', () => {
  it('numbers a repeated name before its extension, ignoring case', () => {
    expect(uniqueFileNames(['a.svg', 'b.svg', 'A.svg', 'a.svg', 'a (2).svg', 'c'])).toEqual([
      'a.svg',
      'b.svg',
      'A (2).svg',
      'a (3).svg',
      'a (2) (2).svg',
      'c',
    ]);
  });
});

describe('zipFiles', () => {
  it('holds each file under its own name, in order, byte for byte', () => {
    const svg = new TextEncoder().encode('<svg/>'.repeat(100));
    const png = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
    const zip = zipFiles(
      [
        { name: 'plan-Layout1.svg', bytes: svg },
        { name: 'plan-Layout1.svg', bytes: svg },
        { name: 'plan-Model.png', bytes: png },
      ],
      new Date(2026, 10, 12, 10, 30),
    );
    // A local file header first.
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([
      'plan-Layout1.svg',
      'plan-Layout1 (2).svg',
      'plan-Model.png',
    ]);
    expect([...files['plan-Model.png']!]).toEqual([...png]);
    expect(new TextDecoder().decode(files['plan-Layout1 (2).svg'])).toBe('<svg/>'.repeat(100));
    // The SVG is deflated (method 8), the PNG stored (method 0).
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint16(8, true)).toBe(8);
    expect(zip.length).toBeLessThan(2 * svg.length);
  });
});
