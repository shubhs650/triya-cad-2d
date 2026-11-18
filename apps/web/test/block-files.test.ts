// M5-01 part 4: -INSERT `name=file` finds the drawing file among what the app holds (the drawings
// open, the files given for xrefs) by its name, folders and extension aside, any case.
import { DocumentModel, type DocumentInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { drawingFileReply, type HeldDrawing } from '../src/block-files';

const MODEL = '1F';

/** A drawing with one line in model space and $INSBASE (2,3). */
function model(): DocumentModel {
  const init: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '40',
    header: new Map([['$INSBASE', { x: 2, y: 3, z: 0 }]]),
    tables: {
      layers: [
        {
          handle: '10',
          name: '0',
          color: { kind: 'aci', index: 7 },
          linetype: '14',
          flags: 0,
        } as never,
      ],
      linetypes: [{ handle: '14', name: 'Continuous' } as never],
      blockRecords: [
        { handle: MODEL, name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: MODEL, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    entities: [
      {
        handle: '30',
        type: 'LINE',
        owner: MODEL,
        layer: '10',
        geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      } as never,
    ],
  };
  return DocumentModel.create(init);
}

describe('drawingFileReply', () => {
  it('answers the first drawing held by the name as its model space, based at its $INSBASE', async () => {
    const held: HeldDrawing[] = [
      { name: 'Other.dxf', model: () => Promise.reject(new Error('never read')) },
      { name: 'Frame.DXF', model },
    ];
    const reply = await drawingFileReply('C:\\parts\\frame.dwg', held);
    expect(reply.ok).toBe(true);
    const drawing = reply.ok ? reply.drawing : undefined;
    expect(drawing?.name).toBe('Frame.DXF');
    expect(drawing?.content.base).toEqual({ x: 2, y: 3 });
    expect(drawing?.content.entities.map((e) => e.type)).toEqual(['LINE']);
  });

  it('answers no drawing for a name none holds, and why for one that cannot be read', async () => {
    expect(await drawingFileReply('nope', [{ name: 'frame.dxf', model }])).toEqual({ ok: true });
    const broken: HeldDrawing = { name: 'bad.dxf', model: () => Promise.reject(new Error('torn')) };
    expect(await drawingFileReply('bad', [broken])).toEqual({
      ok: false,
      message: 'bad.dxf could not be read: torn',
    });
  });
});
