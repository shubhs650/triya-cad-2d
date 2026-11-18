// M5-04 part 9: PDFCLIP and PDFADJUST run on the PromptBus on the underlay fixture, saved as
// AC1032 DXF and read back: the boundaries (DXF 11, a rectangle's two corners and a polygon's
// vertices), the clipping, monochrome and adjust-colours bits (DXF 280), the contrast and fade
// (281, 282). CI's ezdxf audit reads the save (audit.py `FIXTURE_SAVES`, kind `pdfclip`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type DocumentModel,
  type Entity,
  type UnderlayGeometry,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const PATH = 'fixtures/underlay/pdf-underlay.dxf';
const bytes = () =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url))));

const underlays = (model: DocumentModel): (Entity & { geom: UnderlayGeometry })[] =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!)
    .filter((e): e is Entity & { geom: UnderlayGeometry } => e.geom.kind === 'PDFUNDERLAY');

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const clipOf = (g: UnderlayGeometry) => g.clip.map((p) => [r6(p.x), r6(p.y)]);

describe('PDFCLIP and PDFADJUST saves (M5-04 part 9)', () => {
  it('writes clip boundaries and display settings that read back and pass the audit', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
    });
    const [a, b] = underlays(model);
    expect(a!.geom).toMatchObject({ position: { x: 0, y: 0 }, rotation: 0, flags: 10 });
    expect(b!.geom.scale.x).toBe(0.5);
    expect(b!.geom.clip.length).toBeGreaterThan(0);
    const select = async (...es: Entity[]) => {
      await bus.answer({ kind: 'selection', ids: es.map((e) => e.id) });
    };

    // A rectangle on the first underlay (scale 1, unturned): page inches as typed.
    await bus.submit('PDFCLIP');
    await select(a!);
    await bus.script(['N', 'R', '1,2', '5,6']);
    // A polygon on the second (scale 0.5, turned 30°, clipped already: its old boundary
    // replaced), then turned off: the boundary is kept.
    const at = (x: number, y: number) => {
      const g = b!.geom;
      const c = Math.cos(g.rotation) * g.scale.x;
      const s = Math.sin(g.rotation) * g.scale.x;
      return `${g.position.x + c * x - s * y},${g.position.y + s * x + c * y}`;
    };
    await bus.submit('PDFCLIP');
    await select(b!);
    await bus.script(['N', 'Y', 'P', at(1, 1), at(7, 1), at(4, 9), '']);
    await bus.submit('PDFCLIP');
    await select(b!);
    await bus.script(['OFF']);
    // PDFADJUST: fade and monochrome on both, contrast on the first, adjust colours off.
    for (const [option, value] of [
      ['F', '40'],
      ['M', 'Y'],
      ['ACFB', 'N'],
    ]) {
      await bus.submit('PDFADJUST');
      await select(a!, b!);
      await bus.script([option!, value!]);
    }
    await bus.submit('PDFADJUST');
    await select(a!);
    await bus.script(['C', '60']);
    expect(bus.command).toBeUndefined();

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(PATH, 'pdfclip', () => out);
    const back = underlays(new EngineSession(openDocument(readCadDocument(out)).init).model);
    expect(back).toHaveLength(underlays(model).length);
    const [ra, rb] = back.map((e) => e.geom);
    expect(clipOf(ra!)).toEqual([
      [1, 2],
      [5, 6],
    ]);
    expect(ra).toMatchObject({ flags: 1 | 2 | 4, contrast: 60, fade: 40 });
    expect(clipOf(rb!)).toEqual([
      [1, 1],
      [7, 1],
      [4, 9],
    ]);
    expect(rb).toMatchObject({ flags: 2 | 4, contrast: 100, fade: 40 });
  });
});
