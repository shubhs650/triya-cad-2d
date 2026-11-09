// The title-block test drawing (M2-12) stays as fixture.ts authors it and opens with the
// attributes it means. `TRIYA_UPDATE_FIXTURES=1` rewrites it (a DXF's header carries its save
// time, so the file is compared by what it maps to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AttdefGeometry, DocumentInit, InsertGeometry } from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  COMPANY,
  FIELDS,
  NOTES,
  TITLE_BLOCK,
  TITLE_BLOCK_AT,
  TITLE_BLOCK_DXF,
  titleBlockDxf,
} from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/attributes/', import.meta.url));

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DIR + TITLE_BLOCK_DXF, titleBlockDxf());
}

const committed = (): DocumentInit =>
  openDocument(readCadDocument(new Uint8Array(readFileSync(DIR + TITLE_BLOCK_DXF)))).init;

const comparable = (init: DocumentInit) =>
  JSON.stringify({ ...init, header: undefined }, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

describe('title-block fixture (M2-12)', () => {
  it('commits the AC1032 DXF the generator writes', () => {
    expect(existsSync(DIR + TITLE_BLOCK_DXF)).toBe(true);
    expect(comparable(committed())).toBe(
      comparable(openDocument(readCadDocument(titleBlockDxf())).init),
    );
  });

  it('opens with the reference and its attributes, the notes multiline', () => {
    const init = committed();
    const block = (init.blocks ?? []).find((b) => b.name === TITLE_BLOCK)!;
    const ref = (init.entities ?? []).find(
      (e) => e.geom.kind === 'INSERT' && e.geom.block === block.handle,
    )!;
    const g = ref.geom as InsertGeometry;
    expect(g.position).toEqual(TITLE_BLOCK_AT);
    expect(g.attributes.map((a) => [a.tag, a.mtext ? a.mtext.contents : a.value])).toEqual([
      ...FIELDS.map((f) => [f.tag, f.value]),
      [NOTES.tag, NOTES.value],
    ]);
    const defs = (init.entities ?? [])
      .filter((e) => e.owner === block.handle && e.geom.kind === 'ATTDEF')
      .map((e) => e.geom as AttdefGeometry);
    expect(defs.find((d) => d.tag === 'REV2_DESC')?.prompt).toBe('Revision description 2');
    expect(defs.find((d) => d.tag === NOTES.tag)?.mtext).toBeDefined();
    expect(defs.find((d) => d.tag === COMPANY.tag)).toMatchObject({
      flags: 2,
      value: COMPANY.value,
    });
  });
});
