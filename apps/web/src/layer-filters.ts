// The Layer Properties Manager's filter tree (M5-07 part 5; AutoCAD 2024 Help, "Layer Properties
// Manager" and "Layer Filter Properties Dialog Box"): All, with All Used Layers and the drawing's
// filters under it (each nested filter under its parent), the layers the node selected lists
// (Invert filter: every other layer), and the Layer Filter Properties dialog's definition grid.
//
// The engine worker holds the drawing (M1-67), so the tree reads the filters, and the tables
// they are evaluated on, from the drawing as opened plus every change applied since; the
// expressions are the engine's own (`filteredLayers`, part 4, DEC-076). The filter menu's items
// (part 6) are below `listedLayers`. The Xref node (part 8) comes after the filters when the
// drawing has xrefs, with a node for each listing the layers it brings (the engine's
// `xrefNodeLayers`).
import {
  XREF_NODE,
  filteredLayers,
  isLayerFilter,
  parseLayerFilterExpression,
  xrefNodeLayers,
  xrefNodeNames,
  type ChangeSet,
  type DocumentInit,
  type EngineEdit,
  type FilterLayerSetting,
  type Handle,
  type LayerFilter,
  type LayerFilterExpression,
  type LayerFilterSource,
  type NonGraphicalObject,
} from '@triya/engine';
import { layerStateTables, tableNow } from './layer-states';

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

/**
 * The node selected in the tree: All, All Used Layers, a filter, the Xref node (`'xref'`) or an
 * xref's (`'xref:<name>'`, the engine's `xrefNode`).
 */
export type FilterChoice = 'all' | 'used' | Handle;

/** The names of the drawing's xrefs as the engine has them now, by name. */
export function drawingXrefs(init: DocumentInit, changes: readonly ChangeSet[]): string[] {
  return xrefNodeNames(tableNow(init, changes, 'blockRecords').values());
}

/** The node's name as the tree and the line under the list show it. */
export function filterNodeName(choice: FilterChoice, filter: LayerFilter | undefined): string {
  if (choice === 'all') return 'All';
  if (choice === 'used') return 'All Used Layers';
  if (choice === XREF_NODE) return 'Xref';
  if (choice.startsWith(`${XREF_NODE}:`)) return choice.slice(XREF_NODE.length + 1);
  return filter?.name ?? '';
}

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
  const xref = xrefNodeLayers(source.tables.layers.values(), choice);
  if (xref) {
    const listed = new Set(xref.map((l) => l.handle));
    return new Set(all.filter((h) => listed.has(h) !== options.invert));
  }
  if (!isLayerFilter(source.objects.get(choice))) return undefined;
  return new Set(
    filteredLayers(source, choice, {
      invert: options.invert,
      ...(options.used && { used: options.used }),
    }).map((l) => l.handle),
  );
}

// The filter menu (part 6; AutoCAD 2024 Help, "Layer Properties Manager", the tree view's
// shortcut menu): Visibility, Lock, Viewport and Isolate Group act on every layer the node lists
// (the engine's `layer-filter-set` and `layer-filter-isolate`), then the filters' own items.
// Viewport and Isolate Group's Active Viewport Only act in the layout viewport made current,
// which Triya cannot make yet (MSPACE, M6-02): they are greyed in a layout, and Active Viewport
// Only in model space does what All Viewports does there, as AutoCAD's help says of both.

export type LayerFilterAction =
  | 'newProperty'
  | 'newGroup'
  | 'convert'
  | 'rename'
  | 'delete'
  | 'properties'
  | FilterLayerSetting
  | 'vpFreeze'
  | 'vpThaw'
  | 'isolateAll'
  | 'isolateActive';

export interface FilterMenuEntry {
  readonly label: string;
  /** An item; absent on a submenu. */
  readonly action?: LayerFilterAction;
  /** A submenu's items. */
  readonly items?: readonly { readonly action: LayerFilterAction; readonly label: string }[];
  readonly separator?: boolean;
}

export const FILTER_MENU: readonly FilterMenuEntry[] = [
  {
    label: 'Visibility',
    items: [
      { action: 'on', label: 'On' },
      { action: 'off', label: 'Off' },
      { action: 'thawed', label: 'Thawed' },
      { action: 'frozen', label: 'Frozen' },
    ],
  },
  {
    label: 'Lock',
    items: [
      { action: 'lock', label: 'Lock' },
      { action: 'unlock', label: 'Unlock' },
    ],
  },
  {
    label: 'Viewport',
    items: [
      { action: 'vpFreeze', label: 'Freeze' },
      { action: 'vpThaw', label: 'Thaw' },
    ],
  },
  {
    label: 'Isolate Group',
    items: [
      { action: 'isolateAll', label: 'All Viewports' },
      { action: 'isolateActive', label: 'Active Viewport Only' },
    ],
  },
  { action: 'newProperty', label: 'New Properties Filter...', separator: true },
  { action: 'newGroup', label: 'New Group Filter' },
  { action: 'convert', label: 'Convert to Group Filter' },
  { action: 'rename', label: 'Rename', separator: true },
  { action: 'delete', label: 'Delete' },
  { action: 'properties', label: 'Properties...', separator: true },
];

/** What the menu's items depend on. */
export interface FilterMenuContext {
  /** The filter right-clicked; undefined for All and All Used Layers. */
  readonly filter?: LayerFilter | undefined;
  /** Its parent filter. */
  readonly parent?: LayerFilter | undefined;
  /** The block of the layout shown; undefined in model space. */
  readonly space?: Handle | undefined;
  /** The Xref node or an xref's, in which no filter can be made. */
  readonly xref?: boolean;
}

const SETTINGS: ReadonlySet<LayerFilterAction> = new Set<FilterLayerSetting>([
  'on',
  'off',
  'thawed',
  'frozen',
  'lock',
  'unlock',
]);
const isSetting = (a: LayerFilterAction): a is FilterLayerSetting => SETTINGS.has(a);

/** Whether the filter menu's item `a` can act on the node `ctx` describes. */
export function filterMenuEnabled(a: LayerFilterAction, ctx: FilterMenuContext): boolean {
  const { filter } = ctx;
  if (isSetting(a) || a === 'isolateAll') return true;
  if (a === 'newProperty') return ctx.xref !== true;
  if (a === 'vpFreeze' || a === 'vpThaw') return false;
  if (a === 'isolateActive') return ctx.space === undefined;
  if (a === 'newGroup') return ctx.xref !== true && filter?.filterType !== 'property';
  if (a === 'properties') return filter?.filterType === 'property';
  if (a === 'convert')
    return filter?.filterType === 'property' && ctx.parent?.filterType !== 'property';
  return filter !== undefined;
}

/** The engine edit item `a` sends for node `choice`, for the items that act on layers or convert. */
export function filterMenuEdit(
  a: LayerFilterAction,
  choice: FilterChoice,
  ctx: FilterMenuContext,
): EngineEdit | undefined {
  if (isSetting(a)) return { kind: 'layer-filter-set', node: choice, set: a };
  if (a === 'isolateAll' || (a === 'isolateActive' && ctx.space === undefined))
    return {
      kind: 'layer-filter-isolate',
      node: choice,
      ...(ctx.space !== undefined && { space: ctx.space }),
    };
  if (a === 'convert' && ctx.filter) return { kind: 'layer-filter-convert', filter: choice };
  return undefined;
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
