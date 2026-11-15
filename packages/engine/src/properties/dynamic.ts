// A dynamic block reference's custom properties, read-only (M2-35 part 29): the Properties
// palette's Custom section, as AutoCAD 2024 lists the parameters of a dynamic block whose "Show
// properties" is on (Distance, Angle, Visibility, Flip state, Lookup, Position X/Y). Triya does
// not evaluate dynamic blocks (PRD non-goal 2, FR-B3), so the values are shown, never edited: a
// reference's values are those AutoCAD saved with it, in its `AcDbBlockRepresentation` extension
// dictionary (`AppDataCache` → `ACAD_ENHANCEDBLOCKDATA`, one XRECORD per graph node by its id),
// and a reference AutoCAD saved none for shows the definition's own (its parameter's points).
//
// Both are held as `CodedObject`s (M2-32 part 4), the DXF group codes an AC1032 save writes. The
// parameters' codes follow the DXF reference's subclasses (AcDbBlockParameter 280 "Show
// properties"; AcDbBlock1PtParameter / AcDbBlock2PtParameter 1010 and 1011 the points; the
// label of each type's own subclass). A node's XRECORD is not documented: read from AutoCAD's
// saves in the corpus (`dynamic-blocks/*.dxf`), after the 280, two 1071s and two 70s (25, 104)
// it holds the parameter's points as 10/20/30 (two-point parameters: base, end, normal, then the
// base angle's point for an angle), a flip's state as a further 70, and a visibility state's or
// a lookup's value as DXF 1.
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import { dynamicBlockOf } from '../model/dynamic-block';
import type { Handle } from '../model/handle';
import { isCodedObject, type CodedObject, type DxfGroup, type Entity } from '../model/types';

/** One row of the Custom section. */
export interface DynamicProperty {
  /** `custom:<node id>`, with `:x`/`:y`/`:angle` for a parameter that shows more than one. */
  readonly key: string;
  /** The parameter's label, as the block's author named it ("Distance1", "Visibility1"). */
  readonly label: string;
  readonly kind: 'distance' | 'angle' | 'text';
  readonly value: number | string;
}

/** A graph node: its id (AcDbEvalExpr 90), type and codes. */
interface Node {
  readonly id: number;
  readonly dxfName: string;
  readonly codes: readonly DxfGroup[];
}

/** What a reference saved for one node: points, further 70s and strings, in order. */
interface Instance {
  readonly points: readonly Vec2[];
  readonly flags: readonly number[];
  readonly strings: readonly string[];
}

const GRAPH_KEY = 'ACAD_ENHANCEDBLOCK';
const REPRESENTATION_KEY = 'ACDBBLOCKREPRESENTATION';
const SUBCLASS = 100;
const XDATA = 1001;

/** The codes of subclass `name` (after its 100, up to the next 100 or the xdata). */
function subclass(codes: readonly DxfGroup[], name: string): readonly DxfGroup[] {
  const at = codes.findIndex((g) => g.code === SUBCLASS && g.value === name);
  if (at < 0) return [];
  const out: DxfGroup[] = [];
  for (const g of codes.slice(at + 1)) {
    if (g.code === SUBCLASS || g.code === XDATA) break;
    out.push(g);
  }
  return out;
}

const valueOf = (codes: readonly DxfGroup[], code: number): DxfGroup['value'] | undefined =>
  codes.find((g) => g.code === code)?.value;
const num = (v: DxfGroup['value'] | undefined): number =>
  typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0;
const str = (v: DxfGroup['value'] | undefined): string =>
  typeof v === 'string' ? v : v === undefined ? '' : String(v);
const point = (codes: readonly DxfGroup[], x: number): Vec2 => ({
  x: num(valueOf(codes, x)),
  y: num(valueOf(codes, x + 10)),
});

/** The coded objects of a dictionary's entries by key (DXF 3 then its 350/360). */
function entries(model: DocumentModel, dict: CodedObject | undefined): Map<string, CodedObject> {
  const out = new Map<string, CodedObject>();
  if (!dict) return out;
  let key: string | undefined;
  for (const { code, value } of dict.codes) {
    if (code === 3) key = str(value);
    else if ((code === 350 || code === 360) && key !== undefined) {
      const o = model.objects.get(str(value) as Handle);
      if (isCodedObject(o)) out.set(key.toUpperCase(), o);
      key = undefined;
    }
  }
  return out;
}

/** The top coded object under extension dictionary `xdict` by `key` (upper case). */
function keyed(model: DocumentModel, xdict: Handle | undefined, key: string) {
  if (xdict === undefined) return undefined;
  for (const o of model.objects.values()) {
    if (isCodedObject(o) && o.owner === xdict && o.key?.toUpperCase() === key) return o;
  }
  return undefined;
}

/** A dynamic block definition's parameter nodes, in the graph's order. */
function parameters(model: DocumentModel, definition: Handle): Node[] {
  const graph = keyed(model, model.tables.blockRecords.get(definition)?.extDict, GRAPH_KEY);
  if (!graph) return [];
  // The graph names its nodes by hard owner (360), in node order.
  const out: Node[] = [];
  for (const { code, value } of graph.codes) {
    if (code !== 360) continue;
    const o = model.objects.get(str(value) as Handle);
    if (!isCodedObject(o) || !/^BLOCK.*PARAMETER$/.test(o.dxfName)) continue;
    out.push({ id: num(valueOf(subclass(o.codes, 'AcDbEvalExpr'), 90)), ...o });
  }
  return out;
}

/** What reference `e` saved for its nodes, by node id. */
function instances(model: DocumentModel, e: Entity): Map<number, Instance> {
  const out = new Map<number, Instance>();
  const representation = keyed(model, e.extDict, REPRESENTATION_KEY);
  const cache = entries(model, representation).get('APPDATACACHE');
  const data = entries(model, entries(model, cache).get('ACAD_ENHANCEDBLOCKDATA'));
  for (const [id, record] of data) {
    const codes = subclass(record.codes, 'AcDbXrecord');
    const points: Vec2[] = [];
    const flags: number[] = [];
    const strings: string[] = [];
    let seventies = 0;
    for (let i = 0; i < codes.length; i++) {
      const g = codes[i]!;
      if (g.code === 10) points.push({ x: num(g.value), y: num(codes[i + 1]?.value) });
      // The first two 70s (25, 104) are the record's own header.
      else if (g.code === 70 && seventies++ >= 2) flags.push(num(g.value));
      else if (g.code === 1) strings.push(str(g.value));
    }
    out.set(Number(id), { points, flags, strings });
  }
  return out;
}

const angleOf = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);
const TAU = 2 * Math.PI;
const normal = (a: number): number => {
  const r = a % TAU;
  return Math.abs(r) < 1e-12 ? 0 : r < 0 ? r + TAU : r;
};
const length = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** One parameter's rows, from what the reference saved or else the definition. */
function rows(node: Node, saved: Instance | undefined): DynamicProperty[] {
  const key = `custom:${node.id}`;
  const two = subclass(node.codes, 'AcDbBlock2PtParameter');
  // A reference's own points, else the definition's (1010 base, 1011 end).
  const base = saved?.points[0] ?? point(two, 1010);
  const end = saved?.points[1] ?? point(two, 1011);
  const distance = (label: string): DynamicProperty => ({
    key,
    label,
    kind: 'distance',
    value: length(base, end),
  });
  switch (node.dxfName) {
    case 'BLOCKLINEARPARAMETER':
      return [distance(str(valueOf(subclass(node.codes, 'AcDbBlockLinearParameter'), 305)))];
    case 'BLOCKPOLARPARAMETER': {
      const own = subclass(node.codes, 'AcDbBlockPolarParameter');
      // The saved base angle's point (the fourth); a definition's angle is from world +X.
      const zero = saved?.points[3];
      const angle = angleOf(base, end) - (zero ? angleOf(base, zero) : 0);
      return [
        distance(str(valueOf(own, 305))),
        { key: `${key}:angle`, label: str(valueOf(own, 307)), kind: 'angle', value: normal(angle) },
      ];
    }
    case 'BLOCKXYPARAMETER': {
      // 306 labels the horizontal distance, 305 the vertical (as AutoCAD names them by
      // default: "X Distance1" and "Y Distance1"); both signed, end minus base.
      const own = subclass(node.codes, 'AcDbBlockXYParameter');
      return [
        { key: `${key}:x`, label: str(valueOf(own, 306)), kind: 'distance', value: end.x - base.x },
        { key: `${key}:y`, label: str(valueOf(own, 305)), kind: 'distance', value: end.y - base.y },
      ];
    }
    case 'BLOCKROTATIONPARAMETER': {
      // The angle from the base angle's line (the definition's AcDbBlockRotationParameter 1011,
      // or the reference's fourth point) to the parameter's, counter-clockwise. AutoCAD's Help
      // does not say what the Angle is measured from; with the base angle at 0 (every sample)
      // both readings agree.
      const own = subclass(node.codes, 'AcDbBlockRotationParameter');
      const zero = saved?.points[3] ?? point(own, 1011);
      return [
        {
          key,
          label: str(valueOf(own, 305)),
          kind: 'angle',
          value: normal(angleOf(base, end) - angleOf(base, zero)),
        },
      ];
    }
    case 'BLOCKFLIPPARAMETER': {
      const own = subclass(node.codes, 'AcDbBlockFlipParameter');
      const flipped = (saved?.flags.at(-1) ?? 0) !== 0;
      return [
        {
          key,
          label: str(valueOf(own, 305)),
          kind: 'text',
          value: str(valueOf(own, flipped ? 308 : 307)),
        },
      ];
    }
    case 'BLOCKVISIBILITYPARAMETER': {
      const own = subclass(node.codes, 'AcDbBlockVisibilityParameter');
      // A reference AutoCAD saved no state for shows the first state.
      const state = saved?.strings[0] ?? str(valueOf(own, 303));
      return [{ key, label: str(valueOf(own, 301)), kind: 'text', value: state }];
    }
    case 'BLOCKLOOKUPPARAMETER': {
      const own = subclass(node.codes, 'AcDbBlockLookUpParameter');
      return [{ key, label: str(valueOf(own, 303)), kind: 'text', value: saved?.strings[0] ?? '' }];
    }
    case 'BLOCKPOINTPARAMETER': {
      const label = str(valueOf(subclass(node.codes, 'AcDbBlockPointParameter'), 303));
      const at = saved?.points[0] ?? point(subclass(node.codes, 'AcDbBlock1PtParameter'), 1010);
      return [
        { key: `${key}:x`, label: `${label} X`, kind: 'distance', value: at.x },
        { key: `${key}:y`, label: `${label} Y`, kind: 'distance', value: at.y },
      ];
    }
    default:
      // Base point and alignment parameters have no property AutoCAD lists.
      return [];
  }
}

/**
 * The custom properties of dynamic block reference `e`, as the Properties palette's Custom
 * section lists them; empty for a static block's reference, or a dynamic block whose evaluation
 * graph Triya does not hold.
 */
export function dynamicProperties(model: DocumentModel, e: Entity): DynamicProperty[] {
  if (e.geom.kind !== 'INSERT') return [];
  const definition = dynamicBlockOf(model.blocks, e.geom.block);
  if (!definition) return [];
  const saved = instances(model, e);
  return parameters(model, definition.handle)
    .filter((n) => num(valueOf(subclass(n.codes, 'AcDbBlockParameter'), 280)) !== 0)
    .flatMap((n) => rows(n, saved.get(n.id)));
}
