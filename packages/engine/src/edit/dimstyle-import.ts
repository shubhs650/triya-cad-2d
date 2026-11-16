// Importing dimension styles from another drawing (M4-03 part 3: the roadmap's "import from
// file"). AutoCAD brings another drawing's styles in through DesignCenter (AutoCAD 2024 Help,
// "To Add Content with DesignCenter": drag a dimension style from a drawing's Dimstyles; "if a
// definition is a duplicate of one in the drawing, it is ignored"). Triya's Dimension Style
// Manager has an Import... button for it until the Design-Center-lite palette (M5-11) lands:
// the user picks an open drawing or a drawing file and the styles to bring in.
//
// The styles travel as PASTECLIP's records do (clipboard.ts): each with its sub-styles (part 2,
// `NAME$n`), the text style, linetypes and arrowhead blocks it names, and the applications of
// its `ACAD_DSTYLE_*` xdata, all given new handles above the target's $HANDSEED. A style (or a
// record it names) the target has already under that name is the target's: a duplicate is
// ignored, as DesignCenter ignores it, sub-styles and all. Styles are not scaled between
// drawings in other units, as DesignCenter does not scale them.
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { DimStyleRecord } from '../model/types';
import { childStyleUse, type DimStyleUse } from '../annotation/dimstyle-family';
import { copyToClipboard, pasteObjects, type Clipboard } from './clipboard';

/** One style another drawing offers: a style of its own, or a sub-style under its parent. */
export interface DimStyleOffer {
  readonly name: string;
  readonly parent?: string;
  readonly use?: Exclude<DimStyleUse, 'all'>;
}

/** What an import brought in and what it ignored as a duplicate, by name. */
export interface DimStyleImport {
  readonly added: readonly string[];
  readonly ignored: readonly string[];
}

const upper = (s: string) => s.toUpperCase();
const ORIGIN: Vec2 = { x: 0, y: 0 };

/** The styles `model` offers, each parent followed by its sub-styles, by name. */
export function dimStyleOffers(model: DocumentModel): DimStyleOffer[] {
  const all = [...model.tables.dimStyles.values()];
  const parents = new Set(all.map((s) => upper(s.name)));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const out: DimStyleOffer[] = [];
  for (const s of all.filter((x) => !isSubStyle(x, parents)).sort(byName)) {
    out.push({ name: s.name });
    for (const c of all.filter((x) => childStyleUse(x.name)?.parent === s.name).sort(byName)) {
      out.push({ name: c.name, parent: s.name, use: childStyleUse(c.name)!.use });
    }
  }
  return out;
}

/** A sub-style whose parent the drawing has (one without is listed as a style of its own). */
function isSubStyle(s: DimStyleRecord, parents: ReadonlySet<string>): boolean {
  const of = childStyleUse(s.name);
  return of !== undefined && parents.has(upper(of.parent));
}

/**
 * The styles named in `names` with their sub-styles, carried as the Clipboard carries records;
 * `except` (names, the target's) leaves out the styles a paste would ignore, so what only they
 * name stays behind too.
 */
export function copyDimStyles(
  model: DocumentModel,
  names: readonly string[],
  except: readonly string[] = [],
): Clipboard {
  const wanted = new Set(names.map(upper));
  const skipped = new Set(except.map(upper));
  const handles = [...model.tables.dimStyles.values()]
    .filter((s) => {
      const parent = childStyleUse(s.name)?.parent;
      const named =
        wanted.has(upper(s.name)) || (parent !== undefined && wanted.has(upper(parent)));
      const duplicate =
        skipped.has(upper(s.name)) || (parent !== undefined && skipped.has(upper(parent)));
      return named && !duplicate;
    })
    .map((s) => s.handle);
  return copyToClipboard(model, [], ORIGIN, undefined, handles).clipboard;
}

/**
 * The Clipboard's dimension styles brought into `model` by `b`: the ones it has no style of
 * that name for, and no parent of that name (a sub-style of an ignored style is ignored with
 * it); duplicates are ignored.
 */
export function importDimStyles(
  b: ChangeSetBuilder,
  model: DocumentModel,
  clip: Clipboard,
): DimStyleImport {
  const have = new Set([...model.tables.dimStyles.values()].map((s) => upper(s.name)));
  const styles = clip.tables.dimStyles ?? [];
  const ignoredStyle = (s: DimStyleRecord) => {
    const parent = childStyleUse(s.name)?.parent;
    return have.has(upper(s.name)) || (parent !== undefined && have.has(upper(parent)));
  };
  const byName = (a: DimStyleRecord, b: DimStyleRecord) => a.name.localeCompare(b.name);
  const added = styles.filter((s) => !ignoredStyle(s)).sort(byName);
  const ignored = styles.filter(ignoredStyle).sort(byName);
  if (added.length === 0) return { added: [], ignored: ignored.map((s) => s.name) };
  const space = [...model.tables.blockRecords.values()].find(
    (r) => upper(r.name) === '*MODEL_SPACE',
  );
  const carried: Clipboard = {
    ...clip,
    // A paste brings records, never objects, here.
    entities: [],
    tables: { ...clip.tables, dimStyles: added },
  };
  pasteObjects(b, model, carried, space?.handle ?? '0', clip.base);
  return { added: added.map((s) => s.name), ignored: ignored.map((s) => s.name) };
}
