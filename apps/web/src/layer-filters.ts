// The Layer Properties Manager's filter tree (M5-07 part 5; AutoCAD 2024 Help, "Layer Properties
// Manager" and "Layer Filter Properties Dialog Box"): All, with All Used Layers and the drawing's
// filters under it (each nested filter under its parent), the layers the node selected lists
// (Invert filter: every other layer), and the Layer Filter Properties dialog's definition grid.
//
// The engine worker holds the drawing (M1-67), so the tree reads the filters, and the tables
// they are evaluated on, from the drawing as opened plus every change applied since; the
// expressions are the engine's own (`filteredLayers`, part 4, DEC-076).
import {
  filteredLayers,
  isLayerFilter,
  parseLayerFilterExpression,
  type ChangeSet,
  type DocumentInit,
  type Handle,
  type LayerFilter,
  type LayerFilterExpression,
  type LayerFilterSource,
  type NonGraphicalObject,
} from '@triya/engine';
import { layerStateTables } from './layer-states';

/** The filters as the engine has them now: those opened with every change applied. */
export function drawingLayerFilters(
  init: DocumentInit,
  changes: readonly ChangeSet[],
): LayerFilter[] {
  const now = new Map<Handle, LayerFilter>();
  for (const o of init.objects ?? []) if (isLayerFilter(o)) now.set(o.handle, o);
  for (const cs of changes) {
    for (const o of cs.objects?.removed ?? []) now.delete(o.handle);
    for (const { after } of cs.objects?.updated ?? [])
      if (isLayerFilter(after)) now.set(after.handle, after);
    for (const o of cs.objects?.added ?? []) if (isLayerFilter(o)) now.set(o.handle, o);
  }
  return [...now.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
}

/** What the engine's `filteredLayers` evaluates: the tables now and the filters. */
export function layerFilterSource(
  init: DocumentInit,
  changes: readonly ChangeSet[],
): LayerFilterSource {
  const objects = new Map<Handle, NonGraphicalObject>();
  for (const f of drawingLayerFilters(init, changes)) objects.set(f.handle, f);
  return { ...layerStateTables(init, changes), objects };
}

export interface LayerFilterNode {
  readonly filter: LayerFilter;
  readonly children: readonly LayerFilterNode[];
}

/** The filters under All: each under its parent, by name; one whose parent is gone at the top. */
export function layerFilterTree(filters: readonly LayerFilter[]): LayerFilterNode[] {
  const handles = new Set(filters.map((f) => f.handle));
  const under = (parent: Handle | undefined, seen: ReadonlySet<Handle>): LayerFilterNode[] =>
    filters
      .filter((f) =>
        parent === undefined
          ? f.parent === undefined || !handles.has(f.parent)
          : f.parent === parent,
      )
      .filter((f) => !seen.has(f.handle))
      .map((f) => ({ filter: f, children: under(f.handle, new Set([...seen, f.handle])) }));
  return under(undefined, new Set());
}

/** The node selected in the tree: All, All Used Layers or a filter. */
export type FilterChoice = 'all' | 'used' | Handle;

/**
 * The layers node `choice` lists, undefined for every layer. All Used Layers lists the layers
 * `used` names (none until the engine has said); a filter no longer in the drawing lists all.
 */
export function listedLayers(
  source: LayerFilterSource,
  choice: FilterChoice,
  options: { readonly invert: boolean; readonly used?: ReadonlySet<Handle> | undefined },
): ReadonlySet<Handle> | undefined {
  const all = [...source.tables.layers.keys()];
  if (choice === 'all') return options.invert ? new Set() : undefined;
  if (choice === 'used') {
    const used = options.used ?? new Set<Handle>();
    return new Set(all.filter((h) => used.has(h) !== options.invert));
  }
  if (!isLayerFilter(source.objects.get(choice))) return undefined;
  return new Set(
    filteredLayers(source, choice, {
      invert: options.invert,
      ...(options.used && { used: options.used }),
    }).map((l) => l.handle),
  );
}

/** The name AutoCAD gives a new filter: Properties Filter1 or Group Filter1, past those taken. */
export function nextFilterName(
  filters: readonly LayerFilter[],
  filterType: 'property' | 'group',
): string {
  const base = filterType === 'group' ? 'Group Filter' : 'Properties Filter';
  const taken = new Set(filters.map((f) => f.name.toUpperCase()));
  let n = 1;
  while (taken.has(`${base}${n}`.toUpperCase())) n++;
  return `${base}${n}`;
}

/** The line under the list, as AutoCAD's manager words it. */
export const filterCountLine = (node: string, shown: number, total: number): string =>
  `${node}: ${shown} layer${shown === 1 ? '' : 's'} displayed of ${total} total layers`;

// The Layer Filter Properties dialog's Filter definition: one row per set of properties a layer
// may have, each cell blank (any) or a value; a layer matches a row when it has every value in
// it, and the filter when it matches any row. Text cells take WCMATCH patterns (`*`, `?`, `#`).

/** A definition grid cell: a column of the dialog. */
export type DefinitionField =
  | 'status'
  | 'name'
  | 'on'
  | 'frozen'
  | 'locked'
  | 'color'
  | 'linetype'
  | 'lineweight'
  | 'transparency'
  | 'plotStyle'
  | 'plot'
  | 'newVpFrozen'
  | 'description';

export type DefinitionRow = Partial<Record<DefinitionField, string>>;

export interface DefinitionColumn {
  readonly field: DefinitionField;
  readonly title: string;
  /** The expression's variable (the engine's `layerFilterMatches`). */
  readonly variable: string;
  /** A setting's two values, true first; a text cell has none. */
  readonly choices?: readonly [string, string];
}

/** The dialog's columns in AutoCAD's order. */
export const DEFINITION_COLUMNS: readonly DefinitionColumn[] = [
  { field: 'status', title: 'Status', variable: 'USED', choices: ['In use', 'Not in use'] },
  { field: 'name', title: 'Name', variable: 'NAME' },
  { field: 'on', title: 'On', variable: 'ON', choices: ['On', 'Off'] },
  { field: 'frozen', title: 'Freeze', variable: 'FROZEN', choices: ['Frozen', 'Thawed'] },
  { field: 'locked', title: 'Lock', variable: 'LOCKED', choices: ['Locked', 'Unlocked'] },
  { field: 'color', title: 'Color', variable: 'COLOR' },
  { field: 'linetype', title: 'Linetype', variable: 'LINETYPE' },
  { field: 'lineweight', title: 'Lineweight', variable: 'LINEWEIGHT' },
  { field: 'transparency', title: 'Transparency', variable: 'TRANSPARENCY' },
  { field: 'plotStyle', title: 'Plot Style', variable: 'PLOTSTYLENAME' },
  { field: 'plot', title: 'Plot', variable: 'PLOTTABLE', choices: ['Plot', 'No plot'] },
  {
    field: 'newVpFrozen',
    title: 'New VP Freeze',
    variable: 'NEWVPFROZEN',
    choices: ['Frozen', 'Thawed'],
  },
  { field: 'description', title: 'Description', variable: 'DESCRIPTION' },
];

/**
 * An empty grid: every layer. AutoCAD keeps a filter with no definition (it lists all layers);
 * the engine takes an expression, so the grid's empty form is a name that every layer matches.
 */
export const EMPTY_DEFINITION = 'NAME=="*"';

/** The grid as a filter expression, or why it cannot be one. */
export function definitionExpression(rows: readonly DefinitionRow[]): string {
  const terms: string[] = [];
  for (const row of rows) {
    const and: string[] = [];
    for (const c of DEFINITION_COLUMNS) {
      const v = row[c.field]?.trim();
      if (!v) continue;
      if (v.includes('"')) return 'A filter value cannot hold a double quote (").';
      const value = c.choices ? (v === c.choices[0] ? 'True' : 'False') : v;
      and.push(`${c.variable}=="${value}"`);
    }
    if (and.length > 0) terms.push(and.join(' AND '));
  }
  return terms.length === 0 ? EMPTY_DEFINITION : terms.join(' OR ');
}

/** Aliases the engine reads too, and OFF, the opposite of ON. */
const VARIABLE_ALIASES: Readonly<Record<string, string>> = {
  PLOT: 'PLOTTABLE',
  PLOTSTYLE: 'PLOTSTYLENAME',
};

/** The items of `e` joined by `op`, brackets taken away. */
function flat(e: LayerFilterExpression, op: 'or' | 'and'): readonly LayerFilterExpression[] {
  return e.op === op ? e.items.flatMap((x) => flat(x, op)) : [e];
}

/**
 * Filter expression `text` as the grid's rows, or undefined when the grid cannot show it (a
 * `!=`, a NOT, an OR inside an AND, a variable twice in a row or one not in the grid).
 */
export function definitionRows(text: string): DefinitionRow[] | undefined {
  if (text.trim() === EMPTY_DEFINITION) return [];
  const e = parseLayerFilterExpression(text);
  if (typeof e === 'string') return undefined;
  const rows: DefinitionRow[] = [];
  for (const term of flat(e, 'or')) {
    const row: DefinitionRow = {};
    for (const x of flat(term, 'and')) {
      if (x.op !== 'compare' || !x.equal) return undefined;
      const off = x.variable === 'OFF';
      const variable = off ? 'ON' : (VARIABLE_ALIASES[x.variable] ?? x.variable);
      const column = DEFINITION_COLUMNS.find((c) => c.variable === variable);
      if (!column || row[column.field] !== undefined) return undefined;
      if (column.choices) {
        const v = x.value.trim().toUpperCase();
        if (v !== 'TRUE' && v !== 'FALSE') return undefined;
        row[column.field] = column.choices[(v === 'TRUE') !== off ? 0 : 1];
      } else row[column.field] = x.value;
    }
    rows.push(row);
  }
  return rows;
}
