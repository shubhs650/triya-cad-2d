// Loading and deleting linetypes (M5-08; AutoCAD 2024 Help, "Linetype Manager", "Load or Reload
// Linetypes Dialog Box", "-LINETYPE (Command)", "About Text in Custom Linetypes"): what the
// Linetype Manager, -LINETYPE and the Layer Properties Manager's Select Linetype do to the LTYPE
// table. The engine reads no files: the app parses the .lin files (the bundled set and the
// user's, `@triya/render` parseLin) and hands over their definitions, which map onto LTYPE
// records here.
//
// - A definition loads as a new record, or reloads (pattern and description replaced, handle
//   kept) one of the same name, ignoring case; ByLayer, ByBlock and Continuous are never loaded.
// - A text element's style is the STYLE record its .lin names (ignoring case), or the current
//   text style when it names none ("If no text style is specified, the currently defined style is
//   used"); a definition naming a style the drawing lacks is refused. A shape needs its shape
//   number from the .shx file, which Triya cannot read (no shape files ship, CLAUDE.md), so a
//   shape linetype is refused, saying so.
// - `U=` (upright) rotation is DXF 74 bit 8, as AutoCAD writes it (74 = 10 on the GAS_LINE of
//   the ACadSharp samples, text and upright); `A=` is bit 1.
// - Delete refuses what AutoCAD's does: ByLayer, ByBlock, Continuous, the current linetype,
//   xref-dependent linetypes and linetypes in use (by objects, in block definitions too, layers,
//   styles and anything else of the drawing that names one, and the objects Triya keeps without
//   mapping, `passthroughLinetypes`).
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Vec2 } from '../geom/types';
import type { LinetypeElement, LinetypeRecord } from '../model/types';

/** A text or shape a .lin definition carries on an element (parseLin's `PatternEmbed`). */
export interface LinetypeEmbed {
  readonly kind: 'text' | 'shape';
  readonly text?: string;
  readonly shapeName?: string;
  /** The text style's name (or the shape file) as the .lin names it. */
  readonly style?: string;
  readonly scale: number;
  /** Radians. */
  readonly rotation: number;
  readonly rotationMode: 'relative' | 'absolute' | 'upright';
  readonly offset: Vec2;
}

/** One linetype of a .lin file, as parseLin reads it (`LinePattern`). */
export interface LinetypeDefinition {
  readonly name: string;
  readonly description: string;
  readonly elements: readonly {
    readonly length: number;
    readonly embed?: LinetypeEmbed;
  }[];
}

/** What a load did, by name. */
export interface LinetypeLoadReport {
  readonly loaded: readonly string[];
  readonly reloaded: readonly string[];
  /** Left as the drawing had them: loaded already, and not to be reloaded. */
  readonly kept: readonly string[];
  readonly refused: readonly { readonly name: string; readonly reason: string }[];
}

/** DXF 74 bits. */
const ABSOLUTE = 1;
const TEXT = 2;
const UPRIGHT = 8;
/** DXF 70 bit 16: a record that came in with an xref. STYLE bit 1: a shape file. */
const XREF_DEPENDENT = 16;
const SHAPE_FILE = 1;
/** AutoCAD refuses these in a symbol table name; a .lin name never has them. */
const NAME_INVALID = /[<>/\\":;?*|,=`]/;

const FIXED = ['BYLAYER', 'BYBLOCK', 'CONTINUOUS'];
const upper = (s: string) => s.toUpperCase();

/** ByLayer, ByBlock and Continuous: always in a drawing, never loaded, renamed or deleted. */
export const isFixedLinetype = (name: string): boolean => FIXED.includes(upper(name));

export const isXrefLinetype = (l: LinetypeRecord): boolean =>
  ((l.flags ?? 0) & XREF_DEPENDENT) !== 0;

/** The drawing's linetype named `name`, ignoring case. */
export function linetypeNamed(model: DocumentModel, name: string): LinetypeRecord | undefined {
  const key = upper(name);
  for (const l of model.tables.linetypes.values()) if (upper(l.name) === key) return l;
  return undefined;
}

/** The current linetype's name (CELTYPE), ByLayer when the drawing does not state one. */
export function currentLinetypeName(model: DocumentModel): string {
  const v = model.header.get('$CELTYPE');
  return typeof v === 'string' && v !== '' ? v : 'ByLayer';
}

/** The text style `name` names (ignoring case), or the current one when `name` is undefined. */
function textStyleFor(model: DocumentModel, name: string | undefined): Handle | undefined {
  const current = model.header.get('$TEXTSTYLE');
  const key = upper(name ?? (typeof current === 'string' ? current : 'Standard'));
  for (const s of model.tables.textStyles.values())
    if (upper(s.name) === key && ((s.flags ?? 0) & SHAPE_FILE) === 0) return s.handle;
  return undefined;
}

/** A definition's elements as an LTYPE record holds them, or why it cannot be loaded. */
function recordElements(model: DocumentModel, def: LinetypeDefinition): LinetypeElement[] | string {
  const out: LinetypeElement[] = [];
  for (const e of def.elements) {
    if (!Number.isFinite(e.length)) return `a length is not a number`;
    const m = e.embed;
    if (!m) {
      out.push({
        length: e.length,
        shapeFlags: 0,
        shapeNumber: 0,
        offset: { x: 0, y: 0 },
        rotation: 0,
        scale: 1,
      });
      continue;
    }
    if (m.kind === 'shape')
      return `shape ${m.shapeName ?? ''} needs its shape file ${m.style ?? ''}, which Triya cannot load`.replace(
        /\s+/g,
        ' ',
      );
    const style = textStyleFor(model, m.style);
    if (style === undefined)
      return `text style ${m.style ?? 'Standard'} is not in the drawing (load it with STYLE first)`;
    const rotation =
      m.rotationMode === 'absolute' ? ABSOLUTE : m.rotationMode === 'upright' ? UPRIGHT : 0;
    out.push({
      length: e.length,
      shapeFlags: TEXT | rotation,
      shapeNumber: 0,
      style,
      offset: { x: m.offset.x, y: m.offset.y },
      rotation: m.rotation,
      scale: m.scale,
      text: m.text ?? '',
    });
  }
  return out;
}

/**
 * Loads `defs` into the drawing (one builder step): new names as new records, names it has as
 * reloads when `reload` says so (all, none, or by name).
 */
export function loadLinetypes(
  b: ChangeSetBuilder,
  model: DocumentModel,
  defs: readonly LinetypeDefinition[],
  reload: boolean | ((name: string) => boolean) = true,
): LinetypeLoadReport {
  const loaded: string[] = [];
  const reloaded: string[] = [];
  const kept: string[] = [];
  const refused: { name: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    const name = def.name.trim();
    // A file may name a linetype twice; AutoCAD takes the first.
    if (seen.has(upper(name))) continue;
    seen.add(upper(name));
    if (isFixedLinetype(name)) {
      refused.push({ name, reason: `${name} is always in the drawing` });
      continue;
    }
    if (name === '' || NAME_INVALID.test(name)) {
      refused.push({ name, reason: 'the name is not a valid linetype name' });
      continue;
    }
    const elements = recordElements(model, def);
    if (typeof elements === 'string') {
      refused.push({ name, reason: elements });
      continue;
    }
    const fields = {
      description: def.description,
      alignment: 'A',
      patternLength: elements.reduce((s, e) => s + Math.abs(e.length), 0),
      elements,
    };
    const had = linetypeNamed(model, name);
    if (!had) {
      b.addTableRecord('linetypes', { name, ...fields });
      loaded.push(name);
    } else if (isXrefLinetype(had)) {
      refused.push({ name, reason: 'an xref-dependent linetype is not reloaded' });
    } else if (typeof reload === 'function' ? reload(had.name) : reload) {
      b.updateTableRecord('linetypes', had.handle, fields);
      reloaded.push(had.name);
    } else kept.push(had.name);
  }
  return { loaded, reloaded, kept, refused };
}

/** Field names that hold a linetype: `linetype`, `leaderLinetype`, DIMLTYPE, DIMLTEX1, … */
const LINETYPE_FIELD = /linetype|ltype|^DIMLT/i;

/**
 * The linetypes the drawing uses: every handle of one held in a linetype field of an object
 * (model space, layouts and block definitions), a table record (layers, dimension styles) or a
 * non-graphical object (multileader and table styles, layer states), and CELTYPE.
 */
export function linetypesInUse(model: DocumentModel): Set<Handle> {
  const linetypes = model.tables.linetypes;
  const used = new Set<Handle>();
  const walk = (v: unknown, key: string, depth: number): void => {
    if (depth > 12 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (LINETYPE_FIELD.test(key) && linetypes.has(v)) used.add(v);
      return;
    }
    if (typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key, depth + 1);
      return;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) walk(x, String(k), depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  for (const e of model.entities()) walk(e, '', 0);
  for (const [table, records] of Object.entries(model.tables)) {
    if (table === 'linetypes') continue;
    for (const r of (records as ReadonlyMap<Handle, unknown>).values()) walk(r, '', 0);
  }
  for (const o of model.objects.values()) walk(o, '', 0);
  for (const h of model.passthroughLinetypes) used.add(h);
  const current = linetypeNamed(model, currentLinetypeName(model));
  if (current) used.add(current.handle);
  return used;
}

/** Why the Linetype Manager cannot delete `l`, or undefined. */
export function linetypeDeleteProblem(
  model: DocumentModel,
  l: LinetypeRecord,
  used: ReadonlySet<Handle> = linetypesInUse(model),
  current: string = currentLinetypeName(model),
): string | undefined {
  if (isFixedLinetype(l.name)) return `${l.name} cannot be deleted.`;
  if (upper(l.name) === upper(current)) return `${l.name} is the current linetype.`;
  if (isXrefLinetype(l)) return `${l.name} is xref-dependent.`;
  if (used.has(l.handle)) return `${l.name} is in use.`;
  return undefined;
}

/**
 * Deletes the linetypes `handles` that can go (one builder step); the others stay, each with
 * the reason. `current` is CELTYPE as the same step sets it, when it does.
 */
export function deleteLinetypes(
  b: ChangeSetBuilder,
  model: DocumentModel,
  handles: readonly Handle[],
  current: string = currentLinetypeName(model),
): { readonly deleted: readonly string[]; readonly refused: readonly string[] } {
  const used = linetypesInUse(model);
  // In use by CELTYPE only as the step leaves it.
  const was = linetypeNamed(model, currentLinetypeName(model));
  if (was && upper(was.name) !== upper(current)) used.delete(was.handle);
  const deleted: string[] = [];
  const refused: string[] = [];
  for (const h of new Set(handles)) {
    const l = model.tables.linetypes.get(h);
    if (!l) continue;
    const why = linetypeDeleteProblem(model, l, used, current);
    if (why) refused.push(why);
    else {
      b.removeTableRecord('linetypes', h);
      deleted.push(l.name);
    }
  }
  return { deleted, refused };
}
