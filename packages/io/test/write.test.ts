import { DxfReader, DxfWriter, MText, TextEntity, XYZ } from '@node-projects/acad-ts';
import { describe, expect, it, vi } from 'vitest';
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

  it('writes an R2007+ ASCII DXF in one pass, however small its first buffer (M10-01)', () => {
    // acad-ts's byte buffer cannot grow: a DXF larger than the guess was written again at each
    // doubling, six times over for bench-100k's 27 MB.
    const write = vi.spyOn(DxfWriter, 'writeToStream');
    try {
      const doc = sampleDocument(ACadVersion.AC1032);
      for (let i = 0; i < 200; i++) doc.entities!.add(new TextEntity());
      writeCadDocument(doc, { format: 'dxf', initialBufferBytes: 64 });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });

  it("writes an R2007+ DXF's text as acad-ts's own buffer encodes it (M10-01)", () => {
    const doc = sampleDocument(ACadVersion.AC1032);
    const values = ['Ø25 ± 0.1 °C', '漢字 and 😀', 'tab\there^ caret', 'lone \ud800 surrogate'];
    for (const value of values) {
      const t = new TextEntity();
      t.value = value;
      doc.entities!.add(t);
    }
    const m = new MText();
    m.value = 'Line 1\\PΔ line 2';
    doc.entities!.add(m);
    const buffer = new Uint8Array(1 << 20);
    DxfWriter.writeToStream(buffer, doc, false, fidelityDxfConfiguration());
    let end = buffer.length;
    while (buffer[end - 1] === 0) end--;
    expect(writeCadDocument(doc, { format: 'dxf' })).toEqual(buffer.slice(0, end));
    const read = readCadDocument(writeCadDocument(doc, { format: 'dxf' }));
    const texts = [...read.entities!].filter((e) => e instanceof TextEntity);
    expect(texts.map((t) => t.value)).toEqual(values.map((v) => v.replace('\ud800', '\ufffd')));
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
