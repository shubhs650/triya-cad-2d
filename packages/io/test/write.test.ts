import { DxfReader, XYZ } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import {
  fidelityDwgConfiguration,
  fidelityDxfConfiguration,
  readCadDocument,
  summarizeDocument,
  writeCadDocument,
} from '../src/index';
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

  it('keeps every header variable in a DXF save, not only the acad-ts default subset', () => {
    // acad-ts writes ~40 of ~250 DXF header variables by default; $TILEMODE and $EXTMAX are
    // not among them, so a plain write resets them (M0-06 spike, 90+ corpus files).
    const doc = sampleDocument(ACadVersion.AC1032);
    doc.header!.showModelSpace = true;
    doc.header!.modelSpaceExtMax = new XYZ(120, 80, 0);
    const reread = readCadDocument(writeCadDocument(doc, { format: 'dxf' }));
    expect(reread.header!.showModelSpace).toBe(true);
    expect(reread.header!.modelSpaceExtMax.x).toBe(120);
    expect(reread.header!.modelSpaceExtMax.y).toBe(80);
  });

  it('turns on dynamic-block data and all header variables in its writer profiles', () => {
    expect(fidelityDxfConfiguration().writeAllHeaderVariables).toBe(true);
    expect(fidelityDxfConfiguration().writeDynamicBlockData).toBe(true);
    expect(fidelityDwgConfiguration().writeDynamicBlockData).toBe(true);
  });
});
