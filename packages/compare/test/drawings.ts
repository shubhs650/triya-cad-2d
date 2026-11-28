// Hand-made drawings for the compare tests (M8-05, M8-06): a model space, one paper space with
// the layouts named, layers 0 and Walls, and entity builders.
import {
  DocumentModel,
  type BlockDefinition,
  type DocumentInit,
  type EntityGeometry,
  type EntityInit,
  type LayerRecord,
} from '@triya/engine';

export const MODEL = '1F';
export const PAPER = '1E';
export const LAYER0 = '10';
export const WALLS = '11';

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

export interface Drawing {
  readonly entities: readonly EntityInit[];
  /** Block definitions beyond the two spaces, with their entities in `entities`. */
  readonly blocks?: readonly BlockDefinition[];
  /** Layer handles, to build a drawing whose tables are numbered differently. */
  readonly layers?: { readonly zero: string; readonly walls: string };
  readonly layouts?: readonly string[];
}

export function drawing(d: Drawing): DocumentModel {
  const layers = d.layers ?? { zero: LAYER0, walls: WALLS };
  const blocks = d.blocks ?? [];
  const layouts = d.layouts ?? ['Layout1'];
  const init: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252' },
    handSeed: '9000',
    header: new Map(),
    tables: {
      layers: [layer(layers.zero, '0'), layer(layers.walls, 'Walls')],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      blockRecords: [
        { handle: MODEL, name: '*Model_Space', units: 0, explodable: true, scalable: true },
        { handle: PAPER, name: '*Paper_Space', units: 0, explodable: true, scalable: true },
        ...blocks.map((b) => ({
          handle: b.handle,
          name: b.name,
          units: 0,
          explodable: true,
          scalable: true,
        })),
      ],
    },
    blocks: [
      { handle: MODEL, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PAPER, name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
      ...blocks,
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL },
      ...layouts.map((name, i) => ({
        handle: (0x23 + i).toString(16).toUpperCase(),
        name,
        tabOrder: i + 1,
        blockRecord: PAPER,
      })),
    ],
    objects: [],
    passthrough: [],
    entities: d.entities.map((e) =>
      e.layer === LAYER0
        ? { ...e, layer: layers.zero }
        : e.layer === WALLS
          ? { ...e, layer: layers.walls }
          : e,
    ),
  };
  return DocumentModel.create(init);
}

export const ent = (
  handle: string,
  geom: EntityGeometry,
  more: Partial<EntityInit> = {},
): EntityInit => ({
  handle,
  owner: MODEL,
  type: geom.kind,
  geom,
  layer: LAYER0,
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...more,
});

export const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});
export const circle = (x: number, y: number, radius: number): EntityGeometry => ({
  kind: 'CIRCLE',
  center: { x, y },
  radius,
});
export const arc = (startAngle: number, endAngle: number): EntityGeometry => ({
  kind: 'ARC',
  center: { x: 5, y: 5 },
  radius: 2,
  startAngle,
  endAngle,
});
export const text = (value: string): EntityGeometry => ({
  kind: 'TEXT',
  style: '9',
  position: { x: 1, y: 1 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  value,
});
export const insert = (block: string, x = 0): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});
