// What the surface finish and standard notes tests share (M8-02 part 3): a small drawing to add
// to, and one line per part, to four decimals, for the snapshots.
import {
  DocumentModel,
  type DocumentInit,
  type EntityGeometry,
  type PolylineVertex,
} from '@triya/engine';
import type { LibraryPart } from '../src/index';

export const STYLE = '11';
export const NOTES_STYLE = '12';
export const MODEL_SPACE = '1F';

const f = (v: number) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const pt = (p: { x: number; y: number }) => `(${f(p.x)}, ${f(p.y)})`;
const vertex = (v: PolylineVertex) => (v.bulge === 0 ? pt(v) : `${pt(v)} b${f(v.bulge)}`);

export function geomText(g: EntityGeometry): string {
  switch (g.kind) {
    case 'LINE':
      return `LINE ${pt(g.start)} ${pt(g.end)}`;
    case 'CIRCLE':
      return `CIRCLE ${pt(g.center)} r${f(g.radius)}`;
    case 'LWPOLYLINE':
      return `LWPOLYLINE ${g.closed ? 'closed' : 'open'} ${g.vertices.map(vertex).join(' ')}`;
    case 'TEXT':
      return `TEXT "${g.value}" ${pt(g.alignmentPoint ?? g.position)} h${f(g.height)} j${g.halign}${g.valign}`;
    default:
      return g.kind;
  }
}

export const partsText = (parts: readonly LibraryPart[]) =>
  parts.map((p) => `${p.role.padEnd(7)} ${geomText(p.geom)}`).join('\n');

/**
 * A drawing in `insUnits` (4 millimetres) with layers 0 and NOTES (current when `clayer`), a
 * Standard text style and a Notes one (current when `textStyle` names it).
 */
export function drawing(
  options: {
    insUnits?: number;
    measurement?: 'metric' | 'imperial';
    header?: [string, unknown][];
  } = {},
): DocumentModel {
  const init: DocumentInit = {
    meta: {
      sourceVersion: 'AC1032',
      codePage: 'ANSI_1252',
      insUnits: options.insUnits ?? 4,
      measurement: options.measurement ?? 'metric',
    },
    handSeed: '40',
    header: new Map(options.header ?? []),
    tables: {
      layers: [
        {
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
        },
        {
          handle: '13',
          name: 'NOTES',
          color: { kind: 'aci', index: 2 },
          linetype: '14',
          lineweight: 'Default',
          transparency: { alpha: 255 },
          plot: true,
          on: true,
          frozen: false,
          locked: false,
        },
      ],
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
      textStyles: [
        {
          handle: STYLE,
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
        {
          handle: NOTES_STYLE,
          name: 'Notes',
          font: 'romans',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      blockRecords: [
        { handle: MODEL_SPACE, name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    objects: [],
    passthrough: [],
    entities: [],
  };
  return DocumentModel.create(init);
}
