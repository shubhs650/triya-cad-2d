// SCALETEXT and JUSTIFYTEXT (M4-09 part 1) save and read back. The title-block drawing
// (attributes/fixture.ts, authored here per DEC-047) with a TEXT and an MTEXT added in model
// space: JUSTIFYTEXT gives them and the title block's attributes (one of them multiline) Middle
// center, SCALETEXT then scales them about their top left corners. The drawing saves as AC1032
// DXF and reopens with each object's justification, alignment points and height as edited.
import { MText, TextEntity, XYZ } from '@node-projects/acad-ts';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type InsertGeometry,
  type MTextGeometry,
  type TextGeometry,
  type TextOutline,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { titleBlockDxf } from '../attributes/fixture.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

function authored(): Uint8Array {
  const doc = readCadDocument(titleBlockDxf());
  const t = new TextEntity();
  t.value = 'GENERAL NOTES';
  t.insertPoint = new XYZ(20, 250, 0);
  t.height = 5;
  const m = new MText();
  m.insertPoint = new XYZ(20, 230, 0);
  m.height = 3.5;
  m.rectangleWidth = 100;
  m.value = 'REMOVE BURRS\\PBREAK SHARP EDGES';
  doc.entities!.add(t);
  doc.entities!.add(m);
  return writeCadDocument(doc, { format: 'dxf' });
}

/** A canvas measuring text at 0.6 of its height per character, the descent 0.2 of it. */
const canvas: ViewHost = {
  request: (r): Promise<ViewReply> => {
    if (r.op === 'textOutlines') {
      const outlines = r.texts.map((t): TextOutline | null => {
        // DXF 10 is the baseline start of a left text and of one JUSTIFYTEXT justified.
        if (t.kind !== 'TEXT' || t.rotation !== 0) return null;
        const w = t.value.length * 0.6 * t.height;
        const b = 0.2 * t.height;
        const { x, y } = t.position;
        const corners = [
          { x, y: y - b },
          { x: x + w, y: y - b },
          { x: x + w, y: y + t.height },
          { x, y: y + t.height },
        ];
        return { corners, width: w, below: b };
      });
      return Promise.resolve({ ok: true, outlines });
    }
    if (r.op === 'textFrames') {
      const frames = r.texts.map((t) => {
        const lines = t.contents.split('\\P');
        const natural = Math.max(...lines.map((l) => l.length)) * 0.6 * t.height;
        return {
          width: t.width > 0 ? t.width : natural,
          height: t.height * (1 + ((lines.length - 1) * 5) / 3),
        };
      });
      return Promise.resolve({ ok: true, frames });
    }
    return Promise.resolve({ ok: false, message: 'no view' });
  },
};

/** What the two commands change on each text, attributes by tag. */
function edited(model: DocumentModel): Record<string, unknown> {
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const pt = (p: { x: number; y: number } | undefined) => p && [r6(p.x), r6(p.y)];
  const line = (t: TextGeometry | InsertGeometry['attributes'][number]) => ({
    justify: [t.halign, t.valign],
    at: pt(t.position),
    align: pt(t.alignmentPoint),
    height: r6(t.height),
  });
  const block = (m: MTextGeometry) => ({
    attachment: m.attachment,
    at: pt(m.position),
    height: r6(m.height),
    width: r6(m.width),
  });
  const out: Record<string, unknown> = {};
  for (const e of model.entities()) {
    const g = e.geom;
    if (g.kind === 'TEXT' && g.value === 'GENERAL NOTES') out['TEXT'] = line(g);
    if (g.kind === 'MTEXT' && g.contents.startsWith('REMOVE')) out['MTEXT'] = block(g);
    if (g.kind === 'INSERT') {
      for (const a of g.attributes) out[a.tag] = a.mtext ? block(a.mtext) : line(a);
    }
  }
  return out;
}

const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

describe('SCALETEXT and JUSTIFYTEXT save as DXF and read back', () => {
  it('keeps each justification, alignment point and height as edited', async () => {
    const bytes = authored();
    const model = modelOf(bytes);
    const space = [...model.blocks.values()].find((b) => /^\*model_space$/i.test(b.name))!.handle;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: canvas,
      space: () => space,
    });
    const ids = model
      .blockEntities(space)
      .filter((id) => ['TEXT', 'MTEXT', 'INSERT'].includes(model.entity(id)!.geom.kind));
    const before = edited(model);
    await bus.submit('JUSTIFYTEXT');
    await bus.answer({ kind: 'selection', ids });
    await bus.submit('MC');
    const justified = edited(model);
    await bus.submit('SCALETEXT');
    await bus.answer({ kind: 'selection', ids });
    await bus.script(['TL', '4']);
    expect(bus.command).toBeUndefined();
    const after = edited(model);
    // Every text changed: justified, then 4 high.
    for (const [k, v] of Object.entries(after)) {
      expect(v, k).not.toEqual(before[k]);
      expect((v as { height: number }).height, k).toBe(4);
    }
    expect((justified['TEXT'] as { justify: number[] }).justify).toEqual([1, 2]);
    expect((justified['MTEXT'] as { attachment: number }).attachment).toBe(5);
    expect((justified['NOTES'] as { attachment: number }).attachment).toBe(5);

    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    expect(edited(modelOf(saved))).toEqual(after);
    // Nothing else moved: the other objects read back as they were.
    const others = (m: DocumentModel) =>
      [...m.entities()]
        .filter((e: Entity) => !['TEXT', 'MTEXT', 'INSERT'].includes(e.geom.kind))
        .map((e) => [e.handle, e.geom.kind]);
    expect(others(modelOf(saved))).toEqual(others(model));
  });
});
