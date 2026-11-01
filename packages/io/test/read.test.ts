import { ACadVersion } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { detectFormat, readCadDocument, summarizeDocument } from '../src/index';
import { ascii, DWG_VERSIONS, sampleDwg, sampleDxf } from './fixtures';

describe('DwgReader runs in Node (M0-03 acceptance)', () => {
  it.each(DWG_VERSIONS.map((v) => [ACadVersion[v], v] as const))(
    'reads a %s DWG back with its LINE and layer',
    (name, version) => {
      const bytes = sampleDwg(version);
      expect(detectFormat(bytes)).toBe('dwg');

      const summary = summarizeDocument(readCadDocument(bytes), 'dwg');

      expect(summary.format).toBe('dwg');
      expect(summary.version).toBe(name);
      expect(summary.modelSpaceEntities).toEqual({ LINE: 1 });
      expect(summary.layers).toContain('M0-03');
      expect(Number.parseInt(summary.handSeed, 16)).toBeGreaterThan(0);
    },
  );

  it('reads from a view into a larger buffer without picking up the surrounding bytes', () => {
    const dwg = sampleDwg(ACadVersion.AC1032);
    const padded = new Uint8Array(dwg.length + 64);
    padded.set(dwg, 32);
    const view = padded.subarray(32, 32 + dwg.length);

    expect(summarizeDocument(readCadDocument(view), 'dwg').modelSpaceEntities).toEqual({ LINE: 1 });
  });
});

describe('DxfReader runs in Node', () => {
  it('reads an ASCII DXF back', () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    expect(detectFormat(bytes)).toBe('dxf');

    const summary = summarizeDocument(readCadDocument(bytes), 'dxf');

    expect(summary.version).toBe('AC1032');
    expect(summary.modelSpaceEntities).toEqual({ LINE: 1 });
    expect(summary.layers).toContain('M0-03');
  });
});

describe('detectFormat', () => {
  it('treats the AutoCAD version magic as DWG and everything else as DXF', () => {
    expect(detectFormat(ascii('AC1032\0\0\0'))).toBe('dwg');
    expect(detectFormat(ascii('AC1009'))).toBe('dwg');
    expect(detectFormat(ascii('  0\r\nSECTION\r\n'))).toBe('dxf');
    expect(detectFormat(ascii('AutoCAD Binary DXF\r\n\x1a\0'))).toBe('dxf');
  });
});
