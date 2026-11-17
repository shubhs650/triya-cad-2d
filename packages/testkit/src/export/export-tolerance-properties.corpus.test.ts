// A feature control frame's Properties edits save and read back (M4-21). On every readable
// public corpus file with a dimension style, a frame placed with TOLERANCE has its Dim line
// color, Text color, Text height, Text style and Direction changed in the Properties palette
// (`applyPropertyEdit`, as the PromptBus's `setProperty` applies it). The drawing saves as AC1032 DXF (DEC-047)
// and reopens with the four DIMVARs as the frame's `DSTYLE` overrides and the frame turned, and
// the reopened frame's rows show the edited values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  ChangeSetBuilder,
  EMPTY_GDT_FRAME,
  PromptBus,
  applyPropertyEdit,
  builtinCommands,
  dimVars,
  drawnDimStyle,
  propertySheet,
  type Entity,
  type GdtFrame,
  type PropertyRow,
  type ToleranceGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const NONE = { diameter: false, value: '', material: '' } as const;
const NO_DATUM = { value: '', material: '' } as const;

const FRAME: GdtFrame = {
  rows: [
    {
      symbol: 'j',
      tolerance1: { diameter: true, value: '0.1', material: 'm' },
      tolerance2: NONE,
      datum1: { value: 'A', material: '' },
      datum2: NO_DATUM,
      datum3: NO_DATUM,
    },
    EMPTY_GDT_FRAME.rows[1],
  ],
  height: '',
  projectedZone: false,
  datumIdentifier: '',
};

function rowOf(model: DocumentModel, id: Entity['id'], label: string): PropertyRow | undefined {
  for (const s of propertySheet(model, [id]).sections) {
    const r = s.rows.find((x) => x.label === label);
    if (r) return r;
  }
  return undefined;
}

describe('a feature control frame’s Properties edits save as DXF and read back', () => {
  let edited = 0;

  it.each(readable.map((f) => [f.path, f] as const))('%s', async (_path, f) => {
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
    await withPinnedClock(async () => {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      if (model.tables.dimStyles.size === 0) return;
      const before = new Set([...model.entities()].map((e) => e.handle));
      const bus = new PromptBus({ model, registry: builtinCommands() });
      await bus.submit('TOLERANCE');
      await bus.answer({ kind: 'dialog', action: 'ok', tolerance: FRAME });
      await bus.submit('1000000,1000000');
      const made = [...model.entities()].filter((e) => !before.has(e.handle));
      expect(made.map((e) => e.type)).toEqual(['TOLERANCE']);
      const frame = made[0]!;
      const g = frame.geom as ToleranceGeometry;
      const drawn = dimVars(drawnDimStyle(model, g), frame.xdata, model);

      // Values the frame's style does not have, so each is written as an override.
      const height = (typeof drawn.DIMTXT === 'number' && drawn.DIMTXT > 0 ? drawn.DIMTXT : 1) * 2;
      const textStyle = [...model.tables.textStyles.values()].find(
        (s) => s.name !== '' && s.handle !== drawn.DIMTXSTY,
      );
      const refused: string[] = [];
      // As the palette sets a row for the frame picked at `Command:`: one change set per edit.
      const set = async (key: string, value: string) => {
        const b = new ChangeSetBuilder(model);
        const now = model.entityByHandle(frame.handle)!;
        const report = applyPropertyEdit(b, model, [now], { key, value });
        if (report.invalid) refused.push(`${key}: ${report.invalid}`);
        model.apply(b.build());
      };
      await set('dimvar:DIMCLRD', drawn.DIMCLRD === 1 ? 'aci:2' : 'aci:1');
      await set('dimvar:DIMCLRT', drawn.DIMCLRT === 5 ? 'aci:6' : 'aci:5');
      await set('dimvar:DIMTXT', String(height));
      if (textStyle) await set('dimvar:DIMTXSTY', textStyle.handle);
      await set('rotation', '30');
      expect(refused, f.path).toEqual([]);
      const mine = model.entityByHandle(frame.handle)!;
      const expected = dimVars(drawnDimStyle(model, g), mine.xdata, model);
      expect(expected.DIMTXT).toBe(height);

      const saved = saveAc1032Dxf(readCadDocument(bytes), model);
      const back = DocumentModel.create(documentInit(readCadDocument(saved)));
      const reread = back.entityByHandle(frame.handle);
      expect(reread?.type, f.path).toBe('TOLERANCE');
      const rg = reread!.geom as ToleranceGeometry;
      // DXF 11 saves the direction as a vector, so the angle reads back to rounding.
      expect({ ...rg, rotation: 0 }).toEqual({ ...mine.geom, rotation: 0 });
      expect(rg.rotation).toBeCloseTo(Math.PI / 6, 9);
      const vars = dimVars(drawnDimStyle(back, rg), reread!.xdata, back);
      for (const name of ['DIMCLRD', 'DIMCLRT', 'DIMTXT', 'DIMTXSTY']) {
        expect(vars[name], `${f.path} ${name}`).toEqual(expected[name]);
      }
      expect(rowOf(back, reread!.id, 'Text height')?.value).toBe(height);
      expect(rowOf(back, reread!.id, 'Dim line color')?.value).toBe(
        drawn.DIMCLRD === 1 ? 'aci:2' : 'aci:1',
      );
      if (textStyle) expect(rowOf(back, reread!.id, 'Text style')?.value).toBe(textStyle.handle);
      edited++;
    });
  });

  it('edited a frame in most drawings', () => {
    expect(edited).toBeGreaterThanOrEqual(90);
  });
});
