// Quick Select (QSELECT, M3-04 part 2): a selection set made from the objects' properties, as
// AutoCAD 2024's Quick Select dialog makes it (AutoCAD Help, "Quick Select Dialog Box"):
//   - Apply To: the entire drawing (the space shown, as ALL takes it) or the current selection;
//     with Append to Current Selection Set it is always the entire drawing;
//   - Object Type: one type, or Multiple for every type; Properties: the type's, as the
//     Properties palette lists them (Multiple: the General ones);
//   - Operator: Equals, Not Equal To, Greater Than, Less Than, *Wildcard Match ("available only
//     for text fields that can be edited"), or Select All, which ignores the property;
//   - How to Apply: Include (the objects that match) or Exclude (the objects that do not);
//   - Append: added to the current selection rather than replacing it.
// The values are the Properties palette's (`propertySheet`), so a property means here what it
// means there. Help does not say how near a number must be to equal: Triya takes a value equal
// when it shows the same at the drawing's precision (LUPREC, AUPREC), as the drafter reads it.
import { parseAngleValue, parseDistance, parseNumber } from '../commands/parse';
import { wcmatch } from '../commands/modify/attributes';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { EntityType } from '../model/types';
import {
  propertySheet,
  propertyUnits,
  typeLabel,
  type PropertyKind,
  type PropertyOption,
  type PropertyRow,
  type PropertyUnits,
} from '../properties/sheet';
import { selectAll } from './rules';

/** Equals, Not Equal To, Greater Than, Less Than, *Wildcard Match, Select All. */
export type QuickSelectOperator = '=' | '<>' | '>' | '<' | '*' | 'all';

/** Every object type (Quick Select's "Multiple"). */
export const MULTIPLE = 'MULTIPLE';

/** What the dialog closed with. */
export interface QuickSelectCriteria {
  readonly applyTo: 'drawing' | 'selection';
  readonly type: EntityType | typeof MULTIPLE;
  /** The property (a Properties palette row's key). */
  readonly key: string;
  readonly operator: QuickSelectOperator;
  /** A choice's option value, or the text typed, read in the drawing's units. */
  readonly value: string;
  /** Include in the new selection set; false: Exclude from it. */
  readonly include: boolean;
  readonly append: boolean;
}

/** A property the Properties list offers, and the Value list a choice offers. */
export interface QuickSelectRow {
  readonly key: string;
  readonly label: string;
  readonly kind: PropertyKind;
  readonly options?: readonly PropertyOption[];
  /** Not typed into (Wildcard Match is for text that can be edited). */
  readonly readOnly?: true;
}

/** An entry of the Object type list. */
export interface QuickSelectType {
  readonly type: EntityType | typeof MULTIPLE;
  readonly label: string;
  readonly rows: readonly QuickSelectRow[];
}

/** The dialog's contents. */
export interface QuickSelectOptions {
  /** The types in the drawing (the space shown), Multiple first. */
  readonly drawing: readonly QuickSelectType[];
  /** The types in the current selection; empty when nothing is selected. */
  readonly selection: readonly QuickSelectType[];
  readonly units: PropertyUnits;
}

export const DEFAULT_QSELECT: QuickSelectCriteria = {
  applyTo: 'drawing',
  type: MULTIPLE,
  key: 'color',
  operator: '=',
  value: 'ByLayer',
  include: true,
  append: false,
};

/** The candidates a criteria applies to: the selection, or the space as ALL takes it. */
export function quickSelectCandidates(
  model: DocumentModel,
  space: Handle,
  selected: readonly EntityId[],
  c: Pick<QuickSelectCriteria, 'applyTo' | 'append'>,
): EntityId[] {
  return c.applyTo === 'selection' && !c.append ? [...selected] : selectAll(model, space);
}

/** The Object type list for `ids`: Multiple and each type, by AutoCAD's names, sorted. */
export function quickSelectTypes(
  model: DocumentModel,
  ids: readonly EntityId[],
): QuickSelectType[] {
  if (ids.length === 0) return [];
  const byType = new Map<EntityType, EntityId[]>();
  for (const id of ids) {
    const e = model.entity(id);
    if (e) byType.set(e.type, [...(byType.get(e.type) ?? []), id]);
  }
  const general = propertySheet(model, ids).sections.find((s) => s.title === 'General');
  const types = [...byType]
    .map(([type, of]) => ({
      type,
      label: typeLabel(type),
      rows: propertySheet(model, of, type).sections.flatMap((s) => s.rows.map(listed)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ type: MULTIPLE, label: 'Multiple', rows: (general?.rows ?? []).map(listed) }, ...types];
}

function listed(r: PropertyRow): QuickSelectRow {
  return {
    key: r.key,
    label: r.label,
    kind: r.kind,
    ...(r.options && { options: r.options }),
    ...(r.readOnly && { readOnly: true as const }),
  };
}

/** Whether a row's values are numbers, which Greater Than and Less Than compare. */
function numeric(kind: PropertyKind): boolean {
  return kind === 'distance' || kind === 'angle' || kind === 'area' || kind === 'number';
}

/**
 * The objects of `candidates` the criteria select: those of the type whose property compares as
 * the operator says (Include), or every candidate but those (Exclude).
 */
export function quickSelect(
  model: DocumentModel,
  candidates: readonly EntityId[],
  c: QuickSelectCriteria,
): EntityId[] {
  const units = propertyUnits(model);
  const matches = (id: EntityId): boolean => {
    const e = model.entity(id);
    if (!e || (c.type !== MULTIPLE && e.type !== c.type)) return false;
    if (c.operator === 'all') return true;
    const row = propertySheet(model, [id])
      .sections.flatMap((s) => s.rows)
      .find((r) => r.key === c.key);
    const same = row !== undefined && !row.varies && row.value !== undefined && equal(row);
    if (c.operator === '=') return same;
    if (c.operator === '<>') return !same;
    if (!row || row.varies || row.value === undefined) return false;
    if (c.operator === '*') {
      return row.kind === 'text' && !row.readOnly && wcmatch(String(row.value), c.value);
    }
    const v = typeof row.value === 'number' ? row.value : undefined;
    const typed = numeric(row.kind) ? read(row.kind) : undefined;
    if (v === undefined || typed === undefined) return false;
    return c.operator === '>' ? v > typed : v < typed;
  };
  /** The typed value as a number of `kind`, in the drawing's units. */
  const read = (kind: PropertyKind): number | undefined =>
    kind === 'distance'
      ? parseDistance(c.value, units.lunits)
      : kind === 'angle'
        ? parseAngleValue(c.value)
        : parseNumber(c.value.trim());
  const equal = (row: PropertyRow): boolean => {
    const v = row.value!;
    if (typeof v === 'number' && numeric(row.kind)) {
      const typed = read(row.kind);
      if (typed === undefined) return false;
      // Half a unit in the last place the drawing shows (angles shown in degrees).
      const places = row.kind === 'angle' ? units.auprec : units.luprec;
      const tol = 0.5 * 10 ** -Math.max(0, places) * (row.kind === 'angle' ? Math.PI / 180 : 1);
      return Math.abs(v - typed) <= tol;
    }
    return String(v) === c.value;
  };
  return candidates.filter((id) => matches(id) === c.include);
}
