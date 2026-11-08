// M1-21: the xrefs of a drawing that still wait for their file, as the drawing was opened plus
// what its engine loaded since, and which of them a dropped file answers by name.
import type {
  BlockTableRecord,
  ChangeSet,
  DocumentInit,
  Entity,
  ImageDefinition,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  fileNameOf,
  loadXrefFiles,
  missingFileNames,
  pendingXrefs,
  referencesOf,
  xrefsAnsweredBy,
  type PendingXref,
} from '../src/xrefs';

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

const imageDef = (handle: string, fileName: string, loaded = true): ImageDefinition =>
  ({
    handle,
    type: 'IMAGEDEF',
    owner: 'D',
    name: fileName.replace(/^.*[\\/]|\.[^.]*$/g, ''),
    fileName,
    size: { x: 8, y: 8 },
    pixelSize: { x: 1, y: 1 },
    loaded,
  }) as unknown as ImageDefinition;

const insertOf = (handle: string, owner: string, block: string): Entity =>
  ({
    id: 0,
    handle,
    owner,
    layer: '10',
    geom: { kind: 'INSERT', block, position: { x: 0, y: 0 } },
  }) as unknown as Entity;

/** TB loaded: it brings in the attached xref GRID (inserted twice) and an image. */
function tbLoad(): ChangeSet {
  const tb = init.blocks![1]!;
  return {
    tables: { blockRecords: { added: [record('40', 'GRID', 4)] } },
    blocks: {
      added: [{ handle: '40', name: 'GRID', basePoint: { x: 0, y: 0 }, xrefPath: 'grid.dxf' }],
      updated: [{ before: tb, after: { ...tb, xrefLoaded: ['40', '41', '42', '43'] } }],
    },
    entities: {
      added: [
        { entity: insertOf('41', '30', '40'), index: 0 },
        { entity: insertOf('42', '30', '40'), index: 1 },
      ],
    },
    objects: { added: [imageDef('43', '.\\logo.png')] },
  };
}

describe('referencesOf (M1-21)', () => {
  const none = { image: () => false, pdf: () => false };
  const withImages = {
    ...init,
    objects: [imageDef('50', 'C:\\site\\photo.JPG'), imageDef('51', 'off.png', false)],
  };

  it("lists the drawing's xrefs and images, none found yet", () => {
    expect(referencesOf(withImages, [], none)).toEqual([
      {
        handle: '30',
        kind: 'attach',
        name: 'TB',
        path: '.\\Sheets\\tb.dxf',
        status: 'not-found',
        depth: 0,
      },
      {
        handle: '31',
        kind: 'overlay',
        name: 'PLAN',
        path: '../plan.DXF',
        status: 'not-found',
        depth: 0,
      },
      {
        handle: '50',
        kind: 'image',
        name: 'photo',
        path: 'C:\\site\\photo.JPG',
        status: 'not-found',
        depth: 0,
      },
      { handle: '51', kind: 'image', name: 'off', path: 'off.png', status: 'unloaded', depth: 0 },
    ]);
  });

  it('nests what a loaded xref brought in under it, and follows supplied files', () => {
    const rows = referencesOf(withImages, [tbLoad()], {
      image: (f) => /photo|logo/i.test(f),
      pdf: () => false,
    });
    expect(rows.map((r) => [r.name, r.status, r.depth])).toEqual([
      ['TB', 'loaded', 0],
      ['GRID', 'not-found', 1],
      ['logo', 'loaded', 1],
      ['PLAN', 'not-found', 0],
      ['photo', 'loaded', 0],
      ['off', 'unloaded', 0],
    ]);
    expect(missingFileNames(rows)).toEqual(['grid.dxf', 'plan.DXF']);
  });
});

describe('loadXrefFiles (M1-21)', () => {
  const file = (name: string) => ({ name });

  it('loads nested xrefs from the same files, in every drawing, and returns the files used', async () => {
    // Drawing 1 waits for tb.dxf, whose load brings in grid.dxf; drawing 2 waits for grid.dxf.
    const waiting = new Map<number, PendingXref[]>([
      [1, [{ block: '30', name: 'TB', path: '.\\tb.dxf' }]],
      [2, [{ block: '60', name: 'GRID', path: 'grid.dxf' }]],
    ]);
    const loads: string[] = [];
    const files = [file('GRID.DXF'), file('notes.dxf'), file('tb.dxf')];
    const used = await loadXrefFiles(
      files,
      () => [...waiting].map(([doc, xrefs]) => ({ doc, xrefs })),
      async (doc, xrefs, f) => {
        loads.push(`${doc}:${xrefs.map((x) => x.name).join()}<-${f.name}`);
        const left = waiting.get(doc)!.filter((x) => !xrefs.includes(x));
        if (f.name === 'tb.dxf') left.push({ block: '40', name: 'GRID', path: 'grid.dxf' });
        waiting.set(doc, left);
      },
    );
    expect(loads).toEqual(['1:TB<-tb.dxf', '1:GRID<-GRID.DXF', '2:GRID<-GRID.DXF']);
    expect([...used].map((f) => f.name).sort()).toEqual(['GRID.DXF', 'tb.dxf']);
  });

  it('does not try a failed xref again', async () => {
    let tries = 0;
    const used = await loadXrefFiles(
      [file('tb.dxf')],
      () => [{ doc: 1, xrefs: [{ block: '30', name: 'TB', path: 'tb.dxf' }] }],
      async () => {
        tries++;
        throw new Error('unreadable');
      },
    );
    expect(tries).toBe(1);
    expect(used.size).toBe(1);
  });
});
