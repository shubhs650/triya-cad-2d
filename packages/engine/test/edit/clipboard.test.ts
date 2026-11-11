// M2-14 part 2: copying objects out of one drawing and pasting them into another. AutoCAD 2024
// Help, "COPYCLIP", "PASTECLIP", "PASTEBLOCK", "PASTEORIG": the Clipboard holds the objects with
// the definitions they use; pasting brings in the layers, linetypes, styles and blocks the target
// lacks and uses the target's own where it has one of the same name ("duplicate definitions are
// ignored", as INSERT of a drawing); every object pasted is new, so it takes a handle above the
// target's $HANDSEED.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  compareHandles,
  invertChangeSet,
  copyToClipboard,
  pasteAsBlock,
  pasteObjects,
  type Clipboard,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type SymbolTableRecord,
} from '../../src/index';
import {
  MODEL_SPACE,
  PAPER_SPACE,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  linetype,
  record,
  sampleInit,
  snapshot,
} from '../model/fixtures';

// Engine tests have no DOM or Node types: the global every runtime they run in has.
declare function structuredClone<T>(value: T): T;

const text = (x: number, y: number, style: string, value = 'NOTE'): EntityGeometry => ({
  kind: 'TEXT',
  value,
  style,
  position: { x, y },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

const textStyle = (handle: string, name: string) => ({
  handle,
  name,
  font: 'txt',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const square: EntityGeometry & { kind: 'LWPOLYLINE' } = {
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 0 },
    { x: 10, y: 10, bulge: 0 },
    { x: 0, y: 10, bulge: 0 },
  ],
};

const hatch = (sources: string[]): EntityGeometry => ({
  kind: 'HATCH',
  pattern: 'SOLID',
  solid: true,
  associative: true,
  style: 0,
  patternType: 1,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  loops: [
    {
      flags: 1,
      polyline: { vertices: square.vertices, closed: true },
      sources,
    },
  ],
  patternLines: [],
  seedPoints: [],
});

const dimension = (style: string, block: string): EntityGeometry =>
  ({
    kind: 'DIMENSION',
    dimType: 'linear',
    style,
    block,
    definitionPoint: { x: 10, y: -5 },
    textPosition: { x: 5, y: -5 },
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    first: { x: 0, y: 0 },
    second: { x: 10, y: 0 },
    rotation: 0,
  }) as EntityGeometry;

const insert = (block: string, x: number, y: number, attributes: unknown[] = []): EntityGeometry =>
  ({
    kind: 'INSERT',
    block,
    position: { x, y },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    attributes,
  }) as EntityGeometry;

/** An IMAGE of `definition`, 100 × 50 pixels of 0.1 units with its lower left at (x, y). */
const image = (definition: string | undefined, x = 0, y = 0): EntityGeometry => ({
  kind: 'IMAGE',
  ...(definition !== undefined ? { definition } : {}),
  position: { x, y },
  u: { x: 0.1, y: 0 },
  v: { x: 0, y: 0.1 },
  size: { x: 100, y: 50 },
  displayFlags: 7,
  clipping: false,
  brightness: 50,
  contrast: 50,
  fade: 0,
  clip: {
    type: 'rectangle',
    vertices: [
      { x: -0.5, y: -0.5 },
      { x: 99.5, y: 49.5 },
    ],
    inverted: false,
  },
});

/** A PDFUNDERLAY of `definition` at (x, y). */
const underlay = (definition: string | undefined, x = 0, y = 0): EntityGeometry => ({
  kind: 'PDFUNDERLAY',
  ...(definition !== undefined ? { definition } : {}),
  position: { x, y },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  flags: 2,
  contrast: 100,
  fade: 0,
  clip: [],
});

const imageDef = (handle: string, owner: string, name: string, fileName: string) => ({
  handle,
  type: 'IMAGEDEF' as const,
  owner,
  name,
  fileName,
  size: { x: 100, y: 50 },
  pixelSize: { x: 1, y: 1 },
  loaded: true,
  units: 0,
});

const pdfDef = (handle: string, owner: string, name: string, fileName: string, page = '1') => ({
  handle,
  type: 'PDFDEFINITION' as const,
  owner,
  name,
  fileName,
  page,
});

/**
 * The drawing copied from: a LINE on WALLS with MYAPP xdata naming the CHAIR block (1005), a
 * TEXT in NOTES, a CHAIR reference (CHAIR holds a LEG reference; LEG a circle on DASHED_L), a
 * dimension in MECH (its text in NOTES, its arrow the ARROW block) drawing *D1, a square with its
 * associative hatch, and an image. Linetype UNUSED and layer SPARE are used by nothing copied.
 */
function sourceInit(): DocumentInit {
  const e = (h: string, g: EntityGeometry, extra: Partial<EntityInit> = {}) =>
    entityInit(h, g, extra);
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '100',
    header: new Map<string, HeaderValue>([['$CLAYER', '0']]),
    tables: {
      layers: [
        layer('10', '0'),
        { ...layer('11', 'WALLS'), color: { kind: 'aci', index: 5 } },
        { ...layer('12', 'DASHED_L'), linetype: '15' },
        layer('13', 'SPARE'),
      ],
      linetypes: [linetype('14', 'Continuous'), linetype('15', 'DASHED'), linetype('17', 'UNUSED')],
      textStyles: [textStyle('30', 'Standard'), textStyle('31', 'NOTES')],
      dimStyles: [
        { handle: '32', name: 'MECH', vars: { DIMTXSTY: '31', DIMBLK: '40', DIMSCALE: 2 } },
      ],
      appIds: [record('18', 'ACAD'), record('16', 'MYAPP')],
      blockRecords: [
        blockRecord(MODEL_SPACE, '*Model_Space'),
        blockRecord(PAPER_SPACE, '*Paper_Space'),
        blockRecord('40', 'ARROW'),
        blockRecord('41', 'CHAIR'),
        blockRecord('42', 'LEG'),
        { ...blockRecord('43', '*D1'), flags: 1 },
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PAPER_SPACE, name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
      { handle: '40', name: 'ARROW', basePoint: { x: 0, y: 0 } },
      { handle: '41', name: 'CHAIR', basePoint: { x: 0, y: 0 } },
      { handle: '42', name: 'LEG', basePoint: { x: 0, y: 0 } },
      { handle: '43', name: '*D1', basePoint: { x: 0, y: 0 }, flags: 1 },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      { handle: '1E', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE },
    ],
    objects: [
      { handle: 'C', type: 'DICTIONARY', owner: '0' },
      imageDef('70', 'C', 'site', '.\\photos\\site.png'),
    ],
    entities: [
      e('53', lineGeom(0, 0, -1, 0.3), { owner: '40' }),
      e('50', lineGeom(0, 0, 0, 5), { owner: '41' }),
      e('51', insert('42', 0, 0), { owner: '41' }),
      e('52', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }, { owner: '42', layer: '12' }),
      e('54', lineGeom(0, -5, 10, -5), { owner: '43' }),
      e('55', text(5, -5, '31', '10'), { owner: '43' }),
      e('60', lineGeom(0, 0, 10, 0), {
        layer: '11',
        xdata: [
          {
            appId: '16',
            values: [
              { code: 1000, value: 'hi' },
              { code: 1005, value: '41' },
            ],
          },
        ],
      }),
      e('61', text(0, 20, '31')),
      e(
        '62',
        insert('41', 100, 100, [
          {
            ...text(100, 90, '31', 'OAK'),
            tag: 'WOOD',
            flags: 0,
            handle: '63',
            layer: '10',
            color: { kind: 'byLayer' },
            linetype: 'ByLayer',
            lineweight: 'ByLayer',
            transparency: 'ByLayer',
            ltScale: 1,
            visible: true,
          },
        ]),
      ),
      e('64', dimension('32', '43')),
      e('65', square, { reactors: ['66'] }),
      e('66', hatch(['65'])),
      e('67', image('70')),
      e('68', lineGeom(0, 0, 1, 1), { layer: '13' }),
    ],
  };
}

/** The drawing pasted into: sampleInit (layers 0 and WALLS, one Continuous linetype) plus a CHAIR of its own. */
function targetInit(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    handSeed: '200',
    tables: {
      ...base.tables,
      appIds: [record('18', 'ACAD')],
      textStyles: [textStyle('30', 'Standard')],
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('25', 'CHAIR')],
    },
    blocks: [...(base.blocks ?? []), { handle: '25', name: 'CHAIR', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...(base.entities ?? []),
      entityInit('26', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 3 }, { owner: '25' }),
    ],
  };
}

const COPIED = ['60', '61', '62', '64', '65', '66', '67'];

function copied(at = { x: 0, y: 0 }) {
  const source = DocumentModel.create(sourceInit());
  // Picked in another order than they are drawn: the clipboard keeps the drawing's order.
  const ids = [...COPIED].reverse().map((h) => source.entityByHandle(h)!.id);
  const copy = copyToClipboard(source, ids, at);
  // What the app keeps arrives through postMessage.
  return { source, copy, clip: structuredClone(copy.clipboard) as Clipboard };
}

function paste(
  model: DocumentModel,
  clip: Clipboard,
  to: { x: number; y: number } = { x: 1000, y: 0 },
) {
  const b = new ChangeSetBuilder(model);
  const report = pasteObjects(b, model, clip, MODEL_SPACE, to);
  model.apply(b.build());
  const pasted = report.ids.map((id) => model.entity(id)!);
  return { report, pasted };
}

const byName = <T extends SymbolTableRecord>(m: ReadonlyMap<string, T>, name: string) =>
  [...m.values()].find((r) => r.name.toUpperCase() === name.toUpperCase());

const of = (pasted: Entity[], kind: string) => pasted.filter((e) => e.type === kind);

describe('copyToClipboard', () => {
  it('holds the objects in drawing order with only the definitions they use', () => {
    const { copy, clip } = copied();
    expect(clip.entities.map((e) => e.handle)).toEqual(['60', '61', '62', '64', '65', '66', '67']);
    expect([...copy.refused]).toEqual([]);
    const names = (t: keyof Clipboard['tables']) =>
      (clip.tables[t] ?? []).map((r) => (r as SymbolTableRecord).name).sort();
    expect(names('layers')).toEqual(['0', 'DASHED_L', 'WALLS']);
    expect(names('linetypes')).toEqual(['Continuous', 'DASHED']);
    expect(names('textStyles')).toEqual(['NOTES']);
    expect(names('dimStyles')).toEqual(['MECH']);
    expect(names('appIds')).toEqual(['MYAPP']);
    expect(clip.blocks.map((b) => b.name).sort()).toEqual(['*D1', 'ARROW', 'CHAIR', 'LEG']);
    expect(clip.blockEntities.map((e) => e.handle).sort()).toEqual(
      ['50', '51', '52', '53', '54', '55'].sort(),
    );
  });

  it('keeps no links a copy cannot keep: reactors, extension dictionaries, originals', () => {
    const { clip } = copied();
    for (const e of clip.entities) {
      expect(e).not.toHaveProperty('reactors');
      expect(e).not.toHaveProperty('extDict');
      expect(e).not.toHaveProperty('raw');
      expect(e).not.toHaveProperty('id');
    }
  });

  it('keeps the base point it was given', () => {
    expect(copied({ x: 3, y: 4 }).clip.base).toEqual({ x: 3, y: 4 });
  });
});

describe('pasteObjects', () => {
  it('adds every object with a new handle above the target $HANDSEED', () => {
    const target = DocumentModel.create(targetInit());
    const { clip } = copied();
    const before = new Set([...target.entities()].map((e) => e.handle));
    const { pasted } = paste(target, clip);
    expect(pasted.map((e) => e.type)).toEqual([
      'LINE',
      'TEXT',
      'INSERT',
      'DIMENSION',
      'LWPOLYLINE',
      'HATCH',
      'IMAGE',
    ]);
    const fresh = [...target.entities()].filter((e) => !before.has(e.handle));
    for (const e of fresh) expect(compareHandles(e.handle, '200')).toBeGreaterThanOrEqual(0);
    const attribute = (
      of(pasted, 'INSERT')[0]!.geom as unknown as { attributes: { handle: string }[] }
    ).attributes[0]!;
    expect(compareHandles(attribute.handle, '200')).toBeGreaterThanOrEqual(0);
    for (const t of Object.values(target.tables)) {
      for (const r of t.values()) {
        if (!['10', '11', '14', '18', '1B', '1F', '25', '30'].includes(r.handle)) {
          expect(compareHandles(r.handle, '200'), r.handle).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("uses the target's records of the same name and adds the ones it lacks", () => {
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, copied().clip);
    const line = of(pasted, 'LINE')[0]!;
    expect(line.layer).toBe('11');
    expect(target.tables.layers.get('11')!.color).toEqual({ kind: 'aci', index: 7 });
    const dashed = byName(target.tables.layers, 'DASHED_L')!;
    expect(target.tables.linetypes.get(dashed.linetype)!.name).toBe('DASHED');
    expect(byName(target.tables.layers, 'SPARE')).toBeUndefined();
    expect(byName(target.tables.linetypes, 'UNUSED')).toBeUndefined();
    const notes = byName(target.tables.textStyles, 'NOTES')!;
    expect((of(pasted, 'TEXT')[0]!.geom as { style: string }).style).toBe(notes.handle);
    const mech = byName(target.tables.dimStyles, 'MECH')!;
    const arrow = byName(target.tables.blockRecords, 'ARROW')!;
    expect(mech.vars).toEqual({ DIMTXSTY: notes.handle, DIMBLK: arrow.handle, DIMSCALE: 2 });
    expect(target.blockEntities(arrow.handle)).toHaveLength(1);
  });

  it("keeps the target's block of the same name and brings the rest", () => {
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, copied().clip);
    expect((of(pasted, 'INSERT')[0]!.geom as { block: string }).block).toBe('25');
    expect(target.blockEntities('25')).toHaveLength(1);
    const leg = byName(target.tables.blockRecords, 'LEG')!;
    const circle = target.entity(target.blockEntities(leg.handle)[0]!)!;
    expect(target.tables.layers.get(circle.layer)!.name).toBe('DASHED_L');
    expect(circle.owner).toBe(leg.handle);
  });

  it('gives a dimension a block of its own, carried with it', () => {
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, copied().clip);
    const dim = of(pasted, 'DIMENSION')[0]!;
    const block = (dim.geom as { block: string }).block;
    expect(target.blocks.get(block)!.name).toMatch(/^\*D\d+$/);
    const [line] = target.blockEntities(block).map((id) => target.entity(id)!);
    expect(line!.geom).toMatchObject({ start: { x: 1000, y: -5 }, end: { x: 1010, y: -5 } });
    expect(dim.geom).toMatchObject({ first: { x: 1000, y: 0 }, second: { x: 1010, y: 0 } });
  });

  it('keeps a hatch associative with its pasted boundary', () => {
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, copied().clip);
    const [square] = of(pasted, 'LWPOLYLINE');
    const [h] = of(pasted, 'HATCH');
    expect(h!.geom).toMatchObject({ associative: true, loops: [{ sources: [square!.handle] }] });
    expect(square!.reactors).toEqual([h!.handle]);
  });

  it('lets a hatch go of a boundary that was not copied', () => {
    const source = DocumentModel.create(sourceInit());
    const clip = copyToClipboard(source, [source.entityByHandle('66')!.id], {
      x: 0,
      y: 0,
    }).clipboard;
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, clip);
    expect(pasted[0]!.geom).toMatchObject({ associative: false });
    expect((pasted[0]!.geom as unknown as { loops: object[] }).loops[0]).not.toHaveProperty(
      'sources',
    );
  });

  it("names the target's application and objects in pasted xdata", () => {
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, copied().clip);
    const myapp = byName(target.tables.appIds, 'MYAPP')!;
    expect(of(pasted, 'LINE')[0]!.xdata).toEqual([
      {
        appId: myapp.handle,
        values: [
          { code: 1000, value: 'hi' },
          { code: 1005, value: '25' },
        ],
      },
    ]);
  });

  it('moves the base point to the point given', () => {
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, copied({ x: 5, y: 5 }).clip, { x: 15, y: 25 });
    expect(of(pasted, 'LINE')[0]!.geom).toMatchObject({
      start: { x: 10, y: 20 },
      end: { x: 20, y: 20 },
    });
  });

  it('pasted twice, adds the definitions once', () => {
    const target = DocumentModel.create(targetInit());
    const { clip } = copied();
    paste(target, clip);
    const sizes = () =>
      Object.fromEntries(Object.entries(target.tables).map(([k, t]) => [k, t.size]));
    const first = sizes();
    const { pasted } = paste(target, clip, { x: 2000, y: 0 });
    // The second dimension draws a block of its own; everything else is there already.
    expect(sizes()).toEqual({ ...first, blockRecords: first.blockRecords! + 1 });
    expect(pasted).toHaveLength(7);
  });

  it('is undone by its inverse', () => {
    const target = DocumentModel.create(targetInit());
    const was = snapshot(target);
    const b = new ChangeSetBuilder(target);
    pasteObjects(b, target, copied().clip, MODEL_SPACE, { x: 0, y: 0 });
    const cs = b.build();
    target.apply(cs);
    expect(snapshot(target)).not.toEqual(was);
    target.apply(invertChangeSet(cs));
    expect(snapshot(target)).toEqual(was);
  });
});

describe('pasteAsBlock', () => {
  it('pastes the objects as one reference to a new block based at the copy base point', () => {
    const target = DocumentModel.create(targetInit());
    const { clip } = copied({ x: 5, y: 5 });
    const b = new ChangeSetBuilder(target);
    const report = pasteAsBlock(b, target, clip, MODEL_SPACE, '11', { x: 50, y: 60 });
    target.apply(b.build());
    expect(report.ids).toHaveLength(1);
    const ref = target.entity(report.ids[0]!)!;
    expect(ref.layer).toBe('11');
    const g = ref.geom as { block: string; position: object };
    expect(g.position).toEqual({ x: 50, y: 60 });
    const def = target.blocks.get(g.block)!;
    expect(def.name).toMatch(/^A\$C[0-9A-F]{8}$/);
    expect(def.basePoint).toEqual({ x: 5, y: 5 });
    expect(target.blockEntities(def.handle).map((id) => target.entity(id)!.type)).toEqual([
      'LINE',
      'TEXT',
      'INSERT',
      'DIMENSION',
      'LWPOLYLINE',
      'HATCH',
      'IMAGE',
    ]);
  });
});

// M2-32: AutoCAD 2024 Help, "PASTECLIP": objects pasted into a drawing whose units differ are
// scaled, as INSERT scales a drawing whose INSUNITS differ from the target's (the Clipboard is
// such a drawing, in the source's units). Where either drawing is unitless (INSUNITS 0),
// nothing is scaled: INSUNITSDEFSOURCE/INSUNITSDEFTARGET, which once stood in for a unitless
// drawing, are obsolete, and a drafter pasting between unitless drawings expects no scale.
describe('pasted between drawings of other units', () => {
  const withUnits = (insUnits: number): DocumentInit => {
    const init = targetInit();
    return { ...init, meta: { ...init.meta, insUnits } };
  };

  it("keeps the source's INSUNITS on the Clipboard", () => {
    expect(copied().clip.insUnits).toBe(4);
  });

  it('scales the objects about the base point by the ratio of the units', () => {
    // Millimetres into metres.
    const target = DocumentModel.create(withUnits(6));
    const { pasted } = paste(target, copied({ x: 5, y: 5 }).clip, { x: 15, y: 25 });
    const line = of(pasted, 'LINE')[0]!.geom as { start: Vec; end: Vec };
    expect(round(line.start)).toEqual({ x: 14.995, y: 24.995 });
    expect(round(line.end)).toEqual({ x: 15.005, y: 24.995 });
    expect(of(pasted, 'TEXT')[0]!.geom).toMatchObject({ height: 2.5 * 0.001 });
    const ref = of(pasted, 'INSERT')[0]!.geom as { scale: { x: number; y: number } };
    expect(ref.scale.x).toBeCloseTo(0.001, 12);
    expect(ref.scale.y).toBeCloseTo(0.001, 12);
  });

  it('scales millimetres into inches by 1/25.4', () => {
    const target = DocumentModel.create(withUnits(1));
    const { pasted } = paste(target, copied().clip, { x: 0, y: 0 });
    const line = of(pasted, 'LINE')[0]!.geom as { start: Vec; end: Vec };
    expect(line.end.x - line.start.x).toBeCloseTo(10 / 25.4, 12);
  });

  it('scales nothing when either drawing is unitless', () => {
    const target = DocumentModel.create(withUnits(0));
    const { pasted } = paste(target, copied().clip, { x: 0, y: 0 });
    expect(of(pasted, 'LINE')[0]!.geom).toMatchObject({ end: { x: 10, y: 0 } });
    const unitless = { ...copied().clip, insUnits: 0 };
    const inches = DocumentModel.create(withUnits(1));
    const again = paste(inches, unitless, { x: 0, y: 0 });
    expect(of(again.pasted, 'LINE')[0]!.geom).toMatchObject({ end: { x: 10, y: 0 } });
  });

  it('PASTEBLOCK scales the reference and keeps the block in the source units', () => {
    const target = DocumentModel.create(withUnits(6));
    const b = new ChangeSetBuilder(target);
    const report = pasteAsBlock(b, target, copied({ x: 5, y: 5 }).clip, MODEL_SPACE, '11', {
      x: 50,
      y: 60,
    });
    target.apply(b.build());
    const g = target.entity(report.ids[0]!)!.geom as {
      block: string;
      position: Vec;
      scale: { x: number; y: number; z: number };
    };
    expect(g.position).toEqual({ x: 50, y: 60 });
    expect(g.scale.x).toBeCloseTo(0.001, 12);
    expect(g.scale.y).toBeCloseTo(0.001, 12);
    expect(g.scale.z).toBeCloseTo(0.001, 12);
    expect(target.tables.blockRecords.get(g.block)?.units).toBe(4);
    // The block's own objects are as copied.
    const line = target
      .blockEntities(g.block)
      .map((id) => target.entity(id)!)
      .find((e) => e.type === 'LINE')!.geom;
    expect(line).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  });
});

type Vec = { x: number; y: number };
const round = (p: Vec): Vec => ({
  x: Math.round(p.x * 1e9) / 1e9 + 0,
  y: Math.round(p.y * 1e9) / 1e9 + 0,
});

// M2-32 part 2: an image or PDF underlay pasted into another drawing brings its definition (the
// IMAGEDEF or PDFDEFINITION naming its file), as AutoCAD's COPYCLIP carries what an object needs.
// A definition is a named entry of the target's ACAD_IMAGE_DICT or ACAD_PDFDEFINITIONS, and as
// with blocks and layers "duplicate definitions are ignored": one the target already has under
// that name (case aside) is the target's, whatever file it names.
describe('images and PDF underlays pasted into another drawing (M2-32 part 2)', () => {
  /** Images of `site` and `logo` (`logo` in block STAMP), an underlay of `plan - 1`. */
  function imageSource(): DocumentInit {
    const base = sourceInit();
    return {
      ...base,
      meta: { ...base.meta, imageDictionary: 'C', pdfDictionary: 'D' },
      tables: {
        ...base.tables,
        blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('44', 'STAMP')],
      },
      blocks: [...(base.blocks ?? []), { handle: '44', name: 'STAMP', basePoint: { x: 0, y: 0 } }],
      objects: [
        { handle: 'C', type: 'DICTIONARY', owner: '0' },
        { handle: 'D', type: 'DICTIONARY', owner: '0' },
        imageDef('70', 'C', 'site', '.\\photos\\site.png'),
        imageDef('72', 'C', 'logo', 'logo.png'),
        imageDef('73', 'C', 'unused', 'unused.png'),
        pdfDef('71', 'D', 'plan - 1', '..\\sheets\\plan.pdf'),
      ],
      entities: [
        ...(base.entities ?? []),
        entityInit('80', image('72'), { owner: '44' }),
        entityInit('81', underlay('71', 5, 5)),
        entityInit('82', insert('44', 20, 20)),
        entityInit('83', image('74')),
      ],
    };
  }

  const copyOf = (handles: string[]) => {
    const source = DocumentModel.create(imageSource());
    const ids = handles.map((h) => source.entityByHandle(h)!.id);
    const copy = copyToClipboard(source, ids, { x: 0, y: 0 });
    return { copy, clip: structuredClone(copy.clipboard) as Clipboard };
  };

  const definitions = (m: DocumentModel, type: string) =>
    [...m.objects.values()].filter((o) => o.type === type) as unknown as {
      handle: string;
      owner: string;
      name: string;
      fileName: string;
    }[];

  const withDictionaries = (): DocumentInit => {
    const init = targetInit();
    return {
      ...init,
      meta: { ...init.meta, imageDictionary: 'E', pdfDictionary: 'F' },
      objects: [
        ...(init.objects ?? []),
        { handle: 'E', type: 'DICTIONARY', owner: 'C' },
        { handle: 'F', type: 'DICTIONARY', owner: 'C' },
      ],
    };
  };

  it('carries the definitions the copied objects and their blocks show, and no others', () => {
    const { copy, clip } = copyOf(['67', '81', '82']);
    expect([...copy.refused]).toEqual([]);
    expect((clip.objects ?? []).map((o) => o.handle).sort()).toEqual(['70', '71', '72']);
    for (const o of clip.objects ?? []) {
      expect(o).not.toHaveProperty('reactors');
      expect(o).not.toHaveProperty('raw');
    }
  });

  it('refuses an image whose definition is missing', () => {
    const { copy, clip } = copyOf(['67', '83']);
    expect([...copy.refused]).toEqual([
      ['an image whose definition is missing cannot be pasted', 1],
    ]);
    expect(clip.entities.map((e) => e.handle)).toEqual(['67']);
  });

  it("files new definitions in the target's dictionaries, with handles above $HANDSEED", () => {
    const target = DocumentModel.create(withDictionaries());
    const { pasted } = paste(target, copyOf(['67', '81', '82']).clip);
    const images = definitions(target, 'IMAGEDEF');
    const pdfs = definitions(target, 'PDFDEFINITION');
    expect(images.map((d) => [d.name, d.owner, d.fileName]).sort()).toEqual([
      ['logo', 'E', 'logo.png'],
      ['site', 'E', '.\\photos\\site.png'],
    ]);
    expect(pdfs.map((d) => [d.name, d.owner, d.fileName])).toEqual([
      ['plan - 1', 'F', '..\\sheets\\plan.pdf'],
    ]);
    for (const d of [...images, ...pdfs]) {
      expect(compareHandles(d.handle, '200'), d.name).toBeGreaterThanOrEqual(0);
    }
    const site = images.find((d) => d.name === 'site')!;
    expect(of(pasted, 'IMAGE')[0]!.geom).toMatchObject({ definition: site.handle });
    expect(of(pasted, 'PDFUNDERLAY')[0]!.geom).toMatchObject({ definition: pdfs[0]!.handle });
    // The image in the pasted STAMP block shows the pasted logo.
    const stamp = byName(target.tables.blockRecords, 'STAMP')!;
    const logo = images.find((d) => d.name === 'logo')!;
    const [inner] = target.blockEntities(stamp.handle).map((id) => target.entity(id)!);
    expect(inner!.geom).toMatchObject({ kind: 'IMAGE', definition: logo.handle });
  });

  it('files them under one new dictionary handle each when the target has none', () => {
    const target = DocumentModel.create(targetInit());
    paste(target, copyOf(['67', '81', '82']).clip);
    const images = definitions(target, 'IMAGEDEF');
    const [pdf] = definitions(target, 'PDFDEFINITION');
    expect(images).toHaveLength(2);
    expect(images[0]!.owner).toBe(images[1]!.owner);
    expect(compareHandles(images[0]!.owner, '200')).toBeGreaterThanOrEqual(0);
    expect(compareHandles(pdf!.owner, '200')).toBeGreaterThanOrEqual(0);
    expect(pdf!.owner).not.toBe(images[0]!.owner);
    for (const o of [images[0]!.owner, pdf!.owner]) {
      expect(target.objects.has(o)).toBe(false);
      expect(target.entityByHandle(o)).toBeUndefined();
    }
    // Pasted again, the definitions the first paste filed are used, and their dictionary.
    paste(target, copyOf(['67']).clip);
    expect(definitions(target, 'IMAGEDEF')).toHaveLength(2);
  });

  it("uses the target's definition of the same name, whatever file it names", () => {
    const init = withDictionaries();
    const target = DocumentModel.create({
      ...init,
      objects: [...(init.objects ?? []), imageDef('90', 'E', 'SITE', 'C:\\other\\site.jpg')],
    });
    const { pasted } = paste(target, copyOf(['67']).clip);
    expect(definitions(target, 'IMAGEDEF').map((d) => d.handle)).toEqual(['90']);
    expect(of(pasted, 'IMAGE')[0]!.geom).toMatchObject({ definition: '90' });
  });

  it('pastes an underlay without a definition as it is', () => {
    const source = DocumentModel.create({
      ...imageSource(),
      entities: [entityInit('81', underlay(undefined, 5, 5))],
    });
    const clip = copyToClipboard(source, [source.entityByHandle('81')!.id], { x: 0, y: 0 });
    expect([...clip.refused]).toEqual([]);
    const target = DocumentModel.create(withDictionaries());
    const { pasted } = paste(target, clip.clipboard);
    expect(pasted[0]!.geom).not.toHaveProperty('definition');
    expect(definitions(target, 'PDFDEFINITION')).toEqual([]);
  });

  it('PASTEBLOCK brings the definitions its block shows', () => {
    const target = DocumentModel.create(withDictionaries());
    const b = new ChangeSetBuilder(target);
    const report = pasteAsBlock(b, target, copyOf(['67', '81']).clip, MODEL_SPACE, '11', {
      x: 0,
      y: 0,
    });
    target.apply(b.build());
    const block = (target.entity(report.ids[0]!)!.geom as { block: string }).block;
    const shown = target
      .blockEntities(block)
      .map((id) => (target.entity(id)!.geom as { definition?: string }).definition);
    const defs = [...definitions(target, 'IMAGEDEF'), ...definitions(target, 'PDFDEFINITION')];
    expect(shown.sort()).toEqual(defs.map((d) => d.handle).sort());
  });

  it('is undone by its inverse, definitions and all', () => {
    const target = DocumentModel.create(withDictionaries());
    const was = snapshot(target);
    const b = new ChangeSetBuilder(target);
    pasteObjects(b, target, copyOf(['67', '81', '82']).clip, MODEL_SPACE, { x: 0, y: 0 });
    const cs = b.build();
    target.apply(cs);
    expect(definitions(target, 'IMAGEDEF')).toHaveLength(2);
    target.apply(invertChangeSet(cs));
    expect(snapshot(target)).toEqual(was);
  });
});

describe('records, blocks and multileader attributes pasted into another drawing (M2-32 part 3)', () => {
  const ANNOTATIVE = '19';
  const GUID = '1A';
  const TAG = '44';
  /** A multileader with a TAG block holding the ATTDEFs NO and REV, and MYAPP xdata on records. */
  function sourceWithMore(): DocumentInit {
    const init = sourceInit();
    const t = init.tables!;
    const mine = (value: string) => ({ appId: '16', values: [{ code: 1000, value }] });
    const attdef = (handle: string, tag: string, y: number): EntityInit =>
      entityInit(
        handle,
        { ...text(0, y, '30', ''), kind: 'ATTDEF', tag, flags: 0, prompt: tag } as EntityGeometry,
        { owner: TAG },
      );
    return {
      ...init,
      tables: {
        ...t,
        appIds: [
          ...t.appIds!,
          record(ANNOTATIVE, 'AcadAnnotative'),
          record(GUID, 'AcDbDynamicBlockGUID'),
        ],
        layers: t.layers!.map((l) =>
          l.name === 'DASHED_L'
            ? {
                ...l,
                xdata: [mine('dash'), { appId: ANNOTATIVE, values: [{ code: 1070, value: 1 }] }],
              }
            : l,
        ),
        dimStyles: t.dimStyles!.map((s) => ({
          ...s,
          xdata: [{ appId: '16', values: [{ code: 1005, value: '15' }] }],
        })),
        blockRecords: [
          ...t.blockRecords!.map((r) =>
            r.name === 'ARROW'
              ? {
                  ...r,
                  xdata: [mine('arrow'), { appId: GUID, values: [{ code: 1000, value: 'g' }] }],
                }
              : r,
          ),
          blockRecord(TAG, 'TAG'),
        ],
      },
      blocks: [
        ...init.blocks!.map((d) => (d.name === 'ARROW' ? { ...d, xdata: [mine('block')] } : d)),
        { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
      ],
      entities: [
        ...init.entities!,
        attdef('56', 'NO', 0),
        attdef('57', 'REV', -3),
        entityInit('69', {
          kind: 'MULTILEADER',
          overrideFlags: 0,
          pathType: 1,
          lineColor: { kind: 'byBlock' },
          lineweight: 'ByBlock',
          landing: true,
          dogleg: true,
          doglegLength: 2.5,
          arrowheadSize: 3,
          contentType: 1,
          scale: 1,
          annotative: false,
          textLeftAttachment: 1,
          textRightAttachment: 1,
          textTopAttachment: 9,
          textBottomAttachment: 9,
          textAttachmentDirection: 0,
          textAngleType: 1,
          textAlignment: 0,
          textFrame: false,
          contentBase: { x: 12.5, y: 10 },
          landingGap: 0.5,
          block: {
            block: TAG,
            position: { x: 13, y: 10 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: 0,
            color: { kind: 'byBlock' },
            attributes: [
              { definition: '56', index: 0, width: 0, value: '7' },
              { definition: '57', index: 1, width: 0, value: 'B' },
            ],
          },
          branches: [],
        } as EntityGeometry),
      ],
    };
  }

  const copyMore = () => {
    const source = DocumentModel.create(sourceWithMore());
    const ids = [...COPIED, '69'].map((h) => source.entityByHandle(h)!.id);
    const copy = copyToClipboard(source, ids, { x: 0, y: 0 });
    return { copy, clip: structuredClone(copy.clipboard) as Clipboard };
  };

  it('keeps the xdata of the records it brings, under the target application handles', () => {
    const target = DocumentModel.create(targetInit());
    paste(target, copyMore().clip);
    const myapp = byName(target.tables.appIds, 'MYAPP')!.handle;
    // The annotative property is not pasted (M2-43), so its xdata stays behind as on objects.
    expect(byName(target.tables.layers, 'DASHED_L')!.xdata).toEqual([
      { appId: myapp, values: [{ code: 1000, value: 'dash' }] },
    ]);
    const dashed = byName(target.tables.linetypes, 'DASHED')!.handle;
    expect(byName(target.tables.dimStyles, 'MECH')!.xdata).toEqual([
      { appId: myapp, values: [{ code: 1005, value: dashed }] },
    ]);
  });

  it("keeps a block record's xdata, but not a dynamic block's", () => {
    const target = DocumentModel.create(targetInit());
    paste(target, copyMore().clip);
    const myapp = byName(target.tables.appIds, 'MYAPP')!.handle;
    const arrow = byName(target.tables.blockRecords, 'ARROW')!;
    // A dynamic block's applications describe the graph a paste does not bring (M2-32 part 4).
    expect(arrow.xdata).toEqual([{ appId: myapp, values: [{ code: 1000, value: 'arrow' }] }]);
    expect(byName(target.tables.appIds, 'AcDbDynamicBlockGUID')).toBeUndefined();
    // The BLOCK's own xdata is not read from a file (map blocks.ts), so none is pasted.
    expect(target.blocks.get(arrow.handle)!.xdata).toBeUndefined();
  });

  it('pastes a multileader whose block holds attribute definitions, naming the pasted ATTDEFs', () => {
    const { copy, clip } = copyMore();
    expect(copy.refused.size).toBe(0);
    const target = DocumentModel.create(targetInit());
    const { pasted } = paste(target, clip);
    const [ml] = of(pasted, 'MULTILEADER');
    const g = ml!.geom as unknown as {
      block: { block: string; attributes: { definition: string }[] };
    };
    const tag = byName(target.tables.blockRecords, 'TAG')!.handle;
    expect(g.block.block).toBe(tag);
    const defs = target.blockEntities(tag).map((id) => target.entity(id)!);
    const handleOf = (t: string) => defs.find((d) => (d.geom as { tag: string }).tag === t)!.handle;
    expect(g.block.attributes).toMatchObject([
      { definition: handleOf('NO'), value: '7' },
      { definition: handleOf('REV'), value: 'B' },
    ]);
    for (const a of g.block.attributes)
      expect(compareHandles(a.definition, '200')).toBeGreaterThan(0);
  });

  it("names the target's own ATTDEFs, by tag, where it has the block already", () => {
    const init = targetInit();
    const target = DocumentModel.create({
      ...init,
      tables: {
        ...init.tables,
        blockRecords: [...init.tables!.blockRecords!, blockRecord('27', 'tag')],
      },
      blocks: [...init.blocks!, { handle: '27', name: 'tag', basePoint: { x: 0, y: 0 } }],
      entities: [
        ...init.entities!,
        entityInit(
          '28',
          {
            ...text(0, 0, '30', ''),
            kind: 'ATTDEF',
            tag: 'no',
            flags: 0,
            prompt: 'No.',
          } as EntityGeometry,
          { owner: '27' },
        ),
      ],
    });
    const { pasted } = paste(target, copyMore().clip);
    const g = of(pasted, 'MULTILEADER')[0]!.geom as unknown as {
      block: { block: string; attributes: { definition?: string; value: string }[] };
    };
    expect(g.block.block).toBe('27');
    // The target's TAG has no REV: that value has no definition to belong to, so it goes.
    expect(g.block.attributes).toEqual([{ definition: '28', index: 0, width: 0, value: '7' }]);
    expect(target.blockEntities('27')).toHaveLength(1);
  });
});
