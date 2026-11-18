// Layer filters (the Layer Properties Manager's filter tree; M5-07 part 4, DEC-076). AutoCAD 2024
// Help, "Layer Properties Manager" and "Layer Filter Properties Dialog Box":
//
//   - A property filter lists the layers whose properties match its definition (name, on, frozen,
//     locked, colour, linetype, lineweight, transparency, plot style, plot, New VP Freeze,
//     description), kept as an expression (ObjectARX `AcLyLayerFilter::filterExpression`).
//   - A group filter lists the layers put in it, whatever their properties
//     (`AcLyLayerGroup::layerIds`).
//   - A filter nested in another lists only layers its parent lists; a group filter cannot be
//     nested in a property filter (the manager offers only New Properties Filter there).
//   - "Invert filter" lists the layers the selected filter does not.
//   - All, All Used Layers and Xref are the manager's own filters, never saved; their names are not
//     taken, and a filter name is used once in the whole tree.
//
// The expression grammar ObjectARX documents (`filterExpression`) is `or` of `and` of
// `<variable> == <constant>` and `!=`. AutoCAD's own expressions also bracket terms and quote the
// constant (`( NAME== "#*" ) and ( COLOR== "3" )`), so both are read, with NOT; keywords in any
// case. Help does not list the variables: those of the dialog's columns are read here (NAME, ON
// and OFF, FROZEN, LOCKED, PLOTTABLE, COLOR, LINETYPE, LINEWEIGHT, TRANSPARENCY, PLOTSTYLENAME,
// NEWVPFROZEN, VPFROZEN, DESCRIPTION, USED); a comparison on any other matches no layer, as
// AutoCAD shows an empty list for a definition it cannot apply. Constants are WCMATCH patterns
// compared ignoring case; True/False name the on/off settings.
import { wcmatch } from '../commands/modify/attributes';
import { ChangeSetBuilder } from '../model/builder';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import {
  isLayerFilter,
  type Color,
  type LayerFilter,
  type LayerRecord,
  type NonGraphicalObject,
} from '../model/types';
import { layerStateEntry, type LayerStateTables } from './layer-states';

/** What filters are evaluated over: a drawing, or the app's mirror of its tables and objects. */
export interface LayerFilterSource extends LayerStateTables {
  readonly objects: ReadonlyMap<Handle, NonGraphicalObject>;
}

/** A parsed filter expression. */
export type LayerFilterExpression =
  | { readonly op: 'or' | 'and'; readonly items: readonly LayerFilterExpression[] }
  | { readonly op: 'not'; readonly item: LayerFilterExpression }
  | {
      readonly op: 'compare';
      /** Upper case. */
      readonly variable: string;
      readonly equal: boolean;
      readonly value: string;
    };

const INVALID = 'Invalid filter expression.';
const NAME_INVALID = /[<>/\\":;?*|,=`]/;
const NAME_MAX = 255;
/** The manager's own filters (AutoCAD's names), never saved. */
const RESERVED = new Set(['ALL', 'ALL USED LAYERS', 'XREF']);

const upper = (s: string) => s.toUpperCase();

type Token = { readonly kind: 'word' | 'string' | '(' | ')' | '==' | '!='; readonly text: string };

function tokens(text: string): Token[] | undefined {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) i++;
    else if (c === '(' || c === ')') {
      out.push({ kind: c, text: c });
      i++;
    } else if ((c === '=' || c === '!') && text[i + 1] === '=') {
      out.push({ kind: c === '=' ? '==' : '!=', text: c + '=' });
      i += 2;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return undefined;
      out.push({ kind: 'string', text: text.slice(i + 1, end) });
      i = end + 1;
    } else {
      let j = i;
      while (
        j < text.length &&
        !/[\s()"]/.test(text[j]!) &&
        !((text[j] === '=' || text[j] === '!') && text[j + 1] === '=')
      )
        j++;
      if (j === i) return undefined;
      out.push({ kind: 'word', text: text.slice(i, j) });
      i = j;
    }
  }
  return out;
}

/** A filter expression parsed, or why it is not one ("Invalid filter expression."). */
export function parseLayerFilterExpression(text: string): LayerFilterExpression | string {
  const ts = tokens(text);
  if (!ts || ts.length === 0) return INVALID;
  let i = 0;
  const keyword = (k: string) => ts[i]?.kind === 'word' && upper(ts[i]!.text) === k;
  const list = (op: 'or' | 'and', next: () => LayerFilterExpression | undefined) => {
    const items: LayerFilterExpression[] = [];
    for (;;) {
      const e = next();
      if (!e) return undefined;
      items.push(e);
      if (!keyword(upper(op))) break;
      i++;
    }
    return items.length === 1 ? items[0] : { op, items };
  };
  const unary = (): LayerFilterExpression | undefined => {
    if (keyword('NOT')) {
      i++;
      const item = unary();
      return item && { op: 'not', item };
    }
    if (ts[i]?.kind === '(') {
      i++;
      const e = or();
      if (!e || ts[i]?.kind !== ')') return undefined;
      i++;
      return e;
    }
    const [v, rel, c] = [ts[i], ts[i + 1], ts[i + 2]];
    if (v?.kind !== 'word' || (rel?.kind !== '==' && rel?.kind !== '!=')) return undefined;
    if (c?.kind !== 'word' && c?.kind !== 'string') return undefined;
    i += 3;
    return { op: 'compare', variable: upper(v.text), equal: rel.kind === '==', value: c.text };
  };
  const and = () => list('and', unary);
  const or = (): LayerFilterExpression | undefined => list('or', and);
  const e = or();
  return e && i === ts.length ? e : INVALID;
}

/** AutoCAD's names of ACI 1–7, as the Select Color dialog gives them. */
const COLOR_NAMES = ['', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white'];

function colorTexts(c: Color): string[] {
  if (c.kind === 'aci') return [String(c.index), COLOR_NAMES[c.index] ?? ''].filter(Boolean);
  if (c.kind !== 'rgb') return [c.kind];
  const rgb = `${c.r},${c.g},${c.b}`;
  return [
    rgb,
    `RGB:${rgb}`,
    ...(c.bookName && c.colorName ? [`${c.bookName}$${c.colorName}`, c.colorName] : []),
  ];
}

/** A number compared as AutoCAD lists it (0.25, 50), or a pattern on its text. */
function numberMatches(n: number | undefined, texts: readonly string[], value: string): boolean {
  const v = Number(value.trim());
  if (n !== undefined && value.trim() !== '' && Number.isFinite(v)) return Math.abs(v - n) < 1e-9;
  return texts.some((t) => wcmatch(t, value));
}

const boolMatches = (b: boolean, value: string): boolean =>
  value.trim() === '1' ? b : value.trim() === '0' ? !b : wcmatch(b ? 'True' : 'False', value);

/** Whether `l` has the value a comparison names; undefined for a variable not known. */
function compares(
  model: LayerStateTables,
  l: LayerRecord,
  variable: string,
  value: string,
  used: ReadonlySet<Handle> | undefined,
): boolean | undefined {
  switch (variable) {
    case 'NAME':
      return wcmatch(l.name, value);
    case 'DESCRIPTION':
      return wcmatch(l.description ?? '', value);
    case 'ON':
      return boolMatches(l.on, value);
    case 'OFF':
      return boolMatches(!l.on, value);
    case 'FROZEN':
      return boolMatches(l.frozen, value);
    case 'LOCKED':
      return boolMatches(l.locked, value);
    case 'PLOTTABLE':
    case 'PLOT':
      return boolMatches(l.plot, value);
    case 'NEWVPFROZEN':
      return boolMatches(layerStateEntry(model, l).newVpFrozen, value);
    case 'VPFROZEN':
      // Frozen in the current viewport: none is current until MSPACE (M6-02).
      return boolMatches(false, value);
    case 'USED':
      return used === undefined ? undefined : boolMatches(used.has(l.handle), value);
    case 'COLOR':
      return colorTexts(l.color).some((t) => wcmatch(t, value));
    case 'LINETYPE':
      return wcmatch(layerStateEntry(model, l).linetypeName, value);
    case 'PLOTSTYLENAME':
    case 'PLOTSTYLE':
      return wcmatch(layerStateEntry(model, l).plotStyle, value);
    case 'LINEWEIGHT': {
      const w = l.lineweight;
      const mm = typeof w === 'number' ? w / 100 : undefined;
      return numberMatches(mm, [mm === undefined ? String(w) : mm.toFixed(2)], value);
    }
    case 'TRANSPARENCY': {
      const t = l.transparency;
      const alpha = typeof t === 'object' ? t.alpha : 255;
      const pct = alpha >= 255 ? 0 : Math.round(((255 - alpha) * 100) / 255);
      return numberMatches(pct, [String(pct)], value);
    }
    default:
      return undefined;
  }
}

/** Whether layer `l` matches expression `e`; `used` the layers in use, for USED. */
export function layerFilterMatches(
  model: LayerStateTables,
  e: LayerFilterExpression,
  l: LayerRecord,
  used?: ReadonlySet<Handle>,
): boolean {
  switch (e.op) {
    case 'or':
      return e.items.some((x) => layerFilterMatches(model, x, l, used));
    case 'and':
      return e.items.every((x) => layerFilterMatches(model, x, l, used));
    case 'not':
      return !layerFilterMatches(model, e.item, l, used);
    case 'compare': {
      const m = compares(model, l, e.variable, e.value, used);
      return m === undefined ? false : m === e.equal;
    }
  }
}

/** The drawing's layer filters, nested ones too, by name. */
export function layerFilters(model: LayerFilterSource): LayerFilter[] {
  const out: LayerFilter[] = [];
  for (const o of model.objects.values()) if (isLayerFilter(o)) out.push(o);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The filter named `name` (case ignored), wherever it is in the tree. */
export function layerFilterNamed(model: LayerFilterSource, name: string): LayerFilter | undefined {
  const key = upper(name);
  return layerFilters(model).find((f) => upper(f.name) === key);
}

/** The `ACLYDICTIONARY` new top-level filters are filed in, when the drawing has one. */
export function layerFilterDictionary(model: DocumentModel): Handle | undefined {
  if (model.meta.layerFilterDictionary) return model.meta.layerFilterDictionary;
  for (const o of model.objects.values()) if (isLayerFilter(o) && !o.parent) return o.owner;
  return undefined;
}

/**
 * The layers filter `handle` lists, in the table's order: a property filter's matches, a group
 * filter's own layers, each only those its parent lists; with `invert`, every other layer.
 */
export function filteredLayers(
  model: LayerFilterSource,
  handle: Handle,
  options: { readonly invert?: boolean; readonly used?: ReadonlySet<Handle> } = {},
): LayerRecord[] {
  const layers = [...model.tables.layers.values()];
  const listed = new Set<Handle>(layers.map((l) => l.handle));
  const seen = new Set<Handle>();
  for (let h: Handle | undefined = handle; h !== undefined && !seen.has(h);) {
    seen.add(h);
    const f = model.objects.get(h);
    if (!isLayerFilter(f)) break;
    const expr = f.filterType === 'property' ? parseLayerFilterExpression(f.expression) : '';
    const own =
      f.filterType === 'group'
        ? new Set(f.layers)
        : typeof expr === 'string'
          ? new Set<Handle>()
          : new Set(
              layers
                .filter((l) => layerFilterMatches(model, expr, l, options.used))
                .map((l) => l.handle),
            );
    for (const l of [...listed]) if (!own.has(l)) listed.delete(l);
    h = f.parent;
  }
  return layers.filter((l) => listed.has(l.handle) !== (options.invert ?? false));
}

function filterOf(model: DocumentModel, handle: Handle): LayerFilter | string {
  const f = model.objects.get(handle);
  return isLayerFilter(f) ? f : `No layer filter ${handle}.`;
}

function nameProblem(model: DocumentModel, name: string, self?: Handle): string | undefined {
  if (name.trim() === '' || name.length > NAME_MAX || NAME_INVALID.test(name))
    return 'Invalid filter name.';
  if (RESERVED.has(upper(name.trim()))) return `"${name}" is the name of a standard filter.`;
  const other = layerFilterNamed(model, name);
  if (other && other.handle !== self) return `A filter named "${other.name}" already exists.`;
  return undefined;
}

function layersProblem(model: DocumentModel, layers: readonly Handle[]): string | undefined {
  const seen = new Set<Handle>();
  for (const h of layers) {
    if (!model.tables.layers.has(h)) return `Layer ${h} is not in the drawing.`;
    if (seen.has(h)) return `Layer ${model.tables.layers.get(h)!.name} is listed twice.`;
    seen.add(h);
  }
  return undefined;
}

const expressionProblem = (e: string): string | undefined => {
  const p = parseLayerFilterExpression(e);
  return typeof p === 'string' ? p : undefined;
};

/**
 * New Properties Filter and New Group Filter: a filter at the top of the tree, or nested in
 * `parent` (filed in its `ACLYDICTIONARY`, made with its first nested filter).
 */
export function newLayerFilterChange(
  model: DocumentModel,
  init: {
    readonly name: string;
    readonly filterType?: 'property' | 'group' | undefined;
    readonly expression?: string | undefined;
    readonly layers?: readonly Handle[] | undefined;
    readonly parent?: Handle | undefined;
  },
): ChangeSet | string {
  const filterType = init.filterType ?? 'property';
  const layers = init.layers ?? [];
  const expression = filterType === 'property' ? (init.expression ?? '') : '';
  const parent = init.parent === undefined ? undefined : filterOf(model, init.parent);
  if (typeof parent === 'string') return parent;
  const why =
    nameProblem(model, init.name) ??
    (parent && parent.filterType === 'property' && filterType === 'group'
      ? 'A group filter cannot be nested in a property filter.'
      : undefined) ??
    (filterType === 'property'
      ? layers.length > 0
        ? 'A property filter has no layers of its own.'
        : expressionProblem(expression)
      : layersProblem(model, layers));
  if (why) return why;
  const b = new ChangeSetBuilder(model);
  let owner: Handle;
  if (parent) {
    owner = parent.nested ?? b.allocateHandle();
    if (!parent.nested) b.updateObject(parent.handle, { nested: owner } as Partial<LayerFilter>);
  } else owner = layerFilterDictionary(model) ?? b.allocateHandle();
  // AutoCAD lists the dictionary as the record's reactor too.
  b.addObject({
    type: 'LAYER_FILTER',
    owner,
    reactors: [owner],
    name: init.name,
    filterType,
    expression,
    layers: [...layers],
    ...(parent ? { parent: parent.handle } : {}),
  } as Omit<LayerFilter, 'handle'>);
  return b.build();
}

/** Rename, a property filter's new definition, a group filter's layers. */
export function editLayerFilterChange(
  model: DocumentModel,
  handle: Handle,
  edit: {
    readonly name?: string | undefined;
    readonly expression?: string | undefined;
    readonly layers?: readonly Handle[] | undefined;
  },
): ChangeSet | string {
  const f = filterOf(model, handle);
  if (typeof f === 'string') return f;
  const why =
    (edit.name === undefined ? undefined : nameProblem(model, edit.name, f.handle)) ??
    (edit.expression === undefined
      ? undefined
      : f.filterType === 'group'
        ? 'A group filter has no definition.'
        : expressionProblem(edit.expression)) ??
    (edit.layers === undefined
      ? undefined
      : f.filterType === 'property'
        ? 'A property filter has no layers of its own.'
        : layersProblem(model, edit.layers));
  if (why) return why;
  const patch: Record<string, unknown> = {};
  if (edit.name !== undefined && edit.name !== f.name) patch['name'] = edit.name;
  if (edit.expression !== undefined && edit.expression !== f.expression)
    patch['expression'] = edit.expression;
  if (edit.layers !== undefined && edit.layers.join() !== f.layers.join())
    patch['layers'] = [...edit.layers];
  const b = new ChangeSetBuilder(model);
  if (Object.keys(patch).length > 0) b.updateObject(f.handle, patch as Partial<LayerFilter>);
  return b.build();
}

/** Delete: the filter goes, with the filters nested in it. */
export function deleteLayerFilterChange(model: DocumentModel, handle: Handle): ChangeSet | string {
  const f = filterOf(model, handle);
  if (typeof f === 'string') return f;
  const gone = new Set<Handle>([f.handle]);
  const all = layerFilters(model);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of all)
      if (o.parent && gone.has(o.parent) && !gone.has(o.handle)) grew = !!gone.add(o.handle);
  }
  const b = new ChangeSetBuilder(model);
  for (const h of gone) b.removeObject(h);
  return b.build();
}

/** Layers deleted (Delete Layer, LAYDEL, LAYMRG, PURGE): each group filter stops listing them. */
export function dropLayersFromFilters(b: ChangeSetBuilder, gone: ReadonlySet<Handle>): void {
  for (const o of [...b.objects()]) {
    if (!isLayerFilter(o)) continue;
    const kept = o.layers.filter((h) => !gone.has(h));
    if (kept.length !== o.layers.length)
      b.updateObject(o.handle, { layers: kept } as Partial<LayerFilter>);
  }
}
