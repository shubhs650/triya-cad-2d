// The Parameters Manager's rows (M9-03 part 5): what the drawing's engine sends while the palette
// shows its drawing, per drawing, and how the palette shows and narrows them. Part 12: the filter
// tree's filters (All, All Used in Expressions, the drawing's group filters), Invert filter, and
// sorting by a column.
import type { Handle, ParameterGroupInfo, ParameterInfo } from '@triya/engine';

const NO_GROUPS: readonly ParameterGroupInfo[] = [];

/** The rows and group filters the drawings' engines sent, per drawing, for the palette to show. */
export class ParameterRows {
  readonly #rows = new Map<number, readonly ParameterInfo[]>();
  readonly #groups = new Map<number, readonly ParameterGroupInfo[]>();
  readonly #listeners = new Set<() => void>();

  set(doc: number, rows: readonly ParameterInfo[], groups: readonly ParameterGroupInfo[]): void {
    this.#rows.set(doc, rows);
    this.#groups.set(doc, groups);
    for (const l of this.#listeners) l();
  }

  get(doc: number | undefined): readonly ParameterInfo[] | undefined {
    return doc === undefined ? undefined : this.#rows.get(doc);
  }

  /** The drawing's group filters; none until its engine sends them. */
  groups(doc: number | undefined): readonly ParameterGroupInfo[] {
    return (doc === undefined ? undefined : this.#groups.get(doc)) ?? NO_GROUPS;
  }

  forget(doc: number): void {
    this.#groups.delete(doc);
    if (this.#rows.delete(doc)) for (const l of this.#listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const parameterRows = new ParameterRows();

/**
 * The Value column: a distance to four places, an angle in degrees, or why there is none (an
 * expression naming a parameter that is gone, say).
 */
export function parameterValueText(row: ParameterInfo): string {
  if (row.value === undefined) return row.error ?? '';
  const n = row.value.toFixed(4);
  return row.type === 'Angular' ? `${n}°` : n;
}

/**
 * The rows whose name, expression or description holds `search`, any case: AutoCAD's "Search
 * for parameter" box narrows the list as it is typed.
 */
export function searchParameters(
  rows: readonly ParameterInfo[],
  search: string,
): readonly ParameterInfo[] {
  const s = search.trim().toLowerCase();
  if (s === '') return rows;
  return rows.filter((r) =>
    [r.name, r.expression, r.description].some((v) => v.toLowerCase().includes(s)),
  );
}

/** What the filter tree has selected: All, All Used in Expressions or a group filter. */
export type ParameterFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'expressions' }
  | { readonly kind: 'group'; readonly group: Handle };

/** The names an expression holds: a parameter is named whole, case sensitive. */
const NAME = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * The filter tree's All Used in Expressions: the parameters another parameter's expression names
 * and those whose expression names another parameter. AutoCAD 2024 Help names the filter
 * without saying which side it means; a drafter looking for what drives what expects both.
 */
export function usedInExpressions(rows: readonly ParameterInfo[]): ReadonlySet<string> {
  const names = new Set(rows.map((r) => r.name));
  const used = new Set<string>();
  for (const r of rows) {
    for (const n of r.expression.match(NAME) ?? []) {
      if (n === r.name || !names.has(n)) continue;
      used.add(n);
      used.add(r.name);
    }
  }
  return used;
}

/**
 * The rows `filter` shows; with `invert` (AutoCAD's Invert Filter), those it does not. A group
 * filter that is gone shows them all, as All does.
 */
export function filterParameters(
  rows: readonly ParameterInfo[],
  filter: ParameterFilter,
  groups: readonly ParameterGroupInfo[],
  invert: boolean,
): readonly ParameterInfo[] {
  let keep: (r: ParameterInfo) => boolean;
  if (filter.kind === 'expressions') {
    const used = usedInExpressions(rows);
    keep = (r) => used.has(r.name);
  } else if (filter.kind === 'group') {
    const group = groups.find((g) => g.handle === filter.group);
    if (!group) return rows;
    keep = (r) => group.members.includes(r.constraint);
  } else {
    if (!invert) return rows;
    return [];
  }
  return rows.filter((r) => keep(r) !== invert);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The group filters as the tree lists them: by name, numbers in order, any case. */
export function sortedGroups(groups: readonly ParameterGroupInfo[]): readonly ParameterGroupInfo[] {
  return [...groups].sort((a, b) => collator.compare(a.name, b.name));
}

/** A column the rows are sorted by, as its header was clicked: once up, again down. */
export interface ParameterSort {
  readonly column: 'name' | 'expression' | 'value' | 'type' | 'description';
  readonly descending: boolean;
}

/**
 * The rows sorted by a column, as AutoCAD's manager sorts when a column's header is clicked:
 * names and text in order, numbers in them counted (d2 before d10), any case; values as numbers,
 * a row without one last whichever way; ties by name. No column keeps the drawing's order.
 */
export function sortParameters(
  rows: readonly ParameterInfo[],
  sort: ParameterSort | undefined,
): readonly ParameterInfo[] {
  if (!sort) return rows;
  const sign = sort.descending ? -1 : 1;
  const text = (r: ParameterInfo) =>
    sort.column === 'value' ? '' : r[sort.column as 'name' | 'expression' | 'type' | 'description'];
  return [...rows].sort((a, b) => {
    if (sort.column === 'value') {
      if (a.value === undefined || b.value === undefined) {
        if (a.value !== b.value) return a.value === undefined ? 1 : -1;
      } else if (a.value !== b.value) return sign * (a.value - b.value);
    } else {
      const c = collator.compare(text(a), text(b));
      if (c !== 0) return sign * c;
    }
    return sign * collator.compare(a.name, b.name);
  });
}
