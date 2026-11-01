import { describe, expect, it } from 'vitest';
import { roundTrip } from './roundtrip.ts';
import { ACadVersion, authoredDocument, authoredDxf } from './fixtures.ts';
import { writeCadDocument } from '@triya/io';

describe('roundTrip', () => {
  it('opens, saves in the same format and version, reopens and diffs', () => {
    const result = roundTrip(authoredDxf(ACadVersion.AC1032));
    expect(result.format).toBe('dxf-ascii');
    expect(result.status).toMatch(/^(clean|diff)$/);
    expect(result.objectsA).toBeGreaterThan(10);
    expect(result.bytesOut).toBeGreaterThan(0);
    expect(result.summary?.total).toBe(result.sample?.length);
  });

  it('keeps DWG as DWG and binary DXF as binary DXF', () => {
    const doc = authoredDocument(ACadVersion.AC1018);
    expect(roundTrip(writeCadDocument(doc, { format: 'dwg' })).format).toBe('dwg');
    const bin = writeCadDocument(authoredDocument(ACadVersion.AC1018), {
      format: 'dxf',
      binary: true,
    });
    expect(roundTrip(bin).format).toBe('dxf-binary');
  });

  it('is reproducible: two runs on the same bytes give the same differences', () => {
    const bytes = authoredDxf(ACadVersion.AC1015);
    expect(roundTrip(bytes).sample).toEqual(roundTrip(bytes).sample);
  });

  it('reports unreadable input as read-error instead of throwing', () => {
    const result = roundTrip(
      new TextEncoder().encode('0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nBOGUS\n'),
    );
    expect(['read-error', 'clean', 'diff']).toContain(result.status);
    const garbage = roundTrip(new Uint8Array([1, 2, 3, 4]));
    expect(garbage.status).toBe('read-error');
    expect(garbage.error).toBeTruthy();
  });
});
