// M5-05 part 4: the Layer Properties Manager's Merge to Layer: the layers a merge may go into
// (not the layers merged, none of an xref's) and AutoCAD's question before merging. M5-19 part 2:
// the rows mark unreconciled layers, which Reconcile Layer is offered for.
import type { DocumentInit, LayerRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mergeQuestion, mergeTargets, reconcilable } from '../src/LayerListMenu';
import { layerRows } from '../src/layers';

const layer = (handle: string, name: string, flags?: number): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...(flags !== undefined && { flags }),
});

const init: DocumentInit = {
  meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
  handSeed: '40',
  header: [['$CLAYER', '0']],
  tables: {
    layers: [
      layer('10', '0'),
      layer('11', 'Old'),
      layer('12', 'Older'),
      layer('13', 'Site|Walls', 16 | 32),
      layer('14', 'Notes'),
      { ...layer('15', 'Site|Grid', 16 | 32), unreconciled: true },
    ],
  },
};

describe('Merge to Layer (M5-05 part 4)', () => {
  it("marks an xref's layers and offers the rest but the layers merged as targets", () => {
    const rows = layerRows(init, []);
    expect(rows.filter((r) => r.xref).map((r) => r.name)).toEqual(['Site|Grid', 'Site|Walls']);
    expect(mergeTargets(rows, new Set(['11', '12'])).map((r) => r.name)).toEqual(['0', 'Notes']);
  });

  it('asks as AutoCAD does, naming every layer merged', () => {
    expect(mergeQuestion(['Old'], 'Notes')).toBe(
      'Merging layer "Old" into layer "Notes". Do you want to continue?',
    );
    expect(mergeQuestion(['Old', 'Older'], 'Notes')).toBe(
      'Merging layers "Old", "Older" into layer "Notes". Do you want to continue?',
    );
  });
});

describe('Reconcile Layer (M5-19 part 2)', () => {
  it('marks the unreconciled layers, and is offered when one of them is selected', () => {
    const rows = layerRows(init, []);
    expect(rows.filter((r) => r.unreconciled).map((r) => r.name)).toEqual(['Site|Grid']);
    const pick = (...names: string[]) => rows.filter((r) => names.includes(r.name));
    expect(reconcilable(pick('Notes', 'Site|Grid'))).toBe(true);
    expect(reconcilable(pick('Notes', 'Site|Walls'))).toBe(false);
    expect(reconcilable([])).toBe(false);
  });
});
