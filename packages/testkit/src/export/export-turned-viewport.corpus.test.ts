// Layout viewports turned by ROTATE saved (M6-02 part 16): on ACadSharp's AC1032 sample
// (AutoCAD's own rectangular viewports) a viewport is copied turned 45° and then turned 30°
// itself, each clipped to its turned frame by a new closed polyline, and one turned a quarter,
// which stays rectangular; on ezdxf's text_in_viewports.dxf (AutoCAD's own clipped viewports) a
// clipped viewport turns with its boundary. Saved as AC1032 DXF (DEC-047) and read back as the
// engine has them: the viewports with their twist (DXF 51), view and frame, their boundaries
// and the reactors between them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  VIEWPORT_NON_RECT_CLIP,
  builtinCommands,
  modelPointOf,
  type Entity,
  type ViewportGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

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

/** ROTATE (or ROTATE Copy) of the viewport `v` about its frame's centre. */
async function rotate(bus: PromptBus, v: Viewport, angle: number, copy = false) {
  await bus.script(['ROTATE']);
  await bus.answer({ kind: 'selection', ids: [v.id] });
  const at = `${v.geom.center.x},${v.geom.center.y}`;
  await bus.script([at, ...(copy ? ['C'] : []), String(angle)]);
  expect(bus.command).toBeUndefined();
}

async function edit(path: string, run: (bus: PromptBus, model: DocumentModel) => Promise<void>) {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const before = viewports(model);
  const space = paperSpace(model);
  const bus = new PromptBus({ model, registry: builtinCommands(), space: () => space });
  await run(bus, model);
  const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  return { model, back, before };
}

/** Turned about its frame's centre, the sheet there shows the model point it showed. */
function keepsCentre(before: ViewportGeometry, after: ViewportGeometry) {
  const was = modelPointOf(before, before.center);
  const now = modelPointOf(after, before.center);
  expect(now.x).toBeCloseTo(was.x, 6);
  expect(now.y).toBeCloseTo(was.y, 6);
}

describe('turned viewports saved', () => {
  it('saves viewports turned by any angle, clipped to their turned frames, and a turned copy', async () => {
    const { model, back, before } = await edit(SAMPLE, async (bus, model) => {
      // Copied first: a clipped viewport is copied only with its boundary.
      const first = viewports(model)[0]!;
      await rotate(bus, first, 45, true);
      await rotate(bus, first, 30);
    });
    expect(before.length).toBeGreaterThan(0);
    const after = viewports(model);
    expect(after).toHaveLength(before.length + 1);
    const turned = [after[0]!, after.at(-1)!];
    for (const v of turned) {
      expect(v.geom.flags & VIEWPORT_NON_RECT_CLIP).toBe(VIEWPORT_NON_RECT_CLIP);
      const boundary = model.entityByHandle(v.geom.clipBoundary!)!;
      expect(boundary.geom.kind).toBe('LWPOLYLINE');
      expect(boundary.reactors).toEqual([v.handle]);
    }
    expect(after[0]!.geom.twist).toBeCloseTo(before[0]!.geom.twist + Math.PI / 6, 12);
    keepsCentre(before[0]!.geom, after[0]!.geom);
    expect(clips(back)).toEqual(clips(model));
  });

  it('saves a viewport turned a quarter, still rectangular', async () => {
    const { model, back, before } = await edit(SAMPLE, async (bus, model) => {
      await rotate(bus, viewports(model)[0]!, 90);
    });
    const v = viewports(model)[0]!;
    expect(v.geom.clipBoundary).toBeUndefined();
    expect([v.geom.width, v.geom.height]).toEqual([before[0]!.geom.height, before[0]!.geom.width]);
    keepsCentre(before[0]!.geom, v.geom);
    expect(clips(back)).toEqual(clips(model));
  });

  it('saves a clipped viewport turned with its boundary', async () => {
    let paper = 0;
    const { model, back, before } = await edit(CLIPPED, async (bus, model) => {
      paper = model.blockEntities(paperSpace(model)).length;
      const v = viewports(model).find((x) => x.geom.clipBoundary !== undefined)!;
      await bus.script(['ROTATE']);
      await bus.answer({ kind: 'selection', ids: [v.id] });
      await bus.script([`${v.geom.center.x},${v.geom.center.y}`, '20']);
    });
    // No new boundary: the old one turned along.
    expect(model.blockEntities(paperSpace(model))).toHaveLength(paper);
    const i = before.findIndex((x) => x.geom.clipBoundary !== undefined);
    const v = viewports(model)[i]!;
    expect(v.geom.clipBoundary).toBe(before[i]!.geom.clipBoundary);
    keepsCentre(before[i]!.geom, v.geom);
    expect(clips(back)).toEqual(clips(model));
  });
});
