import {
  DocumentModel,
  type Entity,
  type EntityInit,
  type EntityGeometry,
  type HeaderValue,
  type BlockTableRecord,
  type LayerRecord,
  type LinetypeRecord,
  type SymbolTableRecord,
} from '../../src/model/index';

export const MODEL_SPACE = '1F';
export const PAPER_SPACE = '1B';
export const LAYER_0 = '10';
export const LAYER_WALLS = '11';

export const layer = (handle: string, name: string): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
});

export const record = (handle: string, name: string): SymbolTableRecord => ({ handle, name });

export const linetype = (handle: string, name: string): LinetypeRecord => ({
  handle,
  name,
  description: 'Solid line',
  alignment: 'A',
  patternLength: 0,
  elements: [],
});

export const blockRecord = (handle: string, name: string): BlockTableRecord => ({
  handle,
  name,
  units: 0,
  explodable: true,
  scalable: true,
});

export function entityInit(
  handle: string,
  geom: EntityGeometry,
  extra: Partial<EntityInit> = {},
): EntityInit {
  return {
    handle,
    owner: MODEL_SPACE,
    type: geom.kind,
    layer: LAYER_0,
    color: { kind: 'byLayer' },
    linetype: 'ByLayer',
    lineweight: 'ByLayer',
    transparency: 'ByLayer',
    ltScale: 1,
    visible: true,
    geom,
    ...extra,
  };
}

export const lineGeom = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

export const circleGeom = (x: number, y: number, r: number): EntityGeometry => ({
  kind: 'CIRCLE',
  center: { x, y },
  radius: r,
});

/** A small drawing: two layers, model and paper space, three model-space entities, one in paper space. */
export function sampleModel(): DocumentModel {
  return DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '40',
    header: new Map<string, HeaderValue>([
      ['$LTSCALE', 1],
      ['$CLAYER', 'WALLS'],
      ['$EXTMIN', { x: 0, y: 0, z: 0 }],
    ]),
    tables: {
      layers: [layer(LAYER_0, '0'), layer(LAYER_WALLS, 'WALLS')],
      linetypes: [linetype('14', 'Continuous')],
      blockRecords: [
        blockRecord(MODEL_SPACE, '*Model_Space'),
        blockRecord(PAPER_SPACE, '*Paper_Space'),
      ],
    },
    blocks: [
      { handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PAPER_SPACE, name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      { handle: '1E', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE },
    ],
    objects: [{ handle: 'C', type: 'DICTIONARY', owner: '0' }],
    passthrough: ['3A'],
    entities: [
      entityInit('20', lineGeom(0, 0, 10, 0)),
      entityInit('21', circleGeom(5, 5, 2), { layer: LAYER_WALLS }),
      entityInit('23', lineGeom(0, 0, 0, 10)),
      entityInit('24', lineGeom(1, 1, 2, 2), { owner: PAPER_SPACE }),
    ],
  });
}

/** A comparable, reference-free snapshot of everything a ChangeSet can touch. */
export function snapshot(model: DocumentModel): unknown {
  const blocks = [...model.blocks.keys()].map((h) => [
    h,
    model.blockEntities(h).map((id) => model.entity(id)),
  ]);
  // Keyed collections are compared sorted: their iteration order carries no meaning (export
  // goes by handle), only block entity order does.
  const byKey = <T>(entries: Iterable<[string, T]>): [string, T][] =>
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const tables = Object.fromEntries(
    Object.entries(model.tables).map(([k, m]) => [k, byKey(m.entries())]),
  );
  return {
    blocks,
    tables,
    header: byKey(model.header.entries()),
    objects: byKey(model.objects.entries()),
    count: model.entityCount,
  };
}

export function entityAt(model: DocumentModel, owner: string, index: number): Entity {
  const id = model.blockEntities(owner)[index];
  if (id === undefined) throw new Error(`no entity at ${owner}[${index}]`);
  return model.entity(id)!;
}
