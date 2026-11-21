// -VPORTS saved (M6-02 part 10): model space's tiled viewports rearranged (3 Above, 4, SIngle)
// and named configurations saved, restored and deleted, saved as AC1032 DXF (DEC-047) and read
// back as the engine has them: every VPORT record by handle, the `*Active` ones in their order
// (the first is the current viewport). On ACadSharp's AC1032 sample and ezdxf's colors.dxf, each
// with one `*Active` VPORT. The ezdxf audit checks both saves (audit.py `FIXTURE_SAVES`, `vports`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  modelTiles,
  viewportConfigurations,
  type VportRecord,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/', import.meta.url));
const FILES = [
  'third-party/acadsharp/sample_AC1032_ascii.dxf',
  'third-party/ezdxf/examples_dxf/colors.dxf',
];

/** What a save keeps of a record: everything but what it was read from. */
const kept = ({ raw: _raw, ...rest }: VportRecord & { raw?: unknown }) => rest;

const records = (model: DocumentModel) =>
  [...model.tables.vports.values()].map((v) => kept(v as VportRecord & { raw?: unknown }));

async function vports(path: string) {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const before = [...model.tables.vports.values()];
  const ms = [...model.tables.blockRecords.values()].find(
    (r) => r.name.toUpperCase() === '*MODEL_SPACE',
  )!.handle;
  const bus = new PromptBus({ model, registry: builtinCommands(), space: () => ms });
  await bus.script(['-VPORTS', '3', 'Above', '-VPORTS', 'S', 'Three up']);
  await bus.script(['-VPORTS', 'SI', '-VPORTS', 'S', 'Gone', '-VPORTS', '2', 'H']);
  await bus.script(['-VPORTS', 'S', 'Halves', '-VPORTS', 'R', 'three UP']);
  await bus.script(['-VPORTS', '4', '-VPORTS', 'D', 'gone']);
  expect(bus.command).toBeUndefined();
  const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  writeAuditSave(path, 'vports', () => saved);
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  return { before, model, back };
}

describe('-VPORTS saved', () => {
  for (const path of FILES) {
    it(`writes the tiles and named configurations of ${path} as made`, async () => {
      const { before, model, back } = await vports(path);
      expect(before.filter((v) => v.name.toUpperCase() === '*ACTIVE')).toHaveLength(1);
      expect(records(back)).toEqual(records(model));
      // Three up's large tile divided in four, then its other two: six tiles, in order.
      const tiles = modelTiles(back.tables.vports.values());
      expect(tiles).toHaveLength(6);
      expect(tiles[0]!.vport!.handle).toBe(before.find((v) => v.name === '*Active')?.handle);
      expect(tiles.map((t) => t.rect)).toEqual([
        { left: 0, top: 0, width: 0.5, height: 0.25 },
        { left: 0.5, top: 0, width: 0.5, height: 0.25 },
        { left: 0, top: 0.25, width: 0.5, height: 0.25 },
        { left: 0.5, top: 0.25, width: 0.5, height: 0.25 },
        { left: 0, top: 0.5, width: 0.5, height: 0.5 },
        { left: 0.5, top: 0.5, width: 0.5, height: 0.5 },
      ]);
      expect(viewportConfigurations(back.tables.vports.values()).map((c) => c.name)).toEqual([
        'Halves',
        'Three up',
      ]);
    });
  }
});
