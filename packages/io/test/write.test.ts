import { DxfReader } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { readCadDocument, summarizeDocument, writeCadDocument } from '../src/index';
import { ACadVersion, DWG_VERSIONS, sampleDocument } from './fixtures';

const BINARY_SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\0';
const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe('writeCadDocument', () => {
  it.each(DWG_VERSIONS.map((v) => [ACadVersion[v], v] as const))(
    'writes a %s DWG that reads back with its LINE and layer',
    (name, version) => {
      const bytes = writeCadDocument(sampleDocument(version), { format: 'dwg' });
      expect(text(bytes.subarray(0, 6))).toBe(name);
      const summary = summarizeDocument(readCadDocument(bytes), 'dwg');
      expect(summary.modelSpaceEntities).toEqual({ LINE: 1 });
      expect(summary.layers).toContain('M0-03');
    },
  );

  it.each([ACadVersion.AC1009, ACadVersion.AC1015, ACadVersion.AC1032])(
    'writes an ASCII DXF (%s) with no padding after EOF',
    (version) => {
      const bytes = writeCadDocument(sampleDocument(version), { format: 'dxf' });
      expect(bytes.includes(0)).toBe(false);
      expect(text(bytes.subarray(-8)).trim().endsWith('EOF')).toBe(true);
      expect(DxfReader.isBinaryStream(bytes)).toBe(false);
      const summary = summarizeDocument(readCadDocument(bytes), 'dxf');
      expect(summary.version).toBe(ACadVersion[version]);
      expect(summary.modelSpaceEntities).toEqual({ LINE: 1 });
    },
  );

  it.each([ACadVersion.AC1009, ACadVersion.AC1015, ACadVersion.AC1032])(
    'writes a binary DXF (%s) that reads back',
    (version) => {
      const bytes = writeCadDocument(sampleDocument(version), { format: 'dxf', binary: true });
      expect(text(bytes.subarray(0, BINARY_SENTINEL.length))).toBe(BINARY_SENTINEL);
      expect(text(bytes.subarray(-4))).toBe('EOF\0');
      const summary = summarizeDocument(readCadDocument(bytes), 'dxf');
      expect(summary.version).toBe(ACadVersion[version]);
      expect(summary.modelSpaceEntities).toEqual({ LINE: 1 });
    },
  );

  it('grows its buffer for documents larger than the first guess', () => {
    const doc = sampleDocument(ACadVersion.AC1032);
    const bytes = writeCadDocument(doc, { format: 'dxf', initialBufferBytes: 64 });
    expect(summarizeDocument(readCadDocument(bytes), 'dxf').modelSpaceEntities).toEqual({
      LINE: 1,
    });
  });
});
