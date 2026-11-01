// SORTENTSTABLE objects to Triya (M1-13 part 2), on drawings authored in memory with acad-ts.
import { ACadVersion, CadDocument, Circle, Line, XYZ } from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { mapSortEnts } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

describe('mapSortEnts', () => {
  it('maps each block record’s table with its entries in the order stored', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const a = new Line(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
    const b = new Circle(new XYZ(0, 0, 0), 1);
    doc.entities?.add(a);
    doc.entities?.add(b);
    const ms = doc.modelSpace!;
    const table = ms.createSortEntitiesTable();
    table.add(b, 0x10);
    table.add(a, 0x11);

    const mapped = mapSortEnts(doc);
    expect(mapped).toEqual([
      expect.objectContaining({
        handle: H(table),
        type: 'SORTENTSTABLE',
        block: H(ms),
        entries: [
          { entity: H(b), sort: '10' },
          { entity: H(a), sort: '11' },
        ],
      }),
    ]);
  });

  it('gives nothing for a drawing without draw-order changes', () => {
    expect(mapSortEnts(new CadDocument(ACadVersion.AC1032))).toEqual([]);
  });
});
