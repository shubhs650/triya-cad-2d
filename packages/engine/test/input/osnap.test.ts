// M2-04 running object snaps: one test per mode, then the ranking AutoSnap uses among them.
// AutoCAD 2024 Help, "Object Snaps" and "OSNAP (Command)" are the spec; where it leaves the
// choice open the test says which drafter expectation it encodes.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  toleranceForSize,
  type EntityGeometry,
  type EntityInit,
  type Vec2,
} from '../../src/index';
import { SpatialIndex } from '../../src/spatial/index';
import {
  OSMODE_DEFAULT,
  OSNAP,
  OSNAP_MODES,
  osnap,
  osnapModeNames,
  type OsnapQuery,
} from '../../src/input/osnap';
import {
  blockRecord,
  entityInit,
  LAYER_0,
  LAYER_WALLS,
  layer,
  linetype,
  MODEL_SPACE,
  PAPER_SPACE,
  lineGeom,
  circleGeom,
} from '../model/fixtures';

const BLOCK = '30';
const tol = toleranceForSize(1000);

function source(entities: EntityInit[], o: { walls?: { on?: boolean; frozen?: boolean } } = {}) {
  const model = DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '1000',
    tables: {
      layers: [layer(LAYER_0, '0'), { ...layer(LAYER_WALLS, 'WALLS'), ...o.walls }],
      linetypes: [linetype('14', 'Continuous')],
      blockRecords: [
        blockRecord(MODEL_SPACE, '*Model_Space'),
        blockRecord(PAPER_SPACE, '*Paper_Space'),
        blockRecord(BLOCK, 'BOLT'),
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PAPER_SPACE, name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
      { handle: BLOCK, name: 'BOLT', basePoint: { x: 1, y: 0 } },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      { handle: '23', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE },
    ],
    entities,
  });
  return { model, index: SpatialIndex.build(model, { tol }), block: MODEL_SPACE, tol };
}

let next = 0x100;
const e = (geom: EntityGeometry, extra: Partial<EntityInit> = {}) =>
  entityInit((next++).toString(16).toUpperCase(), geom, extra);

const at = (x: number, y: number): Vec2 => ({ x, y });

function snap(
  entities: EntityInit[],
  point: Vec2,
  modes: number,
  extra: Partial<OsnapQuery> = {},
  o: Parameters<typeof source>[1] = {},
) {
  return osnap(source(entities, o), { point, aperture: 5, modes, ...extra });
}

function best(...args: Parameters<typeof snap>) {
  const [hit] = snap(...args);
  return hit && { mode: hit.mode, x: +hit.point.x.toFixed(6), y: +hit.point.y.toFixed(6) };
}

const LINE = lineGeom(0, 0, 100, 0);

describe('OSMODE', () => {
  it('has AutoCAD bit values and default (END, CEN, INT, EXT)', () => {
    expect(OSNAP).toMatchObject({
      END: 1,
      MID: 2,
      CEN: 4,
      NOD: 8,
      QUA: 16,
      INT: 32,
      INS: 64,
      PER: 128,
      TAN: 256,
      NEA: 512,
      GCE: 1024,
      APP: 2048,
      EXT: 4096,
      PAR: 8192,
    });
    expect(OSMODE_DEFAULT).toBe(OSNAP.END | OSNAP.CEN | OSNAP.INT | OSNAP.EXT);
    expect(osnapModeNames(OSMODE_DEFAULT)).toEqual(['END', 'CEN', 'INT', 'EXT']);
    expect(OSNAP_MODES.map((m) => m.label)).toContain('Geometric Center');
  });
});

describe('modes', () => {
  it('END: the nearer endpoint of a line, arc and polyline vertex', () => {
    expect(best([e(LINE)], at(97, 1), OSNAP.END)).toEqual({ mode: 'END', x: 100, y: 0 });
    // Anywhere on the object: the endpoint nearer the cursor (AutoCAD's ENDpoint).
    expect(best([e(LINE)], at(30, 1), OSNAP.END)).toEqual({ mode: 'END', x: 0, y: 0 });
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: at(0, 0),
      radius: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    expect(best([e(arc)], at(1, 10.5), OSNAP.END)).toEqual({ mode: 'END', x: 0, y: 10 });
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 50, y: 0, bulge: 0 },
        { x: 50, y: 50, bulge: 0 },
      ],
    };
    expect(best([e(pl)], at(49, 2), OSNAP.END)).toEqual({ mode: 'END', x: 50, y: 0 });
  });

  it('END: a circle has none; a SOLID has its corners', () => {
    expect(snap([e(circleGeom(0, 0, 10))], at(10, 0), OSNAP.END)).toEqual([]);
    const solid: EntityGeometry = {
      kind: 'SOLID',
      corners: [at(0, 0), at(10, 0), at(0, 10), at(10, 10)],
    };
    expect(best([e(solid)], at(9, 9.5), OSNAP.END)).toEqual({ mode: 'END', x: 10, y: 10 });
  });

  it('MID: lines, arcs, polyline segments and splines', () => {
    expect(best([e(LINE)], at(30, 1), OSNAP.MID)).toEqual({ mode: 'MID', x: 50, y: 0 });
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: at(0, 0),
      radius: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const m = Math.SQRT1_2 * 10;
    expect(best([e(arc)], at(10, 1), OSNAP.MID)).toEqual({
      mode: 'MID',
      x: +m.toFixed(6),
      y: +m.toFixed(6),
    });
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 20, y: 0, bulge: 0 },
        { x: 20, y: 10, bulge: 0 },
      ],
    };
    // The closing segment has a midpoint too.
    expect(best([e(pl)], at(9, 4), OSNAP.MID)).toEqual({ mode: 'MID', x: 10, y: 5 });
    // A symmetric spline's midpoint by length is on its axis of symmetry.
    const spline: EntityGeometry = {
      kind: 'SPLINE',
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      controlPoints: [at(0, 0), at(10, 20), at(30, 20), at(40, 0)],
      closed: false,
      periodic: false,
    };
    const hit = best([e(spline)], at(20, 16), OSNAP.MID)!;
    expect(hit.mode).toBe('MID');
    expect(hit.x).toBeCloseTo(20, 3);
    expect(hit.y).toBeCloseTo(15, 3);
  });

  it('CEN: circles, arcs and polyline arc segments, from anywhere on them', () => {
    expect(best([e(circleGeom(200, 0, 20))], at(220, 1), OSNAP.CEN)).toEqual({
      mode: 'CEN',
      x: 200,
      y: 0,
    });
    // A half-circle bulge from (0,0) to (20,0): centre (10,0).
    const pl: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 1 },
        { x: 20, y: 0, bulge: 0 },
      ],
    };
    expect(best([e(pl)], at(10, -9.5), OSNAP.CEN)).toEqual({ mode: 'CEN', x: 10, y: 0 });
    expect(snap([e(LINE)], at(50, 1), OSNAP.CEN)).toEqual([]);
  });

  it('GCE: the centroid of a closed polyline', () => {
    const square: EntityGeometry = {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 10, bulge: 0 },
        { x: 0, y: 10, bulge: 0 },
      ],
    };
    expect(best([e(square)], at(10.5, 3), OSNAP.GCE)).toEqual({ mode: 'GCE', x: 5, y: 5 });
    // An open polyline has no geometric centre.
    expect(snap([e({ ...square, closed: false })], at(10.5, 3), OSNAP.GCE)).toEqual([]);
  });

  it('NOD: points and dimension definition points', () => {
    expect(best([e({ kind: 'POINT', position: at(5, 5) })], at(6, 5), OSNAP.NOD)).toEqual({
      mode: 'NOD',
      x: 5,
      y: 5,
    });
    const dim = {
      kind: 'DIMENSION',
      dimType: 'linear',
      style: '27',
      first: at(0, 0),
      second: at(40, 0),
      definitionPoint: at(40, 10),
      textPosition: at(20, 12),
      textUserPositioned: false,
      text: '',
      textRotation: 0,
      horizontalDirection: 0,
      attachment: 5,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    } as unknown as EntityGeometry;
    expect(best([e(dim)], at(39, 1), OSNAP.NOD)).toEqual({ mode: 'NOD', x: 40, y: 0 });
  });

  it('QUA: quadrants of circles, and of arcs only within their sweep', () => {
    expect(best([e(circleGeom(0, 0, 10))], at(1, 10.5), OSNAP.QUA)).toEqual({
      mode: 'QUA',
      x: 0,
      y: 10,
    });
    const arc: EntityGeometry = {
      kind: 'ARC',
      center: at(0, 0),
      radius: 10,
      startAngle: Math.PI / 4,
      endAngle: (3 * Math.PI) / 4,
    };
    expect(best([e(arc)], at(6, 7.5), OSNAP.QUA)).toEqual({ mode: 'QUA', x: 0, y: 10 });
    const low: EntityGeometry = { ...arc, startAngle: 0.1, endAngle: 1.4 };
    expect(snap([e(low)], at(7, 7), OSNAP.QUA)).toEqual([]);
    const ellipse: EntityGeometry = {
      kind: 'ELLIPSE',
      center: at(0, 0),
      majorAxis: at(20, 0),
      ratio: 0.5,
      startParam: 0,
      endParam: 2 * Math.PI,
    };
    expect(best([e(ellipse)], at(1, 10.5), OSNAP.QUA)).toEqual({ mode: 'QUA', x: 0, y: 10 });
  });

  it('INT: where two objects near the cursor cross, and nowhere else', () => {
    const a = e(lineGeom(0, 0, 100, 100));
    const b = e(lineGeom(0, 100, 100, 0));
    expect(best([a, b], at(52, 50), OSNAP.INT)).toEqual({ mode: 'INT', x: 50, y: 50 });
    // On one line, far from the crossing: no intersection within the aperture.
    expect(snap([a, b], at(10, 10), OSNAP.INT)).toEqual([]);
  });

  it('INS: text, blocks (and their geometry, transformed) and attributes', () => {
    const text = {
      kind: 'TEXT',
      value: 'NOZZLE',
      style: '11',
      position: at(10, 10),
      height: 2.5,
      rotation: 0,
      widthFactor: 1,
      oblique: 0,
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: false,
    } as EntityGeometry;
    expect(best([e(text)], at(11, 11), OSNAP.INS)).toEqual({ mode: 'INS', x: 10, y: 10 });
    const centred = { ...text, halign: 1, alignmentPoint: at(20, 10) } as EntityGeometry;
    expect(best([e(centred)], at(19, 11), OSNAP.INS)).toEqual({ mode: 'INS', x: 20, y: 10 });

    // BOLT: a line (1,0)–(5,0), base point (1,0); inserted at (100,100), scale 2, turned 90°.
    const inner = e(lineGeom(1, 0, 5, 0), { owner: BLOCK });
    const insert = e({
      kind: 'INSERT',
      block: BLOCK,
      position: at(100, 100),
      scale: { x: 2, y: 2, z: 1 },
      rotation: Math.PI / 2,
      attributes: [],
    } as EntityGeometry);
    expect(best([inner, insert], at(100.5, 107.5), OSNAP.END)).toEqual({
      mode: 'END',
      x: 100,
      y: 108,
    });
    expect(best([inner, insert], at(100.5, 104), OSNAP.INS)).toEqual({
      mode: 'INS',
      x: 100,
      y: 100,
    });
    // The hit names the entity of the space shown, not the block's line.
    const src = source([inner, insert]);
    const [hit] = osnap(src, { point: at(100.5, 107.5), aperture: 5, modes: OSNAP.END });
    expect(src.model.entity(hit!.id)!.type).toBe('INSERT');
  });

  it('PER: the foot from the last point, on the line or its extension', () => {
    const from = at(50, 50);
    expect(best([e(LINE)], at(52, 1), OSNAP.PER, { from })).toEqual({ mode: 'PER', x: 50, y: 0 });
    expect(best([e(lineGeom(0, 0, 10, 0))], at(9, 1), OSNAP.PER, { from })).toEqual({
      mode: 'PER',
      x: 50,
      y: 0,
    });
    // To a circle: where the line from the point through its centre meets it, nearer side.
    expect(best([e(circleGeom(0, 0, 10))], at(1, -9), OSNAP.PER, { from: at(0, 30) })).toEqual({
      mode: 'PER',
      x: 0,
      y: -10,
    });
    // No last point, no perpendicular (deferred perpendicular is not in this version).
    expect(snap([e(LINE)], at(52, 1), OSNAP.PER)).toEqual([]);
  });

  it('TAN: the tangent point from the last point nearer the cursor', () => {
    const from = at(0, -20);
    const hit = best([e(circleGeom(0, 0, 10))], at(9, -5), OSNAP.TAN, { from })!;
    // Tangent from (0,-20) to r = 10 touches at angle -30°: (8.660, -5).
    expect(hit).toEqual({ mode: 'TAN', x: 8.660254, y: -5 });
    expect(best([e(circleGeom(0, 0, 10))], at(-9, -5), OSNAP.TAN, { from })!.x).toBeCloseTo(
      -8.660254,
      5,
    );
    expect(snap([e(circleGeom(0, 0, 10))], at(9, -5), OSNAP.TAN)).toEqual([]);
  });

  it('NEA: the nearest point on the object', () => {
    expect(best([e(LINE)], at(33, 2), OSNAP.NEA)).toEqual({ mode: 'NEA', x: 33, y: 0 });
    expect(best([e(circleGeom(0, 0, 10))], at(0, 12), OSNAP.NEA)).toEqual({
      mode: 'NEA',
      x: 0,
      y: 10,
    });
  });

  it('APP: where two objects near the cursor would meet if extended', () => {
    const a = e(lineGeom(0, 0, 10, 0));
    const b = e(lineGeom(12, -5, 12, -1));
    expect(best([a, b], at(11.5, 0.5), OSNAP.APP, { aperture: 3 })).toEqual({
      mode: 'APP',
      x: 12,
      y: 0,
    });
    expect(snap([a, b], at(11.5, 0.5), OSNAP.INT, { aperture: 3 })).toEqual([]);
  });
});

describe('what is snapped to', () => {
  it('skips objects on layers turned off or frozen, and invisible objects', () => {
    const walls = [e(LINE, { layer: LAYER_WALLS })];
    expect(snap(walls, at(97, 1), OSNAP.END, {}, { walls: { on: false } })).toEqual([]);
    expect(snap(walls, at(97, 1), OSNAP.END, {}, { walls: { frozen: true } })).toEqual([]);
    expect(snap([e(LINE, { visible: false })], at(97, 1), OSNAP.END)).toEqual([]);
  });

  it('takes only objects within the aperture', () => {
    expect(snap([e(LINE)], at(50, 6), OSNAP.END)).toEqual([]);
    expect(snap([e(LINE)], at(50, 4), OSNAP.END)).toHaveLength(1);
  });

  it('snaps to nothing with no modes on', () => {
    expect(snap([e(LINE)], at(97, 1), 0)).toEqual([]);
  });
});

describe('ranking (AutoSnap)', () => {
  it('a snap point inside the aperture beats NEA, which beats points farther away', () => {
    const modes = OSNAP.END | OSNAP.MID | OSNAP.NEA;
    expect(best([e(LINE)], at(98, 1), modes)!.mode).toBe('END');
    expect(best([e(LINE)], at(52, 1), modes)!.mode).toBe('MID');
    expect(best([e(LINE)], at(30, 1), modes)!.mode).toBe('NEA');
    // Without NEA, the nearest of the points the object offers.
    expect(best([e(LINE)], at(30, 1), OSNAP.END | OSNAP.MID)!.mode).toBe('MID');
  });

  it('prefers END to INT where they coincide', () => {
    const a = e(lineGeom(0, 0, 50, 0));
    const b = e(lineGeom(50, 0, 50, 50));
    expect(best([a, b], at(49, 1), OSNAP.END | OSNAP.INT)).toEqual({ mode: 'END', x: 50, y: 0 });
  });

  it('lists every candidate once, best first', () => {
    const hits = snap([e(LINE)], at(98, 1), OSNAP.END | OSNAP.MID | OSNAP.NEA);
    expect(hits.map((h) => h.mode)).toEqual(['END', 'NEA', 'MID']);
  });
});

describe('EXTension and PARallel acquisition (M2-04 part 2)', () => {
  it("offers a line's nearer end, pointing out of the line, for EXT to acquire", () => {
    const hits = snap([e(lineGeom(0, 0, 100, 0))], at(97, 2), OSNAP.EXT);
    expect(hits).toEqual([
      expect.objectContaining({
        mode: 'EXT',
        point: { x: 100, y: 0 },
        direction: { x: 100, y: 0 },
        track: true,
      }),
    ]);
    // An arc's or circle's end has no line to run on.
    expect(snap([e(circleGeom(0, 0, 10))], at(10, 1), OSNAP.EXT)).toEqual([]);
  });

  it('offers the line under the cursor for PAR, once there is a base point', () => {
    const line = e(lineGeom(0, 0, 30, 40));
    expect(snap([line], at(15, 21), OSNAP.PAR)).toEqual([]);
    const [hit] = snap([line], at(15, 21), OSNAP.PAR, { from: at(200, 0) });
    expect(hit).toMatchObject({ mode: 'PAR', direction: { x: 30, y: 40 }, track: true });
  });

  it('lists acquisition hits after the snap points, nearest first', () => {
    const hits = snap([e(lineGeom(0, 0, 100, 0))], at(97, 2), OSNAP.END | OSNAP.EXT | OSNAP.PAR, {
      from: at(0, 50),
    });
    expect(hits.map((h) => [h.mode, !!h.track])).toEqual([
      ['END', false],
      ['PAR', true],
      ['EXT', true],
    ]);
  });
});

describe("through a layout's viewports (M2-04 part 2)", () => {
  // A viewport centred on paper (150,100), 100 × 60, its view centred on model (50,0) at half
  // size: model (x,y) is paper (125 + x/2, 100 + y/2), so (0,0)–(100,0) is (125,100)–(175,100).
  const viewport = (extra: Record<string, unknown> = {}) =>
    e(
      {
        kind: 'VIEWPORT',
        center: { x: 150, y: 100 },
        width: 100,
        height: 60,
        id: 2,
        status: 1,
        flags: 0,
        viewCenter: { x: 50, y: 0 },
        viewHeight: 120,
        viewDirection: { x: 0, y: 0, z: 1 },
        viewTarget: { x: 0, y: 0, z: 0 },
        twist: 0,
        lensLength: 50,
        frontClip: 0,
        backClip: 0,
        frozenLayers: [],
        plotStyleSheet: '',
        renderMode: 0,
        ...extra,
      } as EntityGeometry,
      { owner: PAPER_SPACE },
    );

  function paper(entities: EntityInit[], point: Vec2, modes = OSNAP.END | OSNAP.MID) {
    const src = { ...source(entities), block: PAPER_SPACE, modelSpace: MODEL_SPACE };
    return osnap(src, { point, aperture: 2, modes });
  }

  it('snaps to model space objects shown in a viewport, in paper coordinates', () => {
    const line = e(lineGeom(0, 0, 100, 0));
    const vp = viewport();
    expect(paper([line, vp], at(174, 101))[0]).toMatchObject({
      mode: 'END',
      point: { x: 175, y: 100 },
    });
    expect(paper([line, vp], at(151, 100.5))[0]).toMatchObject({
      mode: 'MID',
      point: { x: 150, y: 100 },
    });
  });

  it('snaps to nothing outside the frame, nor to layers frozen in the viewport', () => {
    const long = e(lineGeom(0, 0, 300, 0));
    const vp = viewport();
    // Model x = 300 is paper x = 275, beyond the frame's right edge at 200; the cursor outside
    // the frame does not look into the viewport at all.
    const points = (p: Vec2) => paper([long, vp], p, OSNAP.END).map((h) => h.point);
    // Inside the frame the line's near end is offered and its far end is not; the frame's
    // own corner is there either way.
    expect(points(at(199, 100))).toContainEqual({ x: 125, y: 100 });
    expect(points(at(199, 100))).not.toContainEqual({ x: 275, y: 100 });
    expect(points(at(201, 100))).not.toContainEqual({ x: 125, y: 100 });
    expect(points(at(201, 100)).length).toBeGreaterThan(0);
    const walls = e(lineGeom(0, 0, 100, 0), { layer: LAYER_WALLS });
    expect(paper([walls, viewport({ frozenLayers: [LAYER_WALLS] })], at(174, 100))).toEqual([]);
    // A viewport turned off shows, and snaps to, nothing.
    expect(paper([walls, viewport({ flags: 0x20000 })], at(174, 100))).toEqual([]);
    expect(paper([walls, viewport()], at(174, 100))[0]).toMatchObject({ mode: 'END' });
  });
});
