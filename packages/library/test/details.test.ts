// M8-02: nozzle details and vessel supports drawn from their principal dimensions. Each
// generator's drawing is pinned by a snapshot under details-snapshots/ (one line per part: what
// it is drawn as and its geometry, to four decimals); rewrite with
// `pnpm vitest run packages/library/test/details -u` and review the diff, which is the drawing's
// change as a drafter sees it.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  type DocumentInit,
  type EntityGeometry,
  type PolylineVertex,
} from '@triya/engine';
import {
  ANCHOR_CHAIR,
  BRACKET,
  LEG,
  NOZZLE_SET_IN,
  NOZZLE_SET_ON,
  SADDLE,
  SKIRT,
  SUPPORTS,
  addDetailBlock,
  checkDetail,
  detailBlockName,
  detailDefaults,
  detailDescription,
  type DetailGenerator,
  type DetailSpec,
  type LibraryPart,
} from '../src/index';

const GENERATORS: readonly DetailGenerator[] = [NOZZLE_SET_IN, NOZZLE_SET_ON, ...SUPPORTS];

const f = (v: number) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const pt = (p: { x: number; y: number }) => `(${f(p.x)}, ${f(p.y)})`;
const vertex = (v: PolylineVertex) => (v.bulge === 0 ? pt(v) : `${pt(v)} b${f(v.bulge)}`);

function geomText(g: EntityGeometry): string {
  switch (g.kind) {
    case 'LINE':
      return `LINE ${pt(g.start)} ${pt(g.end)}`;
    case 'CIRCLE':
      return `CIRCLE ${pt(g.center)} r${f(g.radius)}`;
    case 'LWPOLYLINE':
      return `LWPOLYLINE ${g.closed ? 'closed' : 'open'} ${g.vertices.map(vertex).join(' ')}`;
    case 'HATCH': {
      const how = g.solid
        ? 'SOLID'
        : `${g.pattern} ${f((g.patternAngle * 180) / Math.PI)}° ${f(g.patternScale)}`;
      const loops = g.loops.map((l) => `[${l.polyline!.vertices.map(vertex).join(' ')}]`);
      return `HATCH ${how} ${loops.join(' ')}`;
    }
    default:
      return g.kind;
  }
}

const partsText = (parts: readonly LibraryPart[]) =>
  parts.map((p) => `${p.role.padEnd(7)} ${geomText(p.geom)}`).join('\n');

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

type Poly = Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>;
const outlines = (parts: readonly LibraryPart[]) =>
  parts
    .filter((p) => p.role === 'visible' && p.geom.kind === 'LWPOLYLINE')
    .map((p) => p.geom as Poly);

const spec = <K extends string>(g: DetailGenerator<K>, change: Partial<Record<K, number>> = {}) =>
  ({ ...detailDefaults(g), ...change }) as DetailSpec<K>;

describe('library detail snapshots (M8-02)', () => {
  const cases: [string, DetailGenerator, Record<string, number>][] = [
    ['NOZZLE_SET_IN', NOZZLE_SET_IN, {}],
    [
      'NOZZLE_SET_IN-internal-no-pad',
      NOZZLE_SET_IN,
      {
        internalProjection: 1,
        padDiameter: 0,
        padThickness: 0,
      },
    ],
    ['NOZZLE_SET_ON', NOZZLE_SET_ON, {}],
    [
      'NOZZLE_SET_ON-no-pad-no-weld',
      NOZZLE_SET_ON,
      { padDiameter: 0, padThickness: 0, weldLeg: 0 },
    ],
    ['SADDLE', SADDLE, {}],
    [
      'SADDLE-no-wear-plate-no-holes',
      SADDLE,
      {
        wearPlateThickness: 0,
        wearPlateAngle: 0,
        boltSpacing: 0,
        holeDiameter: 0,
      },
    ],
    ['LEG', LEG, {}],
    ['BRACKET', BRACKET, {}],
    ['BRACKET-no-pad', BRACKET, { padThickness: 0, padHeight: 0 }],
    ['SKIRT', SKIRT, {}],
    ['ANCHOR_CHAIR', ANCHOR_CHAIR, {}],
  ];
  for (const [file, g, change] of cases)
    it(`pins ${file}`, async () => {
      const s = spec(g, change);
      expect(checkDetail(g, s)).toBeUndefined();
      const text = `# ${detailBlockName(g, s)}\n# ${detailDescription(g, s)}\n${partsText(g.parts(s))}\n`;
      await expect(text).toMatchFileSnapshot(`details-snapshots/${file}.txt`);
    });
});

describe('library details (M8-02)', () => {
  it('lists each dimension once, with a default, under codes of its own', () => {
    for (const g of GENERATORS) {
      expect(new Set(g.fields.map((x) => x.key)).size).toBe(g.fields.length);
      expect(new Set(g.fields.map((x) => x.code)).size).toBe(g.fields.length);
      expect(Object.keys(g.defaults).sort()).toEqual(g.fields.map((x) => x.key).sort());
      expect(checkDetail(g, detailDefaults(g)), g.id).toBeUndefined();
    }
  });

  it('draws every plate as a closed outline enclosing metal', () => {
    for (const g of GENERATORS) {
      for (const p of outlines(g.parts(detailDefaults(g)))) {
        expect(p.closed, g.id).toBe(true);
        expect(Math.abs(area(p.vertices)), g.id).toBeGreaterThan(0);
      }
    }
  });

  it("scales the defaults' lengths, not their angles, to the drawing's units", () => {
    for (const g of GENERATORS) {
      const inches = detailDefaults(g);
      const mm = detailDefaults(g, 25.4);
      for (const x of g.fields)
        expect(mm[x.key]).toBeCloseTo(x.kind === 'angle' ? inches[x.key] : inches[x.key] * 25.4, 9);
      expect(checkDetail(g, mm), g.id).toBeUndefined();
      // Drawn from millimetres, the same drawing 25.4 times the size.
      const a = g.parts(inches).flatMap((p) => outlines([p]).flatMap((o) => o.vertices));
      const b = g.parts(mm).flatMap((p) => outlines([p]).flatMap((o) => o.vertices));
      expect(b).toHaveLength(a.length);
      b.forEach((v, i) => {
        expect(v.x).toBeCloseTo(a[i]!.x * 25.4, 6);
        expect(v.y).toBeCloseTo(a[i]!.y * 25.4, 6);
        expect(v.bulge).toBeCloseTo(a[i]!.bulge, 12);
      });
    }
    expect(detailDefaults(SADDLE, 25.4).contactAngle).toBe(120);
  });

  it('refuses dimensions that make no such part, saying why', () => {
    const refused: [DetailGenerator, Record<string, number>, string][] = [
      [NOZZLE_SET_IN, { neckOD: Number.NaN }, 'neck OD must be a number'],
      [NOZZLE_SET_IN, { neckOD: 0 }, 'neck OD must be more than 0'],
      [NOZZLE_SET_IN, { weldLeg: -1 }, 'weld leg must be more than 0'],
      [NOZZLE_SET_IN, { neckThickness: 4 }, 'neck thickness must be less than half the neck OD'],
      [NOZZLE_SET_IN, { padThickness: 0 }, 'a pad needs both its diameter and its thickness'],
      [NOZZLE_SET_ON, { padDiameter: 6 }, 'pad diameter must be more than the neck OD'],
      [
        NOZZLE_SET_ON,
        { shellLength: 13 },
        'shell length shown must be more than the neck OD and the pad diameter',
      ],
      [NOZZLE_SET_ON, { weldLeg: 8 }, 'weld leg must be less than the projection'],
      [SADDLE, { contactAngle: 190 }, 'contact angle must be 180° or less'],
      [SADDLE, { wearPlateAngle: 0 }, 'a wear plate needs both its thickness and its angle'],
      [SADDLE, { wearPlateAngle: 110 }, 'wear plate angle must be from the contact angle to 180°'],
      [
        SADDLE,
        { height: 31 },
        'height must be more than the vessel radius, the plates and the base',
      ],
      [SADDLE, { holeDiameter: 0 }, 'bolt holes need both their spacing and their diameter'],
      [SADDLE, { boltSpacing: 51 }, 'bolt holes must lie inside the base'],
      [LEG, { legHeight: 0.5 }, 'leg height must be more than the base plate'],
      [LEG, { basePlateWidth: 6 }, 'base plate width must be more than the leg width'],
      [LEG, { holeDiameter: 2 }, 'the bolt holes must fit on the base plate beside the leg'],
      [
        BRACKET,
        { chamfer: 9.5 },
        'gusset end must be less than the projection and the gusset height',
      ],
      [BRACKET, { holeOffset: 0 }, 'a bolt hole needs both its diameter and its offset'],
      [BRACKET, { holeOffset: 7.75 }, 'the bolt hole must lie inside the base'],
      [BRACKET, { padHeight: 0 }, 'a pad needs both its thickness and its height'],
      [BRACKET, { padHeight: 9 }, 'pad height must be at least the height'],
      [SKIRT, { skirtThickness: 30 }, 'skirt thickness must be less than half the skirt OD'],
      [SKIRT, { skirtHeight: 1 }, 'skirt height must be more than the base ring'],
      [SKIRT, { baseRingOD: 60 }, 'base ring OD must be more than the skirt OD'],
      [SKIRT, { baseRingID: 59 }, 'base ring ID must be less than the skirt ID'],
      [SKIRT, { holeDiameter: 0 }, 'bolt holes need both their bolt circle and their diameter'],
      [SKIRT, { boltCircle: 61 }, 'bolt holes must lie on the base ring outside the skirt'],
      [SKIRT, { openingHeight: 0 }, 'an access opening needs both its diameter and its height'],
      [
        SKIRT,
        { openingHeight: 9 },
        'the access opening must lie inside the skirt above the base ring',
      ],
      [ANCHOR_CHAIR, { holeDiameter: 4 }, 'the bolt must pass between the gussets'],
      [ANCHOR_CHAIR, { topPlateWidth: 5 }, 'top plate width must cover the gussets'],
      [
        ANCHOR_CHAIR,
        { ringLengthShown: 7 },
        'base ring length shown must be at least the top plate width',
      ],
    ];
    for (const [g, change, why] of refused) expect(checkDetail(g, spec(g, change))).toBe(why);
  });

  it('passes a set-in neck through the shell and stands a set-on neck on it', () => {
    const s = spec(NOZZLE_SET_IN, { internalProjection: 1 });
    const [shellIn, , neckIn] = outlines(NOZZLE_SET_IN.parts(s));
    // The set-in shell's hole is the neck's outside; its neck runs to the internal projection.
    expect(Math.min(...shellIn!.vertices.map((v) => v.x))).toBeCloseTo(s.neckOD / 2, 12);
    expect(Math.min(...neckIn!.vertices.map((v) => v.y))).toBeCloseTo(-s.shellThickness - 1, 12);
    const on = spec(NOZZLE_SET_ON);
    const [shellOn, , neckOn] = outlines(NOZZLE_SET_ON.parts(on));
    expect(Math.min(...shellOn!.vertices.map((v) => v.x))).toBeCloseTo(
      on.neckOD / 2 - on.neckThickness,
      12,
    );
    expect(Math.min(...neckOn!.vertices.map((v) => v.y))).toBe(0);
    // Every neck ends at the projection.
    for (const n of [neckIn!, neckOn!])
      expect(Math.max(...n.vertices.map((v) => v.y))).toBeCloseTo(s.projection, 12);
  });

  it('seats the saddle on the vessel over its contact angle', () => {
    const s = spec(SADDLE);
    const [, web, top, wear] = outlines(SADDLE.parts(s));
    const r = s.vesselOD / 2;
    const angleOf = (v: PolylineVertex) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
    // The wear plate sits on the vessel; the top plate on the wear plate, over the contact angle.
    for (const v of wear!.vertices.slice(2)) expect(Math.hypot(v.x, v.y)).toBeCloseTo(r, 12);
    expect(angleOf(top!.vertices[0]!) - angleOf(top!.vertices[1]!)).toBeCloseTo(120, 9);
    expect(angleOf(wear!.vertices[0]!) - angleOf(wear!.vertices[1]!)).toBeCloseTo(132, 9);
    // The web's horns are the top plate's outer corners.
    expect(web!.vertices[2]).toMatchObject({ x: top!.vertices[0]!.x, y: top!.vertices[0]!.y });
    expect(web!.vertices[3]).toMatchObject({ x: top!.vertices[1]!.x, y: top!.vertices[1]!.y });
    // The base plate's underside is the height below the vessel's axis.
    const [base] = outlines(SADDLE.parts(s));
    expect(Math.min(...base!.vertices.map((v) => v.y))).toBe(-42);
  });

  it('names a block by its dimensions, leaving out the ones it does without', () => {
    expect(
      detailBlockName(NOZZLE_SET_ON, spec(NOZZLE_SET_ON, { padDiameter: 0, padThickness: 0 })),
    ).toBe('TRIYA_NOZZLE_SET_ON_OD6.625_T0.432_TS0.5_P8_W0.375_L20');
    expect(detailBlockName(NOZZLE_SET_IN, detailDefaults(NOZZLE_SET_IN, 25.4))).toBe(
      'TRIYA_NOZZLE_SET_IN_OD168.275_T10.9728_TS12.7_P203.2_PD336.55_TP12.7_W9.525_L508',
    );
    expect(detailDescription(SADDLE, spec(SADDLE, { boltSpacing: 0, holeDiameter: 0 }))).toBe(
      'Saddle support, end view: vessel OD 60, height to vessel axis 42, contact angle 120°, ' +
        'base length 52, base thickness 0.75, top plate thickness 0.5, wear plate thickness ' +
        '0.375, wear plate angle 132°',
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

describe('library detail blocks (M8-02)', () => {
  it("adds a block on layer 0 ByBlock in the drawing's units, and finds one it has", () => {
    const model = drawing(4, 'metric', ['HIDDEN', 'CENTER']);
    const s = detailDefaults(SKIRT, 25.4);
    const b = new ChangeSetBuilder(model);
    const made = addDetailBlock(b, model, SKIRT, s)!;
    expect(addDetailBlock(b, model, SKIRT, { ...s, baseRingOD: 0 })).toBeUndefined();
    model.apply(b.build());
    expect(model.blocks.get(made)).toMatchObject({
      name: detailBlockName(SKIRT, s),
      basePoint: { x: 0, y: 0 },
      description: detailDescription(SKIRT, s),
    });
    expect(model.tables.blockRecords.get(made)).toMatchObject({ units: 4 });
    const parts = model.blockEntities(made).map((id) => model.entity(id)!);
    expect(parts).toHaveLength(SKIRT.parts(s).length);
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
    const blocks = model.blocks.size;
    const again = new ChangeSetBuilder(model);
    expect(addDetailBlock(again, model, SKIRT, s)).toBe(made);
    model.apply(again.build());
    expect(model.blocks.size).toBe(blocks);
  });

  it('takes another scale of HIDDEN and CENTER when the drawing lacks the full one', () => {
    const model = drawing(4, 'metric', ['CENTERX2', 'HIDDEN2', 'CENTER2']);
    const b = new ChangeSetBuilder(model);
    const made = addDetailBlock(b, model, LEG, detailDefaults(LEG, 25.4))!;
    model.apply(b.build());
    const names = model
      .blockEntities(made)
      .map((id) => model.entity(id)!.linetype)
      .map((lt) => (lt.startsWith('By') ? lt : model.tables.linetypes.get(lt)?.name));
    expect(new Set(names)).toEqual(new Set(['ByBlock', 'HIDDEN2', 'CENTER2']));
  });
});
