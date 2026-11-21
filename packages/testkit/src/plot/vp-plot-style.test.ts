// M6-07: a layer's plot style overridden in a layout viewport, on the thread-authored
// named-plot-style drawing (packages/testkit/fixtures/plot-styles/named-plot-styles.dxf, written
// by scripts/fixtures/named-plot-styles.py; DEC-047). Its Layout1 has two viewports on one plan;
// WALLS plots by Heavy, PIPING by Normal and by Light in the right viewport, an override filed as
// the layer's ADSK_XREC_LAYER_PLOTSTYLE_OVR XRECORD (DEC-078). The override is read, plotted in
// that viewport only, and written back as VPLAYER PStyle and the manager's VP Plot Style change
// it; the save is kept for the ezdxf audit (audit.py `FIXTURE_SAVES`, `vplayer`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  layoutViewports,
  type LayerRecord,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { PlotResolver, newPlotStyle, plotParts, type PlotStyleTable } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const PATH = 'fixtures/plot-styles/named-plot-styles.dxf';
const bytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL(`../../${PATH}`, import.meta.url))),
);
const open = () => DocumentModel.create(documentInit(readCadDocument(bytes)));

const layer = (model: DocumentModel, name: string): LayerRecord =>
  [...model.tables.layers.values()].find((l) => l.name === name)!;
const style = (model: DocumentModel, name: string) =>
  [...model.tables.plotStyles.values()].find((s) => s.name === name)!.handle;
/** Layout1's two viewports, left then right. */
const viewports = (model: DocumentModel) =>
  layoutViewports(model)
    .map((e) => ({ handle: e.handle, x: e.geom.center.x }))
    .sort((a, b) => a.x - b.x)
    .map((v) => v.handle);
const layoutBlock = (model: DocumentModel) =>
  model.layouts.find((l) => l.name === 'Layout1')!.blockRecord;
/** The layers as a save keeps them, by name: plot style and overrides. */
const layers = (model: DocumentModel) =>
  [...model.tables.layers.values()]
    .map((l) => ({
      name: l.name,
      plotStyle: l.plotStyle,
      overrides: JSON.parse(JSON.stringify(l.viewportOverrides ?? [])) as unknown,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** A named table with Normal, Heavy and Light, so each part says which style it took. */
const TABLE: PlotStyleTable = {
  kind: 'stb',
  description: '',
  scaleFactor: 1,
  applyFactor: false,
  lineweightUnits: 'mm',
  lineweights: [0.25],
  styles: ['Normal', 'Heavy', 'Light'].map(newPlotStyle),
};
/** How many of PIPING's plotted parts took each plot style. */
function pipingStyles(model: DocumentModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of plotParts(model, layoutBlock(model), { resolver: new PlotResolver(TABLE) }))
    if (p.layer === 'PIPING') out[p.paint.style ?? ''] = (out[p.paint.style ?? ''] ?? 0) + 1;
  return out;
}

describe('the viewport plot style override (M6-07)', () => {
  it('reads PIPING’s override in the right viewport, a named-plot-style drawing', () => {
    const model = open();
    const [, right] = viewports(model);
    expect(model.header.get('$PSTYLEMODE')).toBe(0);
    expect([...model.tables.plotStyles.values()].map((s) => s.name).sort()).toEqual([
      'Heavy',
      'Light',
      'Normal',
    ]);
    expect(layer(model, 'WALLS').plotStyle).toBe(style(model, 'Heavy'));
    expect(layer(model, 'PIPING').viewportOverrides).toEqual([
      { viewport: right, plotStyle: style(model, 'Light') },
    ]);
  });

  it('plots PIPING by Light in the right viewport and by Normal in the left', () => {
    const counts = pipingStyles(open());
    expect(counts['Light']).toBeGreaterThan(0);
    expect(counts['Normal']).toBe(counts['Light']);
  });

  it('writes the overrides VPLAYER PStyle and VP Plot Style make, and reads them back', async () => {
    const model = open();
    const [left, right] = viewports(model);
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      space: () => layoutBlock(model),
    });
    // WALLS on Light in both viewports (a new record), PIPING's right one rewritten to Heavy.
    await bus.script(['VPLAYER', 'PS', 'Light', 'WALLS', 'A']);
    await bus.script(['PS', 'Heavy', 'PIPING', 'A', '']);
    expect(bus.command).toBeUndefined();
    expect(layer(model, 'PIPING').viewportOverrides).toEqual([
      { viewport: right, plotStyle: style(model, 'Heavy') },
      { viewport: left, plotStyle: style(model, 'Heavy') },
    ]);
    expect(pipingStyles(model)).toEqual({ Heavy: pipingStyles(open())['Light']! * 2 });
    withPinnedClock(() => {
      const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
      writeAuditSave(PATH, 'vplayer', save);
      const back = DocumentModel.create(documentInit(readCadDocument(save())));
      expect(layers(back)).toEqual(layers(model));
    });
  });

  it('removes the record with the last override, the others kept', () => {
    const session = new EngineSession(documentInit(readCadDocument(bytes)));
    const model = session.model;
    const [, right] = viewports(model);
    const piping = layer(model, 'PIPING');
    expect(
      session.edit({
        kind: 'viewport-layer',
        layer: piping.handle,
        viewport: right!,
        plotStyle: style(model, 'Normal'),
        lineweight: 50,
      }),
    ).toMatchObject({ ok: true });
    expect(layer(model, 'PIPING').viewportOverrides).toEqual([{ viewport: right, lineweight: 50 }]);
    withPinnedClock(() => {
      const saved = readCadDocument(saveAc1032Dxf(readCadDocument(bytes), model));
      const xdict = saved.layers!.tryGetValue('PIPING')!.xDictionary!;
      expect(xdict.getEntry('ADSK_XREC_LAYER_PLOTSTYLE_OVR')).toBeNull();
      expect(xdict.getEntry('ADSK_XREC_LAYER_LINEWT_OVR')).not.toBeNull();
      const back = DocumentModel.create(documentInit(saved));
      expect(layers(back)).toEqual(layers(model));
    });
  });
});
