// TriyaToAcad for a VIEWPORT's clip boundary and the reactor that points back at it (M1-75
// part 18). AutoCAD keeps a non-rectangular viewport linked both ways: the viewport names the
// entity that clips it (DXF 340, DWG hard pointer) and sets "non-rectangular clipping" (DXF 90
// bit 65536), and the entity lists the viewport in its reactors (102 {ACAD_REACTORS 330}), as
// every clipped viewport of the corpus (text_in_viewports.dxf) shows. Drawings are authored in
// memory with acad-ts and saved once, so "the file" is real bytes; the corpus-wide edit is in
// packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Circle,
  Ellipse,
  Layout,
  Line,
  LwPolyline,
  LwPolylineVertex,
  Viewport,
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
  type ViewportGeometry,
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

/** DXF 90 bit 65536: the viewport is clipped by its 340 entity (DXF reference, VIEWPORT). */
const NON_RECTANGULAR = 0x10000;
const STATUS = 0x8060;

function vertex(x: number, y: number): LwPolylineVertex {
  const v = new LwPolylineVertex();
  v.location = new XY(x, y);
  return v;
}

function polyline(points: readonly [number, number][], closed: boolean): LwPolyline {
  const p = new LwPolyline();
  p.vertices = points.map(([x, y]) => vertex(x, y));
  p.isClosed = closed;
  return p;
}

function viewport(id: number, x: number, y: number, status: number): Viewport {
  const v = new Viewport();
  v.id = id;
  v.center = new XYZ(x, y, 0);
  v.width = 80;
  v.height = 60;
  v.viewCenter = new XY(20, 15);
  v.viewHeight = 30;
  v.lensLength = 50;
  v.status = status as never;
  return v;
}

/**
 * One drawing whose Layout1 has: the paper viewport; viewport 2 clipped by a closed LWPOLYLINE
 * (which lists it in its reactors); viewport 3, rectangular; and, in paper space, a spare CIRCLE,
 * a full and a partial ELLIPSE, an open LWPOLYLINE and a LINE. Model space has a CIRCLE.
 */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  const paper = viewport(1, 148.5, 105, STATUS);
  paper.width = 297;
  paper.height = 210;
  paper.viewCenter = new XY(148.5, 105);
  paper.viewHeight = 210;
  const clipped = viewport(2, 60, 60, STATUS | NON_RECTANGULAR);
  const plain = viewport(3, 200, 60, STATUS);
  const clip = polyline(
    [
      [20, 30],
      [100, 30],
      [60, 90],
    ],
    true,
  );
  const spare = new Circle();
  spare.center = new XYZ(200, 60, 0);
  spare.radius = 25;
  const full = new Ellipse();
  full.center = new XYZ(200, 60, 0);
  full.majorAxisEndPoint = new XYZ(30, 0, 0);
  full.radiusRatio = 0.5;
  const partial = new Ellipse();
  partial.center = new XYZ(200, 60, 0);
  partial.majorAxisEndPoint = new XYZ(30, 0, 0);
  partial.radiusRatio = 0.5;
  partial.endParameter = Math.PI;
  const open = polyline(
    [
      [170, 40],
      [230, 40],
      [230, 80],
    ],
    false,
  );
  const line = new Line();
  line.startPoint = new XYZ(170, 40, 0);
  line.endPoint = new XYZ(230, 80, 0);
  const model = new Circle();
  model.radius = 5;

  // A new acad-ts document has no LAYOUT objects; AutoCAD links each space block to one.
  const layouts = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadLayout)!;
  for (const [name, space] of [
    ['Model', doc.modelSpace!],
    ['Layout1', doc.paperSpace!],
  ] as const) {
    const layout = new Layout(name);
    layouts.add(layout);
    layout.associatedBlock = space;
  }
  doc.entities!.add(model);
  for (const e of [paper, clipped, plain, clip, spare, full, partial, open, line]) {
    doc.paperSpace!.entities.add(e as AcadEntity);
  }
  // References resolve through the document's collections, so they are set once it has them.
  clipped.boundary = clip;
  clip.addReactor(clipped);
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

const view = (e: Entity | EntityInit | undefined): ViewportGeometry => e!.geom as ViewportGeometry;

/** VPCLIP: `e` clipped by `clip` (undefined: Delete, back to rectangular). */
function clipped(e: Entity, clip: string | undefined, flag = clip !== undefined): EntityGeometry {
  const { clipBoundary: _old, ...g } = view(e);
  const flags = flag ? g.flags | NON_RECTANGULAR : g.flags & ~NON_RECTANGULAR;
  return clip === undefined ? { ...g, flags } : { ...g, flags, clipBoundary: clip };
}

const FORMATS = ['dxf', 'dwg'] as const;

describe('triyaToAcad viewport clip boundaries', () => {
  it('reads the authored drawing as expected', () => {
    const model = open();
    const vp = find(model, 'VIEWPORT', 1);
    const clip = find(model, 'LWPOLYLINE');
    expect(view(vp).clipBoundary).toBe(clip.handle);
    expect(view(vp).flags & NON_RECTANGULAR).toBe(NON_RECTANGULAR);
    expect(clip.reactors).toEqual([vp.handle]);
    expect(view(find(model, 'VIEWPORT', 2)).clipBoundary).toBeUndefined();
  });

  it('clips a viewport by an object of its layout, which lists the viewport (VPCLIP)', () => {
    for (const format of FORMATS) {
      const model = open();
      const vp = find(model, 'VIEWPORT', 2);
      const circle = find(model, 'CIRCLE', 1);
      edit(model, (b) => {
        b.updateEntity(vp.id, { geom: clipped(vp, circle.handle) });
        b.updateEntity(circle.id, { reactors: [vp.handle] });
      });
      const back = reopened(save(model, format));

      expect(view(back.get(vp.handle)).clipBoundary, format).toBe(circle.handle);
      expect(view(back.get(vp.handle)).flags, format).toBe(STATUS | NON_RECTANGULAR);
      expect(back.get(circle.handle)?.reactors, format).toEqual([vp.handle]);
    }
  });

  it('deletes a clip: the viewport is rectangular again and its object lets go of it', () => {
    for (const format of FORMATS) {
      const model = open();
      const vp = find(model, 'VIEWPORT', 1);
      const clip = find(model, 'LWPOLYLINE');
      edit(model, (b) => {
        b.updateEntity(vp.id, { geom: clipped(vp, undefined) });
        b.updateEntity(clip.id, { reactors: [] });
      });
      const back = reopened(save(model, format));

      expect(view(back.get(vp.handle)).clipBoundary, format).toBeUndefined();
      expect(view(back.get(vp.handle)).flags, format).toBe(STATUS);
      expect(back.get(clip.handle)?.reactors, format).toBeUndefined();
    }
  });

  it('deletes a clip together with its object', () => {
    for (const format of FORMATS) {
      const model = open();
      const vp = find(model, 'VIEWPORT', 1);
      const clip = find(model, 'LWPOLYLINE');
      edit(model, (b) => {
        b.updateEntity(vp.id, { geom: clipped(vp, undefined) });
        b.removeEntity(clip.id);
      });
      const back = reopened(save(model, format));

      expect(view(back.get(vp.handle)).clipBoundary, format).toBeUndefined();
      expect(back.has(clip.handle), format).toBe(false);
    }
  });

  it('moves a clip to another object, with the reactors', () => {
    for (const format of FORMATS) {
      const model = open();
      const vp = find(model, 'VIEWPORT', 1);
      const clip = find(model, 'LWPOLYLINE');
      const ellipse = find(model, 'ELLIPSE');
      edit(model, (b) => {
        b.updateEntity(vp.id, { geom: clipped(vp, ellipse.handle) });
        b.updateEntity(clip.id, { reactors: [] });
        b.updateEntity(ellipse.id, { reactors: [vp.handle] });
      });
      const back = reopened(save(model, format));

      expect(view(back.get(vp.handle)).clipBoundary, format).toBe(ellipse.handle);
      expect(back.get(clip.handle)?.reactors, format).toBeUndefined();
      expect(back.get(ellipse.handle)?.reactors, format).toEqual([vp.handle]);
    }
  });

  it('clips by a polygon the same save adds (VPCLIP Polygonal)', () => {
    for (const format of FORMATS) {
      const model = open();
      const vp = find(model, 'VIEWPORT', 2);
      const like = find(model, 'LWPOLYLINE');
      let polygon!: Entity;
      edit(model, (b) => {
        polygon = b.addEntity({ owner: like.owner, layer: like.layer, geom: like.geom });
        b.updateEntity(vp.id, { geom: clipped(vp, polygon.handle) });
        b.updateEntity(polygon.id, { reactors: [vp.handle] });
      });
      const back = reopened(save(model, format));

      expect(view(back.get(vp.handle)).clipBoundary, format).toBe(polygon.handle);
      expect(back.get(polygon.handle)?.reactors, format).toEqual([vp.handle]);
      // The old pair is as it was.
      expect(back.get(like.handle)?.reactors, format).toEqual([find(model, 'VIEWPORT', 1).handle]);
    }
  });

  it('adds a viewport clipped by an object of the same save (MVIEW Object)', () => {
    for (const format of FORMATS) {
      const model = open();
      const like = find(model, 'VIEWPORT', 2);
      const circle = find(model, 'CIRCLE', 1);
      let added!: Entity;
      edit(model, (b) => {
        added = b.addEntity({
          owner: like.owner,
          layer: like.layer,
          geom: { ...clipped(like, circle.handle), id: 4 } as EntityGeometry,
        });
        b.updateEntity(circle.id, { reactors: [added.handle] });
      });
      const back = reopened(save(model, format));

      expect(view(back.get(added.handle)).clipBoundary, format).toBe(circle.handle);
      expect(back.get(circle.handle)?.reactors, format).toEqual([added.handle]);
    }
  });

  it('refuses what it cannot write and leaves the original as it was', () => {
    const vpClip = (
      n: number,
      type: string,
      m: number,
      b: ChangeSetBuilder,
      model: DocumentModel,
      reactors = true,
    ): void => {
      const vp = find(model, 'VIEWPORT', n);
      const e = find(model, type, m);
      b.updateEntity(vp.id, { geom: clipped(vp, e.handle) });
      if (reactors) b.updateEntity(e.id, { reactors: [...(e.reactors ?? []), vp.handle] });
    };
    const cases: [RegExp, (b: ChangeSetBuilder, m: DocumentModel) => void][] = [
      [
        /clip boundary 7FFF is not an entity of the drawing/,
        (b, m) => {
          const vp = find(m, 'VIEWPORT', 2);
          b.updateEntity(vp.id, { geom: clipped(vp, '7FFF') });
        },
      ],
      [/clip boundary .* is in another block/, (b, m) => vpClip(2, 'CIRCLE', 0, b, m)],
      [/clip boundary .* is a LINE, not/, (b, m) => vpClip(2, 'LINE', 0, b, m)],
      [/clip boundary .* is not closed/, (b, m) => vpClip(2, 'LWPOLYLINE', 1, b, m)],
      [/clip boundary .* is not closed/, (b, m) => vpClip(2, 'ELLIPSE', 1, b, m)],
      [
        /clip boundary .* does not point back at it \(reactors\)/,
        (b, m) => vpClip(2, 'CIRCLE', 1, b, m, false),
      ],
      [/clip boundary .* clips viewport .* too/, (b, m) => vpClip(2, 'LWPOLYLINE', 0, b, m)],
      [
        /a clip boundary without non-rectangular clipping \(DXF 90 bit 65536\)/,
        (b, m) => {
          const vp = find(m, 'VIEWPORT', 2);
          const c = find(m, 'CIRCLE', 1);
          b.updateEntity(vp.id, { geom: clipped(vp, c.handle, false) });
          b.updateEntity(c.id, { reactors: [vp.handle] });
        },
      ],
      [
        /non-rectangular clipping \(DXF 90 bit 65536\) without a clip boundary/,
        (b, m) => {
          const vp = find(m, 'VIEWPORT', 1);
          b.updateEntity(vp.id, { geom: clipped(vp, undefined, true) });
          b.updateEntity(find(m, 'LWPOLYLINE').id, { reactors: [] });
        },
      ],
      [
        /old clip boundary .* still points at it \(reactors\)/,
        (b, m) => {
          const vp = find(m, 'VIEWPORT', 1);
          b.updateEntity(vp.id, { geom: clipped(vp, undefined) });
        },
      ],
      [
        /reactor .* is not a leader it annotates, a hatch it bounds, a viewport it clips, a group it is in or a dimension association naming it/,
        (b, m) => {
          b.updateEntity(find(m, 'CIRCLE', 1).id, { reactors: [find(m, 'VIEWPORT', 2).handle] });
        },
      ],
      [
        /reactor .* goes, but that viewport is still clipped by it/,
        (b, m) => {
          b.updateEntity(find(m, 'LWPOLYLINE').id, { reactors: [] });
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
