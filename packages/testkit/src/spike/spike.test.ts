// The M0-06 spike tooling (pnpm spike:read / spike:roundtrip) on one real drawing each.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roundTrip } from '../roundtrip/roundtrip.ts';
import { spikeRead } from './read.ts';
import { buildTaxonomy, categorize, rootKey } from './taxonomy.ts';

const corpusBytes = (path: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );
// AC1032 ASCII DXF with view styles and dynamic-block data.
const DYN = 'third-party/acadsharp/dynamic-blocks/BLOCKPOLARPARAMETER.dxf';
// AC1027 DXF with a layer named with a `\U+00FC` escape, which the acad-ts DXF writer rejects as
// an invalid name and drops (M1-31). The tooling tests below need a file the writer drops objects
// from; when M1-31 fixes this one, point SKIPPED at another such file (DIMASSOC in
// dimension_in_block.dxf was fixed by 0061, ACAD_PROXY_OBJECT in bin_dxf_r13.dxf by 0063, and
// TABLECONTENT in sample_AC1015_ascii.dxf by M1-31 part 4).
const SKIPPED = 'third-party/ezdxf/integration_tests/dxf_unicode.dxf';
const DWG = 'third-party/acadsharp/sample_base/empty.dwg';

describe('spike tooling', () => {
  it('spikeRead counts objects, unmapped types and declared handles missing from the graph', () => {
    const read = spikeRead(corpusBytes(DYN));
    expect(read.status).not.toBe('error');
    expect(read.objects).toBeGreaterThan(50);
    expect(read.coverage?.fileHandles).toBeGreaterThanOrEqual(read.objects - 5);
    expect(read.coverage!.notInGraph).toBe(
      Object.values(read.coverage!.notInGraphByType).reduce((a, b) => a + b, 0),
    );

    const dwg = spikeRead(corpusBytes(DWG));
    expect(dwg.coverage?.fileHandles).toBeGreaterThan(0);
  });

  it('roundTrip reports writer notifications and returns the written bytes when asked', () => {
    const bytes = corpusBytes(SKIPPED);
    const kept = roundTrip(bytes, { keepOutput: true });
    expect(kept.output?.length).toBe(kept.bytesOut);
    expect(Object.keys(kept.writerNotes ?? {}).some((m) => /name is invalid/.test(m))).toBe(true);
    expect(roundTrip(bytes).output).toBeUndefined();
  });

  it('puts every difference in one category and groups by object and top-level field', () => {
    expect(categorize({ kind: 'missing', objectName: 'MATERIAL' } as never)).toBe(
      'dropped-by-writer',
    );
    expect(categorize({ kind: 'value', objectName: 'HEADER', path: '$TDCREATE' } as never)).toBe(
      'header-loss',
    );
    const changed = { kind: 'value', objectName: 'VIEWPORT', path: 'ucs[0].x' } as never;
    expect(categorize(changed)).toBe('property-loss');
    expect(rootKey(changed)).toBe('VIEWPORT ucs[]');

    const bytes = corpusBytes(SKIPPED);
    const rt = roundTrip(bytes, { sampleSize: 1e6, maxDifferences: 1e6 });
    const tax = buildTaxonomy([
      { path: SKIPPED, read: spikeRead(bytes), roundTrip: rt, differences: rt.sample ?? [] },
    ]);
    const total = Object.values(tax.byCategory).reduce((n, c) => n + c.count, 0);
    expect(total).toBe(tax.rows.reduce((n, r) => n + r.count, 0));
    expect(tax.byCategory['dropped-by-writer'].count).toBeGreaterThan(0);
  });
});
