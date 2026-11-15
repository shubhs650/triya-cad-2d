// FILTER's selection filters (M3-04 part 4), as AutoCAD 2024's Object Selection Filters dialog
// builds them (AutoCAD Help, "FILTER (Command)", "Object Selection Filters Dialog Box"):
//   - a filter is a list of properties an object must have, all of them, unless logical
//     operators group them: **Begin AND … **End AND (one or more operands), OR (one or more),
//     XOR (two) and NOT (one), paired and balanced;
//   - names (Layer, Linetype, Block Name, styles, Text Value) are = or != and may be wildcards;
//     numbers and each of a point's X, Y and Z take =, !=, <, <=, >, >= or * (any value);
//   - Add Selected Object adds the properties of one object.
// Help does not say whether "Circle Radius" alone also takes another type's DXF group 40 (an
// ellipse's ratio, a text's height), as the filter list AutoCAD hands ssget would: Triya takes
// a geometric property to hold only for its own type ("Circle Radius" only for circles), the
// common drafter's reading. Numbers equal when they differ by no more than 1e-10 of the larger,
// as SELECTSIMILAR compares scales.
import { blockNameOf, wcmatch } from '../commands/modify/attributes';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity, EntityType, PlanarProps } from '../model/types';
import { typeLabel } from '../properties/sheet';

export type FilterOperator = '=' | '!=' | '<' | '<=' | '>' | '>=' | '*';
export type FilterLogic = 'AND' | 'OR' | 'XOR' | 'NOT';

export const NAME_KEYS = [
  'Layer',
  'Linetype',
  'Block Name',
  'Text Style',
  'Dimension Style',
  'Text Value',
] as const;
export const NUMBER_KEYS = [
  'Color',
  'Lineweight',
  'Linetype Scale',
  'Thickness',
  'Elevation',
  'Arc Radius',
  'Circle Radius',
  'Text Height',
  'Text Rotation',
] as const;
export const POINT_KEYS = [
  'Arc Center',
  'Block Position',
  'Circle Center',
  'Line End',
  'Line Start',
  'Point Position',
  'Text Position',
] as const;

export type FilterNameKey = (typeof NAME_KEYS)[number];
export type FilterNumberKey = (typeof NUMBER_KEYS)[number];
export type FilterPointKey = (typeof POINT_KEYS)[number];

export interface FilterTest {
  readonly op: FilterOperator;
  readonly value: number;
}

/** One line of the filter list. */
export type FilterItem =
  | { readonly key: 'Begin' | 'End'; readonly logic: FilterLogic }
  | { readonly key: 'Object'; readonly op: '=' | '!='; readonly value: EntityType }
  | { readonly key: FilterNameKey; readonly op: '=' | '!='; readonly value: string }
  | { readonly key: FilterNumberKey; readonly op: FilterOperator; readonly value: number }
  | {
      readonly key: FilterPointKey;
      readonly x?: FilterTest;
      readonly y?: FilterTest;
      readonly z?: FilterTest;
    };

/** "Names can contain up to 18 characters" (Save As). */
export const FILTER_NAME_MAX = 18;

const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b), 1);

function compare(op: FilterOperator, a: number, b: number): boolean {
  switch (op) {
    case '*':
      return true;
    case '=':
      return close(a, b);
    case '!=':
      return !close(a, b);
    case '<':
      return a < b && !close(a, b);
    case '<=':
      return a < b || close(a, b);
    case '>':
      return a > b && !close(a, b);
    case '>=':
      return a > b || close(a, b);
  }
}

const planar = (e: Entity): PlanarProps => e.geom as PlanarProps;
const geom = (e: Entity) => e.geom as unknown as Record<string, unknown>;
const isText = (e: Entity) => e.type === 'TEXT' || e.type === 'MTEXT';

/** DXF 62: 0 ByBlock, 256 ByLayer, else the ACI index; a true colour has none. */
function aciOf(e: Entity): number | undefined {
  const c = e.color;
  if (c.kind === 'byLayer') return 256;
  if (c.kind === 'byBlock') return 0;
  return c.kind === 'aci' ? c.index : undefined;
}

/** DXF 370: hundredths of a millimetre, −1 ByLayer, −2 ByBlock, −3 Default. */
function lineweightOf(e: Entity): number {
  const w = e.lineweight;
  return w === 'ByLayer' ? -1 : w === 'ByBlock' ? -2 : w === 'Default' ? -3 : w;
}

function nameOf(model: DocumentModel, e: Entity, key: FilterNameKey): string | undefined {
  const t = model.tables;
  const style = geom(e)['style'] as Handle | undefined;
  switch (key) {
    case 'Layer':
      return t.layers.get(e.layer)?.name;
    case 'Linetype':
      return e.linetype === 'ByLayer' || e.linetype === 'ByBlock'
        ? e.linetype
        : t.linetypes.get(e.linetype)?.name;
    case 'Block Name':
      return e.geom.kind === 'INSERT' ? blockNameOf(model, e.geom.block) : undefined;
    case 'Text Style':
      return isText(e) && style ? t.textStyles.get(style)?.name : undefined;
    case 'Dimension Style':
      return e.type.includes('DIMENSION') && style ? t.dimStyles.get(style)?.name : undefined;
    case 'Text Value':
      return e.geom.kind === 'TEXT'
        ? e.geom.value
        : e.geom.kind === 'MTEXT'
          ? e.geom.contents
          : undefined;
  }
}

function numberOf(e: Entity, key: FilterNumberKey): number | undefined {
  const g = geom(e);
  switch (key) {
    case 'Color':
      return aciOf(e);
    case 'Lineweight':
      return lineweightOf(e);
    case 'Linetype Scale':
      return e.ltScale;
    case 'Thickness':
      return planar(e).thickness ?? 0;
    case 'Elevation':
      return planar(e).elevation ?? 0;
    case 'Arc Radius':
      return e.type === 'ARC' ? (g['radius'] as number) : undefined;
    case 'Circle Radius':
      return e.type === 'CIRCLE' ? (g['radius'] as number) : undefined;
    case 'Text Height':
      return isText(e) ? (g['height'] as number) : undefined;
    // Degrees, as the dialog shows a rotation.
    case 'Text Rotation':
      return isText(e) ? ((g['rotation'] as number) * 180) / Math.PI : undefined;
  }
}

const POINT_FIELDS: Record<FilterPointKey, readonly [EntityType[], string]> = {
  'Arc Center': [['ARC'], 'center'],
  'Block Position': [['INSERT'], 'position'],
  'Circle Center': [['CIRCLE'], 'center'],
  'Line End': [['LINE'], 'end'],
  'Line Start': [['LINE'], 'start'],
  'Point Position': [['POINT'], 'position'],
  'Text Position': [['TEXT', 'MTEXT'], 'position'],
};

function pointOf(e: Entity, key: FilterPointKey): { x: number; y: number; z: number } | undefined {
  const [types, field] = POINT_FIELDS[key];
  if (!types.includes(e.type)) return undefined;
  const p = geom(e)[field] as Vec2;
  return { x: p.x, y: p.y, z: planar(e).elevation ?? 0 };
}

type PropertyItem = Exclude<FilterItem, { key: 'Begin' | 'End' }>;

/** Whether one property line holds for `e`. */
function holds(model: DocumentModel, e: Entity, item: PropertyItem): boolean {
  if (item.key === 'Object') return (e.type === item.value) === (item.op === '=');
  if ((NAME_KEYS as readonly string[]).includes(item.key)) {
    const i = item as { key: FilterNameKey; op: '=' | '!='; value: string };
    const name = nameOf(model, e, i.key);
    if (name === undefined) return false;
    return wcmatch(name, i.value) === (i.op === '=');
  }
  if ((NUMBER_KEYS as readonly string[]).includes(item.key)) {
    const i = item as { key: FilterNumberKey; op: FilterOperator; value: number };
    const v = numberOf(e, i.key);
    return v !== undefined && compare(i.op, v, i.value);
  }
  const i = item as { key: FilterPointKey; x?: FilterTest; y?: FilterTest; z?: FilterTest };
  const p = pointOf(e, i.key);
  if (!p) return false;
  return (['x', 'y', 'z'] as const).every((c) => {
    const t = i[c];
    return !t || compare(t.op, p[c], t.value);
  });
}

type Node =
  | { readonly item: PropertyItem }
  | { readonly logic: FilterLogic; readonly operands: readonly Node[] };

const OPERANDS: Record<FilterLogic, string> = {
  AND: 'one or more operands',
  OR: 'one or more operands',
  XOR: 'two operands',
  NOT: 'one operand',
};

/** The list as a tree; a string says why it cannot be applied. */
function parse(list: readonly FilterItem[]): Node[] | string {
  const stack: { logic: FilterLogic | undefined; operands: Node[] }[] = [
    { logic: undefined, operands: [] },
  ];
  for (const item of list) {
    if (item.key === 'Begin') stack.push({ logic: item.logic, operands: [] });
    else if (item.key === 'End') {
      const top = stack.pop()!;
      if (top.logic !== item.logic) return `**End ${item.logic} has no **Begin ${item.logic}.`;
      const n = top.operands.length;
      const ok = item.logic === 'XOR' ? n === 2 : item.logic === 'NOT' ? n === 1 : n >= 1;
      if (!ok) return `**Begin ${item.logic} encloses ${OPERANDS[item.logic]}.`;
      stack.at(-1)!.operands.push({ logic: item.logic, operands: top.operands });
    } else stack.at(-1)!.operands.push({ item: item as PropertyItem });
  }
  const open = stack.at(-1)!.logic;
  if (open) return `**Begin ${open} has no **End ${open}.`;
  return stack[0]!.operands;
}

/** Why the list cannot be applied (its operators unpaired or unbalanced), or undefined. */
export function filterProblem(list: readonly FilterItem[]): string | undefined {
  const tree = parse(list);
  return typeof tree === 'string' ? tree : undefined;
}

function evaluate(model: DocumentModel, e: Entity, n: Node): boolean {
  if ('item' in n) return holds(model, e, n.item);
  const values = n.operands.map((o) => evaluate(model, e, o));
  switch (n.logic) {
    case 'AND':
      return values.every(Boolean);
    case 'OR':
      return values.some(Boolean);
    case 'XOR':
      return values[0] !== values[1];
    case 'NOT':
      return !values[0];
  }
}

/** The objects of `ids` the filter takes, in order; none when the list is unbalanced. */
export function applyFilter(
  model: DocumentModel,
  ids: readonly EntityId[],
  list: readonly FilterItem[],
): EntityId[] {
  const tree = parse(list);
  if (typeof tree === 'string') return [];
  return ids.filter((id) => {
    const e = model.entity(id);
    return e !== undefined && tree.every((n) => evaluate(model, e, n));
  });
}

/**
 * Add Selected Object: the object's type, layer, any colour, linetype or thickness of its own
 * (AutoCAD's DXF entry leaves ByLayer and 0 out), and its type's geometry, each "=".
 */
export function objectFilter(model: DocumentModel, e: Entity): FilterItem[] {
  const out: FilterItem[] = [{ key: 'Object', op: '=', value: e.type }];
  const name = (key: FilterNameKey) => {
    const v = nameOf(model, e, key);
    if (v !== undefined) out.push({ key, op: '=', value: v });
  };
  const num = (key: FilterNumberKey) => {
    const v = numberOf(e, key);
    if (v !== undefined) out.push({ key, op: '=', value: v });
  };
  name('Layer');
  if (e.color.kind !== 'byLayer') num('Color');
  if (e.linetype !== 'ByLayer') name('Linetype');
  if ((planar(e).thickness ?? 0) !== 0) num('Thickness');
  for (const key of POINT_KEYS) {
    const p = pointOf(e, key);
    if (p) {
      out.push({
        key,
        x: { op: '=', value: p.x },
        y: { op: '=', value: p.y },
        z: { op: '=', value: p.z },
      });
    }
  }
  for (const key of ['Arc Radius', 'Circle Radius', 'Text Height', 'Text Rotation'] as const) {
    num(key);
  }
  for (const key of ['Block Name', 'Text Style', 'Dimension Style', 'Text Value'] as const) {
    name(key);
  }
  return out;
}

const fixed = (v: number) => v.toFixed(4);

/** A line of the filter list as the dialog shows it ("Circle Radius >= 1.0000"). */
export function filterLine(item: FilterItem): string {
  if (item.key === 'Begin' || item.key === 'End') return `**${item.key} ${item.logic}`;
  if (item.key === 'Object') return `Object = ${typeLabel(item.value)}`.replace('=', item.op);
  if ((NAME_KEYS as readonly string[]).includes(item.key)) {
    const i = item as { key: string; op: string; value: string };
    return `${i.key} ${i.op} ${i.value}`;
  }
  if ((NUMBER_KEYS as readonly string[]).includes(item.key)) {
    const i = item as { key: FilterNumberKey; op: FilterOperator; value: number };
    const v = i.key === 'Color' || i.key === 'Lineweight' ? String(i.value) : fixed(i.value);
    return `${i.key} ${i.op} ${i.op === '*' ? '' : v}`.trimEnd();
  }
  const i = item as { key: string; x?: FilterTest; y?: FilterTest; z?: FilterTest };
  const parts = (['x', 'y', 'z'] as const).flatMap((c) => {
    const t = i[c];
    return t ? [`${c.toUpperCase()} ${t.op} ${t.op === '*' ? '' : fixed(t.value)}`.trimEnd()] : [];
  });
  return `${i.key} ${parts.join(' ')}`;
}

/** The names the Select Filter's value list offers for each name property, from the drawing. */
export function filterNames(model: DocumentModel): Record<FilterNameKey, string[]> {
  const t = model.tables;
  const names = (m: ReadonlyMap<Handle, { readonly name: string }>) =>
    [...m.values()].map((r) => r.name).filter((n) => n !== '');
  const blocks = [...model.blocks.values()].map((b) => b.name).filter((n) => !n.startsWith('*'));
  return {
    Layer: names(t.layers),
    Linetype: [
      'ByLayer',
      'ByBlock',
      ...names(t.linetypes).filter((n) => !/^by(layer|block)$/i.test(n)),
    ],
    'Block Name': blocks,
    'Text Style': names(t.textStyles),
    'Dimension Style': names(t.dimStyles),
    'Text Value': [],
  };
}

/** The object types the Select Filter list offers, by AutoCAD's names. */
export function filterTypes(
  model: DocumentModel,
  space: Handle,
): { type: EntityType; label: string }[] {
  const seen = new Set<EntityType>([
    'LINE',
    'CIRCLE',
    'ARC',
    'LWPOLYLINE',
    'TEXT',
    'MTEXT',
    'INSERT',
    'POINT',
  ]);
  if (model.hasBlock(space)) {
    for (const id of model.blockEntities(space)) {
      const e = model.entity(id);
      if (e) seen.add(e.type);
    }
  }
  return [...seen]
    .map((type) => ({ type, label: typeLabel(type) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
