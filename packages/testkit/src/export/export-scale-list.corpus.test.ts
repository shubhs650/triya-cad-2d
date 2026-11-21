// SCALELISTEDIT saved (M6-02 part 21): the drawing's scale list edited at the command line
// (-SCALELISTEDIT Add, Delete, Reset) and as the Edit Drawing Scales dialog's OK states it (a
// scale moved up, renamed and given another ratio), saved as AC1032 DXF (DEC-047) and read back
// as the engine has it: every SCALE by handle, with its key, name, units and DXF 290. On
// ACadSharp's AC1032 sample (AutoCAD's keys A0 …, an annotative TEXT naming 1:1), on one of its
// dynamic block samples (scales keyed by name) and on ezdxf's colors.dxf, whose ACAD_SCALELIST is
// empty. The ezdxf audit checks the saves (audit.py `FIXTURE_SAVES`, `scalelist`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  drawingScales,
  editedList,
  scaleListProblem,
  writeScaleList,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/', import.meta.url));
const SAMPLE = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
const FILES = [
  SAMPLE,
  'third-party/acadsharp/dynamic-blocks/BLOCKFLIPPARAMETER.dxf',
  'third-party/ezdxf/examples_dxf/colors.dxf',
];

/** What a save keeps of each scale: everything but what it was read from. */
const scales = (model: DocumentModel) =>
  drawingScales(model).map(({ raw: _raw, ...rest }: { raw?: unknown } & object) => rest);

async function edited(path: string) {
  const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const before = drawingScales(model).length;
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  await bus.script(['-SCALELISTEDIT', 'R', 'Y', 'A', 'Site', '1:500', 'A', 'Detail', '5:1']);
  await bus.script(['D', '1:4', 'D', '1:1', 'E']);
  expect(bus.command).toBeUndefined();
  // The dialog's OK: Site moved to the top, 1:2 renamed Half and made 1:3.
  const list = editedList({ model });
  const site = list.findIndex((s) => s.name === 'Site');
  const ok = [
    list[site]!,
    ...list
      .filter((_, i) => i !== site)
      .map((s) => (s.name === '1:2' ? { ...s, name: 'Half', drawingUnits: 3 } : s)),
  ];
  expect(scaleListProblem(model, ok)).toBeUndefined();
  const b = new ChangeSetBuilder(model);
  writeScaleList(model, b, ok);
  model.apply(b.build());
  const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
  writeAuditSave(path, 'scalelist', () => saved);
  const back = DocumentModel.create(documentInit(readCadDocument(saved)));
  return { before, model, back, log };
}

describe('SCALELISTEDIT saved', () => {
  for (const path of FILES) {
    it(`writes the scale list of ${path} as edited`, async () => {
      const { model, back } = await edited(path);
      expect(drawingScales(back).map((s) => `${s.key} ${s.name} ${s.handle}`)).toEqual(
        drawingScales(model).map((s) => `${s.key} ${s.name} ${s.handle}`),
      );
      expect(scales(back)).toEqual(scales(model));
      const names = drawingScales(back).map((s) => s.name);
      expect(names.slice(0, 2)).toEqual(['Site', '1:1']);
      expect(names).toContain('Half');
      expect(names).toContain('Detail');
      expect(names).not.toContain('1:4');
      // Numbered A0 … as AutoCAD keys them.
      expect(drawingScales(back).map((s) => s.key)).toEqual(
        drawingScales(back).map(
          (_, i) => `${String.fromCharCode(65 + Math.floor(i / 10))}${i % 10}`,
        ),
      );
    });
  }

  it('keeps 1:1, which the AC1032 sample’s annotative TEXT names', async () => {
    const { before, back, log } = await edited(SAMPLE);
    expect(before).toBe(33);
    expect(log).toContain('Scale "1:1" is used by an annotative object and cannot be deleted.');
    // Its representation still names it, as read.
    const text = back.entityByHandle('3BA')!;
    const scale = text.annotative!.representations[0]!.scale!;
    expect(back.objects.get(scale)).toMatchObject({ type: 'SCALE', name: '1:1', unitScale: true });
  });
});
