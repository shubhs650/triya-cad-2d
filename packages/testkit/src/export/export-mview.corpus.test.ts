// MVIEW saved (M6-02 part 1): viewports made in a layout (4 by Fit, one from corners), one turned
// off and one locked, saved as AC1032 DXF (DEC-047) and read back as the engine has them. On
// ACadSharp's AC1032 sample (AutoCAD's own layouts, viewports already in them) and on ezdxf's
// colors.dxf (layouts with no viewport, which get their own paper-space viewport first). The
// ezdxf audit checks both saves (audit.py `FIXTURE_SAVES`, `mview`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  VIEWPORT_LOCKED,
  VIEWPORT_OFF,
  builtinCommands,
  type Entity,
  type ViewportGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/', import.meta.url));
const SAMPLE = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
const NO_VIEWPORTS = 'third-party/ezdxf/examples_dxf/colors.dxf';

type Viewport = Entity & { geom: ViewportGeometry };

/** The viewports of the current layout (*Paper_Space), in their order there. */
function viewports(model: DocumentModel): Viewport[] {
  const sheet = [...model.tables.blockRecords.values()].find(
    (r) => r.name.toUpperCase() === '*PAPER_SPACE',
  )!.handle;
  return model
    .blockEntities(sheet)
    .map((id) => model.entity(id)!)
    .filter((e): e is Viewport => e.geom.kind === 'VIEWPORT');
}

/** What a save keeps of a viewport: everything but the id the model gives it and what it was read from. */
const kept = ({ id: _id, raw: _raw, ...rest }: Viewport) => rest;

async function mview(path: string) {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const before = viewports(model);
  const space = [...model.tables.blockRecords.values()].find(
    (r) => r.name.toUpperCase() === '*PAPER_SPACE',
  )!.handle;
  const bus = new PromptBus({ model, registry: builtinCommands(), space: () => space });
  await bus.script(['MVIEW', '4', 'F', 'MVIEW', '10,10', '60,40']);
  const made = viewports(model).slice(before.length);
  await bus.script(['MVIEW', 'OFF']);
  await bus.answer({ kind: 'selection', ids: [made.at(-2)!.id] });
  await bus.script(['MVIEW', 'L', 'ON']);
  await bus.answer({ kind: 'selection', ids: [made.at(-1)!.id] });
  expect(bus.command).toBeUndefined();
  const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  writeAuditSave(path, 'mview', () => saved);
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  return { before, after: viewports(model), back: viewports(back) };
}

describe('MVIEW saved', () => {
  it('adds viewports beside AutoCAD’s own and reads them back as made', async () => {
    const { before, after, back } = await mview(SAMPLE);
    expect(before.length).toBeGreaterThan(0);
    expect(after).toHaveLength(before.length + 5);
    expect(back.map(kept)).toEqual(after.map(kept));
    const made = back.slice(before.length).map((e) => e.geom);
    // Numbered after AutoCAD's own, uniquely.
    expect(new Set(back.map((e) => e.geom.id)).size).toBe(back.length);
    expect(made.at(-2)!.flags & VIEWPORT_OFF).toBe(VIEWPORT_OFF);
    expect(made.at(-2)!.status).toBe(0);
    expect(made.at(-1)!.flags & VIEWPORT_LOCKED).toBe(VIEWPORT_LOCKED);
    expect(made.at(-1)).toMatchObject({ center: { x: 35, y: 25 }, width: 50, height: 30 });
  });

  it('gives a layout with no viewport its own paper-space one first', async () => {
    const { before, after, back } = await mview(NO_VIEWPORTS);
    expect(before).toEqual([]);
    expect(after.map((e) => e.geom.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(back.map(kept)).toEqual(after.map(kept));
  });
});
