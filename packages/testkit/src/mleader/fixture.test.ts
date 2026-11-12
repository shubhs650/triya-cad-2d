// The multileader editing test drawing (M2-44) stays as fixture.ts authors it and opens with
// the multileaders it means. `TRIYA_UPDATE_FIXTURES=1` rewrites it (a DXF's header carries its
// save time, so the file is compared by what it maps to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocumentInit, MultiLeaderGeometry } from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  MLEADER_EDIT_DXF,
  NOTE_MASK,
  NOTE_TEXT,
  TAG_BLOCK,
  TAG_VALUE,
  mleaderEditDxf,
} from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/mleader/', import.meta.url));

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DIR + MLEADER_EDIT_DXF, mleaderEditDxf());
}

const committed = (): DocumentInit =>
  openDocument(readCadDocument(new Uint8Array(readFileSync(DIR + MLEADER_EDIT_DXF)))).init;

const comparable = (init: DocumentInit) =>
  JSON.stringify({ ...init, header: undefined }, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

describe('multileader editing fixture (M2-44)', () => {
  it('commits the AC1032 DXF the generator writes', () => {
    expect(existsSync(DIR + MLEADER_EDIT_DXF)).toBe(true);
    expect(comparable(committed())).toBe(
      comparable(openDocument(readCadDocument(mleaderEditDxf())).init),
    );
  });

  it('opens with a framed, masked text multileader and a block one stating its value', () => {
    const init = committed();
    const leaders = (init.entities ?? [])
      .filter((e) => e.geom.kind === 'MULTILEADER')
      .map((e) => e.geom as MultiLeaderGeometry);
    expect(leaders).toHaveLength(2);
    const [note, tag] = leaders;
    expect(note!.textFrame).toBe(true);
    expect(note!.text).toMatchObject({
      content: NOTE_TEXT,
      mask: { color: { kind: 'rgb', ...NOTE_MASK }, scale: 1.5 },
    });
    const block = (init.blocks ?? []).find((b) => b.name === TAG_BLOCK)!;
    expect(tag!.block?.block).toBe(block.handle);
    expect(tag!.block?.attributes?.map((a) => a.value)).toEqual([TAG_VALUE]);
  });
});
