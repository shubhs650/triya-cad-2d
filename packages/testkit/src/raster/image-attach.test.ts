// M5-04 part 5: IMAGEATTACH run on the PromptBus, saved as AC1032 DXF and read back. On ezdxf's
// colors.dxf, which has no images, the save creates the drawing's ACAD_IMAGE_DICT for the new
// IMAGEDEFs (and their IMAGEDEF_REACTORs); on ezdxf's images.dxf, a file it shows already is
// attached with its own definition and a new one joins its dictionary. CI's ezdxf audit reads both
// saves (audit.py `FIXTURE_SAVES`, kind `imageattach`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type DocumentModel,
  type ImageAttachSettings,
  type ImageDefinition,
  type ImageGeometry,
  type PromptAnswer,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const corpus = (path: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );

const images = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'IMAGE');
const definitions = (model: DocumentModel) =>
  [...model.objects.values()].filter((o): o is ImageDefinition => o.type === 'IMAGEDEF');

const FIXED: ImageAttachSettings = {
  pointOnScreen: false,
  point: { x: 0, y: 0 },
  scaleOnScreen: false,
  scale: 1,
  rotationOnScreen: false,
  rotation: 0,
};

/** The drawing at `path` opened, and IMAGEATTACH of `file` with `settings` (then `steps`). */
async function attachAll(
  path: string,
  attach: { file: object; settings: Partial<ImageAttachSettings>; steps?: string[] }[],
) {
  const model = new EngineSession(openDocument(readCadDocument(corpus(path))).init).model;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: false, message: '' }) },
  });
  for (const a of attach) {
    await bus.submit('IMAGEATTACH');
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      imageAttach: { file: a.file, settings: { ...FIXED, ...a.settings } },
    } as PromptAnswer);
    await bus.script(a.steps ?? []);
    expect(bus.command).toBeUndefined();
  }
  const out = saveAc1032Dxf(readCadDocument(corpus(path)), model);
  const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
  return { model, out, back };
}

const PLAN = { fileName: 'plan.png', width: 300, height: 150, ppi: { x: 150, y: 150 } };
const PHOTO = { fileName: 'photo.jpg', width: 200, height: 100 };

describe('IMAGEATTACH saves (M5-04 part 5)', () => {
  it('writes new images and the dictionary of a drawing without images, which read back', async () => {
    const path = 'third-party/ezdxf/examples_dxf/colors.dxf';
    const { model, out, back } = await attachAll(path, [
      { file: PLAN, settings: { point: { x: 10, y: 20 }, scale: 2 } },
      { file: PHOTO, settings: { point: { x: 100, y: 0 }, scale: 50, rotation: Math.PI / 6 } },
      // The same file again, on screen: one definition shows both.
      { file: PLAN, settings: { pointOnScreen: true, scaleOnScreen: true }, steps: ['0,100', '3'] },
    ]);
    writeAuditSave(path, 'imageattach', () => out);
    expect(images(model)).toHaveLength(3);
    const defs = definitions(back);
    expect(defs.map((d) => [d.name, d.fileName, d.units]).sort()).toEqual([
      ['photo', 'photo.jpg', 0],
      ['plan', 'plan.png', 5],
    ]);
    expect(back.meta.imageDictionary).toBeDefined();
    for (const d of defs) expect(d.owner).toBe(back.meta.imageDictionary);
    const plan = defs.find((d) => d.name === 'plan')!;
    expect(plan.size).toEqual({ x: 300, y: 150 });
    expect(plan.pixelSize.x).toBeCloseTo(1 / 150, 12);

    const was = images(model).map((e) => e.geom as ImageGeometry);
    const now = images(back).map((e) => e.geom as ImageGeometry);
    expect(now).toHaveLength(3);
    now.forEach((g, i) => {
      const w = was[i]!;
      for (const k of ['position', 'u', 'v'] as const) {
        expect(g[k].x).toBeCloseTo(w[k].x, 9);
        expect(g[k].y).toBeCloseTo(w[k].y, 9);
      }
      expect(g.size).toEqual(w.size);
      expect(g.clipping).toBe(false);
    });
    expect(now[0]!.definition).toBe(now[2]!.definition);
    expect(now[2]!.position).toEqual({ x: 0, y: 100 });
  });

  it('attaches a file a drawing shows with its definition, a new one in its dictionary', async () => {
    const path = 'third-party/ezdxf/examples_dxf/images.dxf';
    const before = new EngineSession(openDocument(readCadDocument(corpus(path))).init).model;
    const known = definitions(before)[0]!;
    const { model, out, back } = await attachAll(path, [
      {
        file: { fileName: known.fileName, width: known.size.x, height: known.size.y },
        settings: { point: { x: -50, y: -50 }, scale: 10 },
      },
      { file: PHOTO, settings: { point: { x: -80, y: -50 }, scale: 20 } },
    ]);
    writeAuditSave(path, 'imageattach', () => out);
    const added = images(model).slice(-2);
    expect((added[0]!.geom as ImageGeometry).definition).toBe(known.handle);
    expect(definitions(back)).toHaveLength(definitions(before).length + 1);
    const photo = definitions(back).find((d) => d.fileName === 'photo.jpg')!;
    expect(photo.owner).toBe(known.owner);
    expect(images(back)).toHaveLength(images(before).length + 2);
  });
});
