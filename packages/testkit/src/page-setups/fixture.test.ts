// The named page setups test drawing (M2-17 part 6) stays as fixture.ts authors it and opens with
// the page setups it means. `TRIYA_UPDATE_FIXTURES=1` rewrites it (a DXF's header carries its save
// time, so the file is compared by what it maps to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type DocumentInit,
  type NamedPageSetup,
} from '@triya/engine';
import { exportDocument, mapPageSetups, openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { PAGE_SETUPS, PAGE_SETUPS_DXF, pageSetupsDxf } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/page-setups/', import.meta.url));

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DIR + PAGE_SETUPS_DXF, pageSetupsDxf());
}

const committed = (): DocumentInit =>
  openDocument(readCadDocument(new Uint8Array(readFileSync(DIR + PAGE_SETUPS_DXF)))).init;

const comparable = (init: DocumentInit) =>
  JSON.stringify({ ...init, header: undefined }, (_k, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

describe('page-setups fixture (M2-17 part 6)', () => {
  it('commits the AC1032 DXF the generator writes', () => {
    expect(existsSync(DIR + PAGE_SETUPS_DXF)).toBe(true);
    expect(comparable(committed())).toBe(
      comparable(openDocument(readCadDocument(pageSetupsDxf())).init),
    );
  });

  it("opens with Model, Layout1 and three named page setups, two of them model space's", () => {
    const init = committed();
    expect((init.layouts ?? []).map((l) => [l.name, l.plot?.paperWidth])).toEqual([
      ['Model', 297],
      ['Layout1', 297],
    ]);
    const setups = (init.objects ?? []).filter(
      (o): o is NamedPageSetup => o.type === 'PLOTSETTINGS',
    );
    expect(setups.map((s) => [s.name, s.model])).toEqual([
      ['A3 Monochrome', false],
      ['Model A1 Fit', true],
      ['Model ANSI B 1:2', true],
    ]);
    for (const spec of PAGE_SETUPS) {
      const s = setups.find((p) => p.name === spec.name)!;
      expect(s.plot).toMatchObject({
        paperSize: spec.paperSize,
        paperWidth: spec.width,
        paperHeight: spec.height,
        paperUnits: spec.units === 0 ? 'inches' : 'millimeters',
        plotType: spec.plotType,
        flags: spec.flags,
        scale: spec.scale,
      });
      if (spec.styleSheet) expect(s.plot.styleSheet).toBe(spec.styleSheet);
      else expect(s.plot).not.toHaveProperty('styleSheet');
    }
  });

  it('keeps the named page setups as they were through a save that changes a layout', () => {
    const bytes = new Uint8Array(readFileSync(DIR + PAGE_SETUPS_DXF));
    const before = mapPageSetups(readCadDocument(bytes));
    const model = DocumentModel.create(openDocument(readCadDocument(bytes)).init);
    const layout1 = model.layouts.find((l) => l.name === 'Layout1')!;
    // Apply to Layout of "A3 Monochrome": its settings into Layout1's own page setup.
    const a3 = before.find((p) => p.name === 'A3 Monochrome')!;
    const b = new ChangeSetBuilder(model);
    b.updateLayout(layout1.handle, { plot: a3.plot });
    model.apply(b.build());
    const saved = readCadDocument(exportDocument(readCadDocument(bytes), model, { format: 'dxf' }));
    expect(mapPageSetups(saved)).toEqual(before);
    const reopened = openDocument(saved).init.layouts!.find((l) => l.name === 'Layout1')!;
    expect(reopened.plot).toMatchObject({ paperWidth: 420, styleSheet: 'monochrome.ctb' });
  });
});
