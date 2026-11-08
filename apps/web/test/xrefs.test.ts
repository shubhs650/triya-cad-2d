// M1-21: the xrefs of a drawing that still wait for their file, as the drawing was opened plus
// what its engine loaded since, and which of them a dropped file answers by name.
import type { BlockTableRecord, ChangeSet, DocumentInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { fileNameOf, pendingXrefs, xrefsAnsweredBy } from '../src/xrefs';

const record = (handle: string, name: string, flags = 0): BlockTableRecord => ({
  handle,
  name,
  ...(flags ? { flags } : {}),
  units: 0,
  explodable: true,
  scalable: true,
});

const init: DocumentInit = {
  meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
  handSeed: '100',
  tables: {
    blockRecords: [
      record('1F', '*Model_Space'),
      record('30', 'TB', 4),
      record('31', 'PLAN', 12),
      record('32', 'DOOR'),
    ],
  },
  blocks: [
    { handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } },
    { handle: '30', name: 'TB', basePoint: { x: 0, y: 0 }, xrefPath: '.\\Sheets\\tb.dxf' },
    { handle: '31', name: 'PLAN', basePoint: { x: 0, y: 0 }, xrefPath: '../plan.DXF' },
    { handle: '32', name: 'DOOR', basePoint: { x: 0, y: 0 } },
  ],
};

describe('pendingXrefs (M1-21)', () => {
  it('lists attached and overlaid xrefs with their paths', () => {
    expect(pendingXrefs(init, [])).toEqual([
      { block: '30', name: 'TB', path: '.\\Sheets\\tb.dxf' },
      { block: '31', name: 'PLAN', path: '../plan.DXF' },
    ]);
  });

  it('drops a loaded xref and adds the nested xrefs its load brought in', () => {
    const tb = init.blocks![1]!;
    const load: ChangeSet = {
      tables: { blockRecords: { added: [record('40', 'GRID', 4)] } },
      blocks: {
        added: [{ handle: '40', name: 'GRID', basePoint: { x: 0, y: 0 }, xrefPath: 'grid.dxf' }],
        updated: [{ before: tb, after: { ...tb, xrefLoaded: ['40'] } }],
      },
    };
    expect(pendingXrefs(init, [load]).map((x) => x.name)).toEqual(['PLAN', 'GRID']);
  });
});

describe('xrefsAnsweredBy (M1-21)', () => {
  it('matches the file name at the end of either kind of path, without case', () => {
    expect(fileNameOf('.\\Sheets\\tb.dxf')).toBe('tb.dxf');
    expect(fileNameOf('plan.dxf')).toBe('plan.dxf');
    const pending = pendingXrefs(init, []);
    expect(xrefsAnsweredBy(pending, 'TB.dxf').map((x) => x.name)).toEqual(['TB']);
    expect(xrefsAnsweredBy(pending, 'plan.dxf').map((x) => x.name)).toEqual(['PLAN']);
    expect(xrefsAnsweredBy(pending, 'other.dxf')).toEqual([]);
  });
});
