// TriyaToAcad for an associative HATCH's boundary objects and the reactors that point back at
// it (M1-75 part 17). AutoCAD keeps the pair linked both ways: each loop lists its boundary
// objects (DXF 97 count, 330 handles; DWG soft pointers) and each boundary object lists the
// hatch in its reactors (102 {ACAD_REACTORS 330}), as every associative hatch of the corpus
// shows. Drawings are authored in memory with acad-ts and saved once, so "the file" is real
// bytes; the corpus-wide edit is in packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  Circle,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathArc,
  HatchBoundaryPathPolyline,
  HatchPattern,
  Line,
  LwPolyline,
  LwPolylineVertex,
  MText,
  Point,
  XY,
  XYZ,
  type Entity as AcadEntity,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type HatchGeometry,
  type HatchLoop,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

function vertex(x: number, y: number): LwPolylineVertex {
  const v = new LwPolylineVertex();
  v.location = new XY(x, y);
  return v;
}

function square(size: number): LwPolyline {
  const p = new LwPolyline();
  p.vertices = [vertex(0, 0), vertex(size, 0), vertex(size, size), vertex(0, size)];
  p.isClosed = true;
  return p;
}

function polylineLoop(p: LwPolyline, flags: number): HatchBoundaryPath {
  const loop = new HatchBoundaryPath();
  const edge = new HatchBoundaryPathPolyline();
  edge.isClosed = true;
  edge.vertices = p.vertices.map((v) => new XYZ(v.location.x, v.location.y, v.bulge));
  loop.edges = [edge];
  loop.flags = flags as never;
  return loop;
}

function circleLoop(c: Circle, flags: number): HatchBoundaryPath {
  const loop = new HatchBoundaryPath();
  const arc = new HatchBoundaryPathArc();
  arc.center = new XY(c.center.x, c.center.y);
  arc.radius = c.radius;
  arc.startAngle = 0;
  arc.endAngle = 2 * Math.PI;
  arc.counterClockWise = true;
  loop.edges = [arc];
  loop.flags = flags as never;
  return loop;
}

function circle(x: number, y: number, r: number): Circle {
  const c = new Circle();
  c.center = new XYZ(x, y, 0);
  c.radius = r;
  return c;
}

/**
 * One drawing with: an associative ANSI31 HATCH bounded by an LWPOLYLINE (outer loop) and a
 * CIRCLE (inner loop), each listing the hatch in its reactors; a non-associative SOLID hatch over
 * a second square; a spare CIRCLE, an MTEXT and a POINT; and a LINE in block B.
 */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const outer = square(10);
  const inner = circle(5, 5, 2);
  const assoc = new Hatch();
  assoc.isAssociative = true;
  assoc.patternType = 1 as never;
  assoc.pattern = new HatchPattern('ANSI31');
  const outerLoop = polylineLoop(outer, 1 | 2 | 4);
  const innerLoop = circleLoop(inner, 16 | 4);
  assoc.paths = [outerLoop, innerLoop];
  assoc.seedPoints = [new XY(1, 1)];

  const other = square(20);
  const solid = new Hatch();
  solid.isSolid = true;
  solid.patternType = 1 as never;
  solid.paths = [polylineLoop(other, 1 | 2)];
  solid.seedPoints = [new XY(15, 15)];

  const spare = circle(5, 5, 1);
  const text = new MText();
  text.value = 'NOTE';
  text.insertPoint = new XYZ(12, 12, 0);
  text.height = 1;
  const point = new Point();
  point.location = new XYZ(3, 3, 0);
  for (const e of [outer, inner, assoc, other, solid, spare, text, point]) {
    doc.entities!.add(e as AcadEntity);
  }
  const block = new BlockRecord('B');
  doc.blockRecords!.add(block);
  const ln = new Line();
  ln.endPoint = new XYZ(1, 1, 0);
  block.entities.add(ln);
  // References resolve through the document's collections, so they are set once it has them.
  outerLoop.entities = [outer];
  innerLoop.entities = [inner];
  outer.addReactor(assoc);
  inner.addReactor(assoc);
  return writeCadDocument(doc, { format: 'dxf' });
}

const FILE = drawing();

function open(): DocumentModel {
  return DocumentModel.create(documentInit(readCadDocument(FILE)));
}

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const save = (model: DocumentModel, format: CadFormat = 'dxf'): Uint8Array =>
  exportDocument(readCadDocument(FILE), model, { format });

/** The reopened entities, by handle, as Triya maps them. */
function reopened(bytes: Uint8Array): Map<string, EntityInit> {
  return new Map(documentInit(readCadDocument(bytes)).entities?.map((e) => [e.handle, e]));
}

/** The entities of this kind, in drawing order; the n-th one by default the first. */
const find = (model: DocumentModel, type: string, n = 0): Entity =>
  [...model.entities()].filter((e) => e.type === type)[n]!;

const hatch = (e: Entity | EntityInit | undefined): HatchGeometry => e!.geom as HatchGeometry;

/** `e`'s geometry with each loop's sources replaced (undefined: none), and maybe associativity. */
function withSources(
  e: Entity,
  sources: readonly (readonly string[] | undefined)[],
  associative = hatch(e).associative,
): EntityGeometry {
  const g = hatch(e);
  const loops = g.loops.map((l, i): HatchLoop => {
    const { sources: _old, ...rest } = l;
    const s = sources[i];
    return s && s.length > 0 ? { ...rest, sources: s } : rest;
  });
  return { ...g, loops, associative };
}

const FORMATS = ['dxf', 'dwg'] as const;

describe('triyaToAcad associative hatch boundaries', () => {
  it('reads the authored drawing as expected', () => {
    const model = open();
    const h = find(model, 'HATCH');
    const outer = find(model, 'LWPOLYLINE');
    const inner = find(model, 'CIRCLE');
    expect(hatch(h).associative).toBe(true);
    expect(hatch(h).loops.map((l) => l.sources)).toEqual([[outer.handle], [inner.handle]]);
    expect(outer.reactors).toEqual([h.handle]);
    expect(inner.reactors).toEqual([h.handle]);
    expect(hatch(find(model, 'HATCH', 1)).associative).toBe(false);
  });

  it('removes associativity: the loops let go of their objects, which drop the hatch', () => {
    for (const format of FORMATS) {
      const model = open();
      const h = find(model, 'HATCH');
      const outer = find(model, 'LWPOLYLINE');
      const inner = find(model, 'CIRCLE');
      edit(model, (b) => {
        b.updateEntity(h.id, { geom: withSources(h, [], false) });
        b.updateEntity(outer.id, { reactors: [] });
        b.updateEntity(inner.id, { reactors: [] });
      });
      const back = reopened(save(model, format));

      expect(hatch(back.get(h.handle)).associative, format).toBe(false);
      expect(
        hatch(back.get(h.handle)).loops.map((l) => l.sources),
        format,
      ).toEqual([undefined, undefined]);
      expect(back.get(outer.handle)?.reactors, format).toBeUndefined();
      expect(back.get(inner.handle)?.reactors, format).toBeUndefined();
    }
  });

  it('makes a hatch associative to objects of the drawing', () => {
    for (const format of FORMATS) {
      const model = open();
      const h = find(model, 'HATCH', 1);
      const other = find(model, 'LWPOLYLINE', 1);
      edit(model, (b) => {
        b.updateEntity(h.id, { geom: withSources(h, [[other.handle]], true) });
        b.updateEntity(other.id, { reactors: [h.handle] });
      });
      const back = reopened(save(model, format));

      expect(hatch(back.get(h.handle)).associative, format).toBe(true);
      expect(hatch(back.get(h.handle)).loops[0]!.sources, format).toEqual([other.handle]);
      expect(back.get(other.handle)?.reactors, format).toEqual([h.handle]);
    }
  });

  it('moves a loop to another boundary object, with the reactors', () => {
    for (const format of FORMATS) {
      const model = open();
      const h = find(model, 'HATCH');
      const outer = find(model, 'LWPOLYLINE');
      const inner = find(model, 'CIRCLE');
      const spare = find(model, 'CIRCLE', 1);
      edit(model, (b) => {
        const g = withSources(h, [[outer.handle], [spare.handle]]) as HatchGeometry;
        const loops = g.loops.map((l, i) =>
          i === 1 && l.edges?.[0]?.type === 'arc'
            ? { ...l, edges: [{ ...l.edges[0], radius: 1 }] }
            : l,
        );
        b.updateEntity(h.id, { geom: { ...g, loops } as EntityGeometry });
        b.updateEntity(inner.id, { reactors: [] });
        b.updateEntity(spare.id, { reactors: [h.handle] });
      });
      const back = reopened(save(model, format));

      expect(
        hatch(back.get(h.handle)).loops.map((l) => l.sources),
        format,
      ).toEqual([[outer.handle], [spare.handle]]);
      expect(back.get(inner.handle)?.reactors, format).toBeUndefined();
      expect(back.get(spare.handle)?.reactors, format).toEqual([h.handle]);
      expect(back.get(outer.handle)?.reactors, format).toEqual([h.handle]);
    }
  });

  it('adds a hatch with the boundary the same save adds, each pointing at the other', () => {
    for (const format of FORMATS) {
      const model = open();
      const like = find(model, 'HATCH');
      const outer = find(model, 'LWPOLYLINE');
      let boundary!: Entity;
      let added!: Entity;
      edit(model, (b) => {
        // HATCH with "Pick points" makes the boundary first (as BOUNDARY does), then the hatch.
        boundary = b.addEntity({ owner: outer.owner, layer: outer.layer, geom: outer.geom });
        added = b.addEntity({
          owner: like.owner,
          layer: like.layer,
          geom: {
            ...hatch(like),
            loops: [{ ...hatch(like).loops[0]!, sources: [boundary.handle] }],
          },
        });
        b.updateEntity(boundary.id, { reactors: [added.handle] });
      });
      const back = reopened(save(model, format));

      expect(hatch(back.get(added.handle)).loops[0]!.sources, format).toEqual([boundary.handle]);
      expect(back.get(boundary.handle)?.reactors, format).toEqual([added.handle]);
      // The old pair is as it was.
      expect(back.get(outer.handle)?.reactors, format).toEqual([like.handle]);
    }
  });

  it('keeps a text box loop on its MTEXT', () => {
    const model = open();
    const h = find(model, 'HATCH', 1);
    const other = find(model, 'LWPOLYLINE', 1);
    const text = find(model, 'MTEXT');
    edit(model, (b) => {
      const g = withSources(h, [[other.handle]], true) as HatchGeometry;
      const box: HatchLoop = {
        flags: 2 | 8 | 16,
        polyline: {
          closed: true,
          vertices: [
            [12, 12],
            [14, 12],
            [14, 13],
            [12, 13],
          ].map(([x, y]) => ({ x: x!, y: y!, bulge: 0 })),
        },
        sources: [text.handle],
      };
      b.updateEntity(h.id, { geom: { ...g, loops: [...g.loops, box] } });
      b.updateEntity(other.id, { reactors: [h.handle] });
      b.updateEntity(text.id, { reactors: [h.handle] });
    });
    const back = reopened(save(model));

    expect(hatch(back.get(h.handle)).loops.map((l) => l.sources)).toEqual([
      [other.handle],
      [text.handle],
    ]);
    expect(back.get(text.handle)?.reactors).toEqual([h.handle]);
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const cases: [RegExp, (b: ChangeSetBuilder, m: DocumentModel) => void][] = [
      [
        /boundary objects on a hatch that is not associative/,
        (b, m) => {
          const h = find(m, 'HATCH', 1);
          const other = find(m, 'LWPOLYLINE', 1);
          b.updateEntity(h.id, { geom: withSources(h, [[other.handle]], false) });
          b.updateEntity(other.id, { reactors: [h.handle] });
        },
      ],
      [
        /associative without boundary objects/,
        (b, m) => {
          const h = find(m, 'HATCH', 1);
          b.updateEntity(h.id, { geom: withSources(h, [], true) });
        },
      ],
      [
        /boundary object 7FFF is not an entity of the drawing/,
        (b, m) => {
          const h = find(m, 'HATCH');
          b.updateEntity(h.id, {
            geom: withSources(h, [[find(m, 'LWPOLYLINE').handle], ['7FFF']]),
          });
          b.updateEntity(find(m, 'CIRCLE').id, { reactors: [] });
        },
      ],
      [
        /boundary object .* is in another block/,
        (b, m) => {
          const h = find(m, 'HATCH', 1);
          const ln = find(m, 'LINE');
          b.updateEntity(h.id, { geom: withSources(h, [[ln.handle]], true) });
          b.updateEntity(ln.id, { reactors: [h.handle] });
        },
      ],
      [
        /boundary object .* is a POINT/,
        (b, m) => {
          const h = find(m, 'HATCH', 1);
          const p = find(m, 'POINT');
          b.updateEntity(h.id, { geom: withSources(h, [[p.handle]], true) });
          b.updateEntity(p.id, { reactors: [h.handle] });
        },
      ],
      [
        /loop 0: boundary object .* is text, in a loop that is not a text box/,
        (b, m) => {
          const h = find(m, 'HATCH', 1);
          const t = find(m, 'MTEXT');
          b.updateEntity(h.id, { geom: withSources(h, [[t.handle]], true) });
          b.updateEntity(t.id, { reactors: [h.handle] });
        },
      ],
      [
        /boundary object .* twice/,
        (b, m) => {
          const h = find(m, 'HATCH');
          const outer = find(m, 'LWPOLYLINE').handle;
          b.updateEntity(h.id, { geom: withSources(h, [[outer], [outer]]) });
          b.updateEntity(find(m, 'CIRCLE').id, { reactors: [] });
        },
      ],
      [
        /boundary object .* does not point back at it \(reactors\)/,
        (b, m) => {
          const h = find(m, 'HATCH', 1);
          const other = find(m, 'LWPOLYLINE', 1);
          b.updateEntity(h.id, { geom: withSources(h, [[other.handle]], true) });
        },
      ],
      [
        /old boundary object .* still points at it \(reactors\)/,
        (b, m) => {
          const h = find(m, 'HATCH');
          b.updateEntity(h.id, { geom: withSources(h, [], false) });
          b.updateEntity(find(m, 'LWPOLYLINE').id, { reactors: [] });
        },
      ],
      [
        /reactor .* is not a leader it annotates, a hatch it bounds, a viewport it clips or a group it is in/,
        (b, m) => {
          b.updateEntity(find(m, 'CIRCLE', 1).id, { reactors: [find(m, 'HATCH').handle] });
        },
      ],
      [
        /reactor .* goes, but that hatch still names it/,
        (b, m) => {
          b.updateEntity(find(m, 'CIRCLE').id, { reactors: [] });
        },
      ],
    ];
    for (const [message, f] of cases) {
      const model = open();
      const init = documentInit(readCadDocument(FILE));
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(FILE);

      expect(() => triyaToAcad(doc, model), String(message)).toThrow(UnsupportedChangeError);
      expect(() => triyaToAcad(readCadDocument(FILE), model), String(message)).toThrow(message);
      expect(documentInit(doc)).toEqual(init);
    }
  });
});
