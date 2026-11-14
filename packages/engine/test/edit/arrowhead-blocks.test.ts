// M2-35 part 22: AutoCAD's arrowheads as the blocks Triya authors when a drawing lacks one. Each
// is drawn for a size of 1 with its tip at the base point and its back towards −X, as the
// dimension generator inserts it (`@triya/dims` arrowParts).
import { describe, expect, it } from 'vitest';
import {
  ARROWHEAD_BLOCKS,
  ChangeSetBuilder,
  DocumentModel,
  addArrowheadBlock,
  arrowheadBlockName,
  arrowheadLabel,
  arrowheadBlockParts,
  type EntityGeometry,
} from '../../src/index';
import { blockRecord, sampleInit } from '../model/fixtures';

/** The arrowheads drawn about the tip, whose dimension line runs on to the tip (dims). */
const AT_TIP = new Set(['_ARCHTICK', '_OBLIQUE', '_DOTSMALL', '_SMALL', '_INTEGRAL', '_NONE']);

/** The x extent of the parts, the width of a wide polyline and a circle's radius counted. */
function xExtent(parts: readonly EntityGeometry[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  const at = (x: number, r = 0) => {
    min = Math.min(min, x - r);
    max = Math.max(max, x + r);
  };
  for (const g of parts) {
    if (g.kind === 'LINE') [g.start, g.end].forEach((p) => at(p.x));
    else if (g.kind === 'LWPOLYLINE') {
      const bulged = g.vertices.some((v) => v.bulge !== 0);
      const half = (g.constantWidth ?? 0) / 2;
      // A two-vertex bulge-1 polyline is a circle through its vertices.
      if (bulged) at((g.vertices[0]!.x + g.vertices[1]!.x) / 2, g.vertices[1]!.x + half);
      else g.vertices.forEach((v) => at(v.x));
    } else if (g.kind === 'CIRCLE') at(g.center.x, g.radius);
    else if (g.kind === 'ARC') {
      for (let i = 0; i <= 64; i++) {
        const t = g.startAngle + ((g.endAngle - g.startAngle) * i) / 64;
        at(g.center.x + g.radius * Math.cos(t));
      }
    } else if (g.kind === 'SOLID') g.corners.forEach((p) => at(p.x));
  }
  return [min, max];
}

describe('AutoCAD arrowhead blocks (M2-35 part 22)', () => {
  it('names the nineteen arrowheads AutoCAD lists after closed filled', () => {
    expect(ARROWHEAD_BLOCKS).toHaveLength(19);
    expect(arrowheadBlockName('_ArchTick')).toBe('_ARCHTICK');
    expect(arrowheadBlockName(' _dot ')).toBe('_DOT');
    expect(arrowheadBlockName('DOT')).toBeUndefined();
    expect(arrowheadBlockName('DOOR')).toBeUndefined();
    expect(arrowheadLabel('_open90')).toBe('Right angle');
    expect(arrowheadLabel('DOOR')).toBeUndefined();
    expect(arrowheadBlockParts('DOOR')).toBeUndefined();
  });

  it.each(ARROWHEAD_BLOCKS.map((a) => [a.name] as const))(
    '%s runs from its tip back to its size, or stays about the tip',
    (name) => {
      const parts = arrowheadBlockParts(name)!;
      expect(parts).toBeDefined();
      if (name === '_NONE') {
        expect(parts).toEqual([]);
        return;
      }
      const [min, max] = xExtent(parts);
      expect(max).toBeLessThanOrEqual(0.5 + 1e-12);
      if (AT_TIP.has(name)) {
        // The dimension line runs to the tip: the arrowhead stays within half its size.
        expect(min).toBeGreaterThanOrEqual(-0.5 - 1e-12);
      } else {
        // The dimension line stops a size back from the tip: the arrowhead reaches it there.
        expect(min).toBeCloseTo(-1, 12);
        const reachesLine = parts.some(
          (g) =>
            (g.kind === 'LINE' && [g.start, g.end].some((p) => p.x === -1 && p.y === 0)) ||
            (g.kind === 'LWPOLYLINE' && g.vertices.some((v) => v.x === -1)) ||
            (g.kind === 'SOLID' && g.corners.some((p) => p.x === -1)),
        );
        expect(reachesLine).toBe(true);
      }
    },
  );

  it('draws the shapes AutoCAD stores in the drawings we read', () => {
    // acadsharp sample_AC1009 and ezdxf mtext_text_frame.dxf.
    expect(arrowheadBlockParts('_ARCHTICK')).toEqual([
      {
        kind: 'LWPOLYLINE',
        vertices: [
          { x: -0.5, y: -0.5, bulge: 0 },
          { x: 0.5, y: 0.5, bulge: 0 },
        ],
        closed: false,
        constantWidth: 0.15,
      },
    ]);
    const blank = arrowheadBlockParts('_CLOSEDBLANK')![0]!;
    expect(blank).toMatchObject({ kind: 'LWPOLYLINE', closed: true });
    const v = (blank as Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>).vertices;
    expect(v.map((p) => [p.x, p.y])).toEqual([
      [-1, expect.closeTo(1 / 6, 12)],
      [0, 0],
      [-1, expect.closeTo(-1 / 6, 12)],
    ]);
    const box = arrowheadBlockParts('_BOXBLANK')!;
    expect(box.map((g) => g.kind)).toEqual(['LWPOLYLINE', 'LINE']);
    expect(box[1]).toEqual({ kind: 'LINE', start: { x: -0.5, y: 0 }, end: { x: -1, y: 0 } });
    // The dot is a filled disc 1 across; the small dot half that.
    expect(arrowheadBlockParts('_DOT')![0]).toMatchObject({ constantWidth: 0.5 });
    expect(xExtent(arrowheadBlockParts('_DOTSMALL')!)).toEqual([-0.25, 0.25]);
  });

  it('adds a block the drawing lacks, on layer 0 ByBlock, and finds one it has', () => {
    const base = sampleInit();
    const model = DocumentModel.create({
      ...base,
      tables: {
        ...base.tables,
        blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('40', '_Dot')],
      },
      blocks: [...(base.blocks ?? []), { handle: '40', name: '_Dot', basePoint: { x: 0, y: 0 } }],
    });
    const b = new ChangeSetBuilder(model);
    expect(addArrowheadBlock(b, model, '_DOT')).toBe('40');
    expect(addArrowheadBlock(b, model, 'DOOR')).toBeUndefined();
    const made = addArrowheadBlock(b, model, '_integral')!;
    model.apply(b.build());
    expect(model.blocks.get(made)).toMatchObject({ name: '_INTEGRAL', basePoint: { x: 0, y: 0 } });
    const parts = model.blockEntities(made).map((id) => model.entity(id)!);
    expect(parts.map((e) => e.geom.kind)).toEqual(['ARC', 'ARC']);
    for (const e of parts) {
      expect(model.tables.layers.get(e.layer)?.name).toBe('0');
      expect(e).toMatchObject({ color: { kind: 'byBlock' }, linetype: 'ByBlock' });
    }
  });
});
