// Clipped viewports saved (M6-02 part 2): MVIEW Polygonal and Object and VPCLIP Polygonal on
// ACadSharp's AC1032 sample (AutoCAD's own rectangular viewports), and VPCLIP Delete and a
// polygon replacing a clip on ezdxf's text_in_viewports.dxf (AutoCAD's own clipped viewports,
// each boundary listing its viewport in its reactors). Saved as AC1032 DXF (DEC-047) and read
// back as the engine has them: the viewports, their boundaries and the reactors between them.
// The ezdxf audit checks both saves (audit.py `FIXTURE_SAVES`, `vpclip`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  VIEWPORT_NON_RECT_CLIP,
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
const CLIPPED = 'third-party/ezdxf/examples_dxf/text_in_viewports.dxf';

type Viewport = Entity & { geom: ViewportGeometry };

const paperSpace = (model: DocumentModel) =>
  [...model.tables.blockRecords.values()].find((r) => r.name.toUpperCase() === '*PAPER_SPACE')!
    .handle;

/** The floating viewports of the current layout (*Paper_Space), in their order there. */
function viewports(model: DocumentModel): Viewport[] {
  return model
    .blockEntities(paperSpace(model))
    .map((id) => model.entity(id)!)
    .filter((e): e is Viewport => e.geom.kind === 'VIEWPORT' && e.geom.id !== 1);
}

/** What a save keeps of an entity: everything but the id the model gives it and its source. */
const kept = ({ id: _id, raw: _raw, ...rest }: Entity) => rest;

/** Each viewport with its clip boundary, as the save should keep both. */
const clips = (model: DocumentModel) =>
  viewports(model).map((v) => {
    const c = v.geom.clipBoundary && model.entityByHandle(v.geom.clipBoundary);
    return { viewport: kept(v), boundary: c ? kept(c) : undefined };
  });

async function edit(path: string, run: (bus: PromptBus, model: DocumentModel) => Promise<void>) {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const before = viewports(model);
  const space = paperSpace(model);
  const bus = new PromptBus({ model, registry: builtinCommands(), space: () => space });
  await run(bus, model);
  expect(bus.command).toBeUndefined();
  const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  writeAuditSave(path, 'vpclip', () => saved);
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  return { model, back, before };
}

describe('clipped viewports saved', () => {
  it('saves MVIEW Polygonal and Object and VPCLIP Polygonal beside AutoCAD’s viewports', async () => {
    const { model, back, before } = await edit(SAMPLE, async (bus, model) => {
      // MVIEW Polygonal: a new viewport clipped by the polygon drawn, an arc in it.
      await bus.script(['MVIEW', 'P', '10,10', '60,10', 'A', '60,40', 'L', '10,40', 'C']);
      // MVIEW Object: a circle drawn in paper space clips a new viewport.
      await bus.script(['CIRCLE', '120,30', '15']);
      const circle = model.blockEntities(paperSpace(model)).at(-1)!;
      await bus.script(['MVIEW', 'O']);
      await bus.answer({ kind: 'selection', ids: [circle] });
      // VPCLIP Polygonal on AutoCAD's first viewport.
      await bus.script(['VPCLIP']);
      await bus.answer({ kind: 'selection', ids: [viewports(model)[0]!.id] });
      await bus.script(['', '0,0', '80,0', '40,60', '']);
    });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((v) => v.geom.clipBoundary === undefined)).toBe(true);
    const after = viewports(model);
    expect(after).toHaveLength(before.length + 2);
    const clipped = [after[0]!, ...after.slice(-2)];
    for (const v of clipped) {
      expect(v.geom.flags & VIEWPORT_NON_RECT_CLIP).toBe(VIEWPORT_NON_RECT_CLIP);
      expect(model.entityByHandle(v.geom.clipBoundary!)!.reactors).toEqual([v.handle]);
    }
    expect(clips(back)).toEqual(clips(model));
  });

  it('saves VPCLIP Delete, which erases the boundary, and a polygon replacing a clip', async () => {
    let gone: string[] = [];
    const { model, back, before } = await edit(CLIPPED, async (bus, model) => {
      const clipped = viewports(model).filter((v) => v.geom.clipBoundary !== undefined);
      gone = clipped.slice(0, 2).map((v) => v.geom.clipBoundary!);
      // Delete, picking the viewport by its boundary.
      await bus.script(['VPCLIP']);
      await bus.answer({ kind: 'selection', ids: [model.entityByHandle(gone[0]!)!.id] });
      await bus.script(['D']);
      // A polygon drawn replaces the second viewport's clip.
      await bus.script(['VPCLIP']);
      await bus.answer({ kind: 'selection', ids: [clipped[1]!.id] });
      await bus.script(['P', '10,10', '100,10', '100,50', '']);
    });
    expect(before.filter((v) => v.geom.clipBoundary !== undefined)).toHaveLength(4);
    expect(viewports(model).filter((v) => v.geom.clipBoundary !== undefined)).toHaveLength(3);
    for (const h of gone) {
      expect(model.entityByHandle(h)).toBeUndefined();
      expect(back.entityByHandle(h)).toBeUndefined();
    }
    expect(clips(back)).toEqual(clips(model));
  });
});
