// M8-01: B16.5 flanges drawn as front, side and section views, and as blocks at drawing units.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  type DocumentInit,
  type EntityGeometry,
  type PolylineVertex,
} from '@triya/engine';
import {
  B16_5_CLASSES,
  FLANGE_TYPES,
  FLANGE_VIEWS,
  addFlangeBlock,
  b165Flange,
  b165Sizes,
  drawingScale,
  flangeBlockName,
  flangeParts,
  type B165Spec,
  type FlangeDimensions,
  type LibraryPart,
} from '../src/index';

const flange = (spec: Partial<B165Spec> = {}): FlangeDimensions =>
  b165Flange({ flangeClass: 150, nps: 4, type: 'WN', ...spec })!;

type Poly = Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>;
type Hatch = Extract<EntityGeometry, { kind: 'HATCH' }>;

const of = <K extends EntityGeometry['kind']>(
  parts: readonly LibraryPart[],
  kind: K,
  role?: string,
) =>
  parts
    .filter((p) => p.geom.kind === kind && (role === undefined || p.role === role))
    .map((p) => p.geom as Extract<EntityGeometry, { kind: K }>);

/** The signed area a closed bulge polyline encloses (counter-clockwise positive). */
function area(vertices: readonly PolylineVertex[]): number {
  let a = 0;
  vertices.forEach((p, i) => {
    const q = vertices[(i + 1) % vertices.length]!;
    a += (p.x * q.y - q.x * p.y) / 2;
    if (p.bulge !== 0) {
      const theta = 4 * Math.atan(p.bulge);
      const chord = Math.hypot(q.x - p.x, q.y - p.y);
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      a += Math.sign(theta) * ((r * r) / 2) * (Math.abs(theta) - Math.sin(Math.abs(theta)));
    }
  });
  return a;
}

const metal = (parts: readonly LibraryPart[]) =>
  of(parts, 'LWPOLYLINE', 'visible')
    .filter((p) => p.closed)
    .reduce((sum, p) => sum + Math.abs(area(p.vertices)), 0);

describe('B16.5 flange views (M8-01)', () => {
  it('draws the face with its bolt holes straddling the centre lines', () => {
    const d = flange();
    const parts = flangeParts(d, 'front');
    const circles = of(parts, 'CIRCLE', 'visible');
    const at = (r: number) => circles.filter((c) => Math.abs(c.radius - r) < 1e-12);
    expect(at(d.outsideDiameter / 2)).toHaveLength(1);
    expect(at(d.raisedFace!.diameter / 2)).toHaveLength(1);
    expect(at(d.bore! / 2)).toHaveLength(1);
    const holes = at(d.bolting.holeDiameter / 2);
    expect(holes).toHaveLength(8);
    for (const h of holes) {
      expect(Math.hypot(h.center.x, h.center.y)).toBeCloseTo(d.bolting.circleDiameter / 2, 12);
      // 8 holes: 22.5° off the centre lines.
      const deg = (Math.atan2(h.center.y, h.center.x) * 180) / Math.PI;
      expect(((deg % 45) + 45) % 45).toBeCloseTo(22.5, 9);
    }
    expect(of(parts, 'CIRCLE', 'center').map((c) => c.radius)).toEqual([
      d.bolting.circleDiameter / 2,
    ]);
    expect(of(parts, 'LINE', 'center')).toHaveLength(2);
    expect(of(parts, 'LINE', 'center')[0]!.end.x).toBeGreaterThan(d.outsideDiameter / 2);
  });

  it("shows a socket welding flange's socket hidden behind its bore from the face", () => {
    const d = flange({ type: 'SW', nps: 2 });
    const parts = flangeParts(d, 'front');
    expect(of(parts, 'CIRCLE', 'hidden').map((c) => c.radius)).toEqual([d.socket!.diameter / 2]);
    expect(of(parts, 'CIRCLE', 'visible').some((c) => c.radius === d.bore! / 2)).toBe(true);
    // A threaded flange shows its counterbore and thread; a blind flange no bore.
    const th = flange({ type: 'TH', nps: 2 });
    const thRadii = of(flangeParts(th, 'front'), 'CIRCLE', 'visible').map((c) => c.radius);
    expect(thRadii).toEqual(
      expect.arrayContaining([th.thread!.counterbore / 2, th.thread!.diameter / 2]),
    );
    const bl = flange({ type: 'BL' });
    expect(of(flangeParts(bl, 'front'), 'CIRCLE', 'visible')).toHaveLength(2 + 8);
  });

  it('draws the side view as the outline, with the bore and bolt holes hidden', () => {
    const d = flange();
    const parts = flangeParts(d, 'side');
    const outline = of(parts, 'LWPOLYLINE', 'visible');
    expect(outline).toHaveLength(1);
    expect(outline[0]!.closed).toBe(true);
    const xs = outline[0]!.vertices.map((v) => v.x);
    const ys = outline[0]!.vertices.map((v) => v.y);
    const h = d.raisedFace!.height;
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, h + d.hub!.length]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([
      -d.outsideDiameter / 2,
      d.outsideDiameter / 2,
    ]);
    // The outline is the profile turned about the axis: the raised face, ring and hub.
    expect(outline[0]!.vertices.slice(0, 6).map((v) => [v.x, v.y])).toEqual([
      [0, d.raisedFace!.diameter / 2],
      [h, d.raisedFace!.diameter / 2],
      [h, d.outsideDiameter / 2],
      [h + d.thickness, d.outsideDiameter / 2],
      [h + d.thickness, d.hub!.baseDiameter / 2],
      [h + d.hub!.length, d.hub!.endDiameter / 2],
    ]);
    // The ring's front behind the raised face and its back behind the hub, edge on.
    expect(of(parts, 'LINE', 'visible').map((l) => [l.start.x, l.start.y, l.end.y])).toEqual([
      [h, -d.raisedFace!.diameter / 2, d.raisedFace!.diameter / 2],
      [h + d.thickness, -d.hub!.baseDiameter / 2, d.hub!.baseDiameter / 2],
    ]);
    expect(of(parts, 'LWPOLYLINE', 'hidden').map((p) => p.vertices.map((v) => v.y))).toEqual([
      [d.bore! / 2, d.bore! / 2],
      [-d.bore! / 2, -d.bore! / 2],
    ]);
    // Eight holes project to four bands across the ring: two hidden lines each.
    const holeLines = of(parts, 'LINE', 'hidden');
    expect(holeLines).toHaveLength(8);
    for (const l of holeLines) expect([l.start.x, l.end.x]).toEqual([h, h + d.thickness]);
    expect(of(parts, 'LINE', 'center')).toHaveLength(3);
  });

  it.each(FLANGE_TYPES.map((t) => [t] as const))(
    'cuts a %s flange on its axis, hatched',
    (type) => {
      const d = flange({ type, nps: 2 });
      const parts = flangeParts(d, 'section');
      const loops = of(parts, 'LWPOLYLINE', 'visible').filter((p) => p.closed);
      // Rim beyond the holes above and below, and the metal inside them: one piece across the
      // axis on a blind flange, two (above and below the bore) on the others.
      expect(loops).toHaveLength(type === 'BL' ? 3 : 4);
      const hatch = of(parts, 'HATCH');
      expect(hatch).toHaveLength(1);
      expect(hatch[0]).toMatchObject({ pattern: '_USER', patternType: 0, solid: false });
      expect(hatch[0]!.loops.map((l) => l.polyline!.vertices)).toEqual(
        loops.map((l) => l.vertices),
      );
      // The metal cut: the profile above the axis, less the hole, twice.
      const h = d.raisedFace?.height ?? 0;
      const t = d.thickness;
      const o = d.outsideDiameter / 2;
      const b = (d.bore ?? 0) / 2;
      const face = d.raisedFace ? h * (d.raisedFace.diameter / 2 - b) : 0;
      const ring = t * (o - b) - t * d.bolting.holeDiameter;
      // The hub, tapering from X to its end over Y less the ring.
      const {
        baseDiameter: x,
        endDiameter: e,
        length: y,
      } = d.hub ?? { baseDiameter: 0, endDiameter: 0, length: t };
      let hub = (y - t) * ((x + e) / 4 - b);
      if (type === 'SW') hub += d.socket!.depth * (b - d.socket!.diameter / 2);
      if (type === 'TH') {
        const q = d.thread!.counterbore / 2;
        hub -= ((q - b) * (q - b)) / 2; // the countersink
      }
      if (type === 'LJ') hub -= (1 - Math.PI / 4) * d.lapRadius! ** 2; // the rounded corner
      expect(metal(parts)).toBeCloseTo(2 * (face + ring + hub), 9);
      expect(of(parts, 'LINE', 'center')).toHaveLength(3);
    },
  );

  it("rounds a lap joint flange's bore corner outward of the metal", () => {
    const d = flange({ type: 'LJ' });
    const r = d.lapRadius!;
    const b = d.bore! / 2;
    const upper = of(flangeParts(d, 'section'), 'LWPOLYLINE', 'visible').find(
      (p) => p.closed && p.vertices.some((v) => v.bulge !== 0 && v.y > 0),
    )!;
    const i = upper.vertices.findIndex((v) => v.bulge !== 0);
    expect(upper.vertices[i]).toMatchObject({ x: r, y: b });
    expect(upper.vertices[i + 1]).toMatchObject({ x: 0, y: b + r });
    // Its arc passes the corner's centre (r, b + r) at r, towards the corner it rounds.
    expect(upper.vertices[i]!.bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12);
    // And below the axis, mirrored, it turns the other way.
    const lower = of(flangeParts(d, 'section'), 'LWPOLYLINE', 'visible').find(
      (p) => p.closed && p.vertices.some((v) => v.bulge !== 0 && v.y < 0),
    )!;
    const j = lower.vertices.findIndex((v) => v.bulge !== 0);
    expect(lower.vertices[j]).toMatchObject({ x: 0, y: -(b + r) });
    expect(lower.vertices[j]!.bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12);
  });

  it('draws every flange B16.5 has in every view', () => {
    let count = 0;
    for (const flangeClass of B16_5_CLASSES) {
      for (const type of FLANGE_TYPES) {
        for (const nps of b165Sizes(flangeClass, type)) {
          const d = b165Flange({ flangeClass, nps, type })!;
          for (const view of FLANGE_VIEWS) {
            const parts = flangeParts(d, view);
            expect(parts.length).toBeGreaterThan(3);
            for (const p of of(parts, 'LWPOLYLINE')) {
              for (const v of p.vertices)
                expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
            }
            count++;
          }
        }
      }
    }
    expect(count).toBeGreaterThan(700);
  });

  it("scales from inches to the drawing's units", () => {
    const d = flange();
    const inch = flangeParts(d, 'section');
    const mm = flangeParts(d, 'section', 25.4);
    expect(metal(mm)).toBeCloseTo(metal(inch) * 25.4 ** 2, 6);
    const hatch = of(mm, 'HATCH')[0] as Hatch;
    expect(hatch.patternScale).toBeCloseTo((d.outsideDiameter / 40) * 25.4, 12);
    const circle = of(flangeParts(d, 'front', 25.4), 'CIRCLE')[0]!;
    expect(circle.radius).toBeCloseTo((9 / 2) * 25.4, 12);
    expect((of(mm, 'LWPOLYLINE')[0] as Poly).vertices[0]!.y).toBeCloseTo(
      (of(inch, 'LWPOLYLINE')[0] as Poly).vertices[0]!.y * 25.4,
      12,
    );
  });
});

/** A drawing with layer 0, model space, and the linetypes named. */
function drawing(
  insUnits: number,
  measurement: 'imperial' | 'metric',
  linetypes: string[] = [],
): DocumentModel {
  const layer = {
    handle: '10',
    name: '0',
    color: { kind: 'aci', index: 7 },
    linetype: '14',
    lineweight: 'Default',
    transparency: { alpha: 255 },
    plot: true,
    on: true,
    frozen: false,
    locked: false,
  } as const;
  const lt = (handle: string, name: string) => ({
    handle,
    name,
    description: name,
    alignment: 'A' as const,
    patternLength: 0,
    elements: [],
  });
  const init: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits, measurement },
    handSeed: '40',
    header: new Map(),
    tables: {
      layers: [layer],
      linetypes: [lt('14', 'Continuous'), ...linetypes.map((n, i) => lt(String(30 + i), n))],
      blockRecords: [
        { handle: '1F', name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    objects: [],
    passthrough: [],
    entities: [],
  };
  return DocumentModel.create(init);
}

describe('B16.5 flange blocks (M8-01)', () => {
  it('names a block by standard, type, class, size, schedule and view', () => {
    const spec = { flangeClass: 150, nps: 4, type: 'WN' } as const;
    expect(flangeBlockName(spec, 'front')).toBe('ASME_B16.5_WN_CL150_NPS4_FRONT');
    expect(flangeBlockName({ ...spec, schedule: '80' }, 'section')).toBe(
      'ASME_B16.5_WN_CL150_NPS4_SCH80_SECTION',
    );
    expect(flangeBlockName({ ...spec, nps: 1.5, type: 'SO', schedule: '80' }, 'side')).toBe(
      'ASME_B16.5_SO_CL150_NPS1.5_SIDE',
    );
  });

  it('scales by INSUNITS, or by $MEASUREMENT in a unitless drawing', () => {
    expect(drawingScale(drawing(4, 'imperial'))).toBeCloseTo(25.4, 12);
    expect(drawingScale(drawing(1, 'metric'))).toBe(1);
    expect(drawingScale(drawing(5, 'imperial'))).toBeCloseTo(2.54, 12);
    expect(drawingScale(drawing(0, 'metric'))).toBe(25.4);
    expect(drawingScale(drawing(0, 'imperial'))).toBe(1);
  });

  it("adds a block at the drawing's units on layer 0 ByBlock, and finds one it has", () => {
    const model = drawing(4, 'metric', ['HIDDEN', 'CENTER']);
    const spec = { flangeClass: 300, nps: 6, type: 'WN' } as const;
    const b = new ChangeSetBuilder(model);
    const made = addFlangeBlock(b, model, spec, 'side')!;
    expect(
      addFlangeBlock(b, model, { ...spec, type: 'SO', flangeClass: 2500 }, 'side'),
    ).toBeUndefined();
    model.apply(b.build());
    expect(model.blocks.get(made)).toMatchObject({
      name: 'ASME_B16.5_WN_CL300_NPS6_SIDE',
      basePoint: { x: 0, y: 0 },
      description: 'ASME B16.5 Class 300 NPS 6 weld neck flange, side view (standard wall bore)',
    });
    expect(model.tables.blockRecords.get(made)).toMatchObject({ units: 4 });
    const parts = model.blockEntities(made).map((id) => model.entity(id)!);
    const d = b165Flange(spec)!;
    expect(parts).toHaveLength(flangeParts(d, 'side').length);
    for (const e of parts) {
      expect(model.tables.layers.get(e.layer)?.name).toBe('0');
      expect(e).toMatchObject({ color: { kind: 'byBlock' }, lineweight: 'ByBlock' });
    }
    const named = (lt: unknown) =>
      typeof lt === 'string' && lt.startsWith('By')
        ? lt
        : model.tables.linetypes.get(lt as string)?.name;
    expect(new Set(parts.map((e) => named(e.linetype)))).toEqual(
      new Set(['ByBlock', 'HIDDEN', 'CENTER']),
    );
    const outline = parts.find((e) => e.geom.kind === 'LWPOLYLINE' && e.geom.closed)!.geom as Poly;
    expect(Math.max(...outline.vertices.map((v) => v.y))).toBeCloseTo((12.5 / 2) * 25.4, 9);
    // Asked again, the drawing has it.
    const again = new ChangeSetBuilder(model);
    expect(addFlangeBlock(again, model, spec, 'side')).toBe(made);
  });

  it('draws hidden edges and centre lines ByBlock in a drawing without those linetypes', () => {
    const model = drawing(1, 'imperial');
    const b = new ChangeSetBuilder(model);
    const made = addFlangeBlock(b, model, { flangeClass: 150, nps: 2, type: 'BL' }, 'front')!;
    model.apply(b.build());
    const parts = model.blockEntities(made).map((id) => model.entity(id)!);
    expect(new Set(parts.map((e) => e.linetype))).toEqual(new Set(['ByBlock']));
  });
});
