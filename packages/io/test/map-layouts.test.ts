// LAYOUT objects to Triya (M1-18), on drawings authored in memory with acad-ts.
import { ACadVersion, CadDocument, Layout } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { mapLayouts } from '../src/index';

/** A drawing with its Model tab and one layout tab, added out of tab order. */
function read(): { doc: CadDocument; sheet: Layout } {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, false);
  const sheet = new Layout('Sheet');
  sheet.tabOrder = 1;
  doc.layouts!.add(sheet);
  sheet.associatedBlock = doc.paperSpace!;
  const model = new Layout('Model');
  doc.layouts!.add(model);
  model.associatedBlock = doc.modelSpace!;
  // A layout without a block record (a damaged file) is skipped.
  doc.layouts!.add(new Layout('Broken'));
  return { doc, sheet };
}

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

describe('mapLayouts', () => {
  it('maps each layout with its block record and page setup, in tab order', () => {
    const { doc, sheet: l } = read();
    l.paperSize = 'ISO_A4_(210.00_x_297.00_MM)';
    l.paperWidth = 210;
    l.paperHeight = 297;
    l.unprintableMargin.left = 7.5;
    l.unprintableMargin.bottom = 20;
    l.unprintableMargin.right = 7.5;
    l.unprintableMargin.top = 20;
    l.paperUnits = 1;
    l.paperRotation = 1;
    l.plotOriginX = 2;
    l.plotOriginY = 3;
    l.numeratorScale = 1;
    l.denominatorScale = 2;
    l.plotType = 5;
    l.minLimits.x = -20;

    const mapped = mapLayouts(doc);
    expect(mapped.map((m) => m.name)).toEqual(['Model', l.name]);
    expect(mapped[0]!.blockRecord).toBe(H(doc.modelSpace!));
    expect(mapped[1]).toEqual(
      expect.objectContaining({
        handle: H(l),
        tabOrder: l.tabOrder,
        blockRecord: H(l.associatedBlock!),
        flags: 1,
        limits: { min: { x: -20, y: l.minLimits.y }, max: { x: l.maxLimits.x, y: l.maxLimits.y } },
        plot: {
          paperSize: 'ISO_A4_(210.00_x_297.00_MM)',
          paperWidth: 210,
          paperHeight: 297,
          margins: { left: 7.5, bottom: 20, right: 7.5, top: 20 },
          paperUnits: 'millimeters',
          rotation: 1,
          origin: { x: 2, y: 3 },
          scale: { numerator: 1, denominator: 2 },
          plotType: 5,
          flags: l.flags as number,
        },
      }),
    );
  });

  it('reads the page setup’s plot style table (DXF 7), left out when it names none', () => {
    const { doc, sheet: l } = read();
    expect(mapLayouts(doc)[1]!.plot).not.toHaveProperty('styleSheet');
    l.styleSheet = 'monochrome.ctb';
    expect(mapLayouts(doc)[1]!.plot!.styleSheet).toBe('monochrome.ctb');
  });

  it('reads inch paper and keeps an unknown rotation or unit to the defaults', () => {
    const { doc, sheet: l } = read();
    l.paperUnits = 0;
    expect(mapLayouts(doc)[1]!.plot!.paperUnits).toBe('inches');
    (l as { paperUnits: number }).paperUnits = 7;
    (l as { paperRotation: number }).paperRotation = 9;
    const p = mapLayouts(doc)[1]!.plot!;
    expect(p.paperUnits).toBe('millimeters');
    expect(p.rotation).toBe(0);
  });
});
