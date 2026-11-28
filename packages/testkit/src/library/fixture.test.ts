// The user library test drawing (M8-03 part 2) stays as fixture.ts authors it and reads as the
// Library palette reads a file dropped on it: its two unitless valve blocks listed and copied
// out with the file's inches. `TRIYA_UPDATE_FIXTURES=1` rewrites it (a DXF's header carries its
// save time, so the file is compared by what it maps to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  designCenterContent,
  designCenterItem,
  insUnitsOf,
  type DocumentInit,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { CHECK_VALVE, GATE_VALVE, LIBRARY_VALVES, VALVE_RADII, libraryValvesDxf } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/library/', import.meta.url));

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DIR + LIBRARY_VALVES, libraryValvesDxf());
}

const committed = (): DocumentInit =>
  openDocument(readCadDocument(new Uint8Array(readFileSync(DIR + LIBRARY_VALVES)))).init;

const comparable = (init: DocumentInit) =>
  JSON.stringify({ ...init, header: undefined }, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

describe('user library fixture (M8-03 part 2)', () => {
  it('commits the AC1032 DXF the generator writes', () => {
    expect(existsSync(DIR + LIBRARY_VALVES)).toBe(true);
    expect(comparable(committed())).toBe(
      comparable(openDocument(readCadDocument(libraryValvesDxf())).init),
    );
  });

  it('offers its two valves in inches, the blocks left unitless', () => {
    const model = DocumentModel.create(committed());
    expect(insUnitsOf(model)).toBe(1);
    expect(designCenterContent(model).blocks).toEqual([CHECK_VALVE, GATE_VALVE]);
    for (const name of [CHECK_VALVE, GATE_VALVE] as const) {
      const block = designCenterItem(model, 'blocks', name)!;
      const record = block.content.tables.blockRecords?.find((r) => r.name === name);
      expect(record?.units ?? 0).toBe(0);
      const radii = block.content.blockEntities.flatMap((e) =>
        e.geom.kind === 'CIRCLE' ? [e.geom.radius] : [],
      );
      expect(Math.max(...radii)).toBe(VALVE_RADII[name]);
    }
  });
});
