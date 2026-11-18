// M5-04 part 8: PDFATTACH run on the PromptBus, saved as AC1032 DXF and read back. On ezdxf's
// colors.dxf, which has no underlays, the save creates the drawing's ACAD_PDFDEFINITIONS for the
// new PDFDEFINITIONs; on the underlay fixture, a page it shows already is attached with its own
// definition and a new page joins its dictionary. CI's ezdxf audit reads both saves (audit.py
// `FIXTURE_SAVES`, kind `pdfattach`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type DocumentModel,
  type PdfAttachSettings,
  type PdfDefinition,
  type PromptAnswer,
  type UnderlayGeometry,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const bytesOf = (path: string) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(
        path.startsWith('fixtures/')
          ? new URL(`../../${path}`, import.meta.url)
          : new URL(`../../../../corpus/public/${path}`, import.meta.url),
      ),
    ),
  );

const underlays = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'PDFUNDERLAY');
const definitions = (model: DocumentModel) =>
  [...model.objects.values()].filter((o): o is PdfDefinition => o.type === 'PDFDEFINITION');

const FIXED: PdfAttachSettings = {
  pointOnScreen: false,
  point: { x: 0, y: 0 },
  scaleOnScreen: false,
  scale: 1,
  rotationOnScreen: false,
  rotation: 0,
};

/** The drawing at `path` opened, and PDFATTACH of each file with its settings (then steps). */
async function attachAll(
  path: string,
  attach: { file: object; settings: Partial<PdfAttachSettings>; steps?: string[] }[],
) {
  const model = new EngineSession(openDocument(readCadDocument(bytesOf(path))).init).model;
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: false, message: '' }) },
  });
  for (const a of attach) {
    await bus.submit('PDFATTACH');
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      pdfAttach: { file: a.file, settings: { ...FIXED, ...a.settings } },
    } as PromptAnswer);
    await bus.script(a.steps ?? []);
    expect(bus.command).toBeUndefined();
  }
  const out = saveAc1032Dxf(readCadDocument(bytesOf(path)), model);
  const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
  return { model, out, back };
}

const A4 = { page: '1', width: 8.27, height: 11.69 };
const A3 = { page: '2', width: 16.54, height: 11.69 };

describe('PDFATTACH saves (M5-04 part 8)', () => {
  it('writes new underlays and the dictionary of a drawing without underlays, which read back', async () => {
    const path = 'third-party/ezdxf/examples_dxf/colors.dxf';
    const { model, out, back } = await attachAll(path, [
      { file: { fileName: 'set.pdf', pages: [A4, A3] }, settings: { point: { x: 10, y: 20 } } },
      {
        file: { fileName: 'plan.pdf', pages: [A3] },
        settings: { point: { x: 0, y: -20 }, scale: 0.5, rotation: Math.PI / 6 },
      },
      // A page attached already, on screen: one definition shows both.
      {
        file: { fileName: 'set.pdf', pages: [A4] },
        settings: { pointOnScreen: true, scaleOnScreen: true },
        steps: ['0,100', '2'],
      },
    ]);
    writeAuditSave(path, 'pdfattach', () => out);
    expect(underlays(model)).toHaveLength(4);
    const defs = definitions(back);
    expect(defs.map((d) => [d.name, d.fileName, d.page]).sort()).toEqual([
      ['plan - 2', 'plan.pdf', '2'],
      ['set - 1', 'set.pdf', '1'],
      ['set - 2', 'set.pdf', '2'],
    ]);
    expect(back.meta.pdfDictionary).toBeDefined();
    for (const d of defs) expect(d.owner).toBe(back.meta.pdfDictionary);

    const was = underlays(model).map((e) => e.geom as UnderlayGeometry);
    const now = underlays(back).map((e) => e.geom as UnderlayGeometry);
    expect(now).toHaveLength(4);
    now.forEach((g, i) => {
      const w = was[i]!;
      expect(g.position.x).toBeCloseTo(w.position.x, 9);
      expect(g.position.y).toBeCloseTo(w.position.y, 9);
      expect(g.scale.x).toBeCloseTo(w.scale.x, 9);
      expect(g.scale.y).toBeCloseTo(w.scale.y, 9);
      expect(g.rotation).toBeCloseTo(w.rotation, 9);
      expect(g.flags).toBe(10);
      expect(g.contrast).toBe(100);
      expect(g.fade).toBe(0);
      expect(g.clip).toEqual([]);
    });
    expect(now[0]!.definition).toBe(now[3]!.definition);
    expect(now[3]!.position).toEqual({ x: 0, y: 100 });
  });

  it('attaches a page a drawing shows with its definition, a new page in its dictionary', async () => {
    const path = 'fixtures/underlay/pdf-underlay.dxf';
    const before = new EngineSession(openDocument(readCadDocument(bytesOf(path))).init).model;
    const known = definitions(before);
    expect(known.map((d) => d.name).sort()).toEqual(['pdf-underlay - 1', 'pdf-underlay - 2']);
    const { model, out, back } = await attachAll(path, [
      {
        file: {
          fileName: 'pdf-underlay.pdf',
          pages: [
            { ...A4, page: '2' },
            { ...A4, page: '3' },
          ],
        },
        settings: { point: { x: 40, y: 0 } },
      },
    ]);
    writeAuditSave(path, 'pdfattach', () => out);
    const added = underlays(model).slice(-2);
    expect((added[0]!.geom as UnderlayGeometry).definition).toBe(
      known.find((d) => d.page === '2')!.handle,
    );
    const defs = definitions(back);
    expect(defs).toHaveLength(known.length + 1);
    const third = defs.find((d) => d.page === '3')!;
    expect(third).toMatchObject({ name: 'pdf-underlay - 3', fileName: 'pdf-underlay.pdf' });
    expect(third.owner).toBe(known[0]!.owner);
    expect(underlays(back)).toHaveLength(underlays(before).length + 2);
  });
});
