// TriyaToAcad for materials and plot style names (M1-75 part 33). Triya keeps both by name only
// (TableRecords in the engine): what a material holds and what a plot style draws with stay in
// the original, so the edits a name-only record can carry are the ones written here.
//
// Materials are renamed as AutoCAD's RENAME (Named Objects: Materials) and the Materials
// Browser's Rename do: the MATERIAL keeps its handle and definition and takes the new name, which
// a file keeps twice, as the MATERIAL's own name (DXF 1, the DWG object's first text) and as its
// ACAD_MATERIAL entry. Entities, layers and $CMATERIAL point at it by handle and follow. Global,
// ByLayer and ByBlock cannot be renamed (RENAME does not list them). A new material is refused:
// the Materials Browser makes one from a definition (the generic material's properties and the
// asset data in its extension dictionary) that Triya does not map. AutoCAD's help does not say
// whether a rename also changes the name inside the material's asset data (its FBXASSET
// XRECORD); that data stays as read, as Triya does not map it.
//
// A plot style name joins a named-plot-style drawing ($PSTYLEMODE 0) as AutoCAD adds one when a
// layer or object is given a style of the attached plot style table (Layer Properties Manager and
// Properties palette, "Select Plot Style"): an ACDBPLACEHOLDER entry of the ACAD_PLOTSTYLENAME
// dictionary, which entities (DXF 390) and layers point at by handle. A colour-dependent drawing
// ($PSTYLEMODE 1) and a drawing before R2000 have no plot style names to add. A plot style is
// renamed in its plot style table (the Plot Style Table Editor edits the STB file), not in the
// drawing, and no AutoCAD command renames a drawing's plot style name, so a rename is refused.

import {
  ACadVersion,
  AcdbPlaceHolder,
  CadDictionary,
  Material,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, SymbolTableRecord } from '@triya/engine';
import { entryRenameProblems, renameEntries } from './dictionary-entries';
import type { Resolver } from './entities';
import { changes, planRecords, type RecordPlan } from './records';

export type MaterialPlan = RecordPlan<Material, SymbolTableRecord>;
export type PlotStylePlan = RecordPlan<AcdbPlaceHolder, SymbolTableRecord>;

type Planner = Resolver & { readonly created: Map<Handle, CadObject> };

/** The materials AutoCAD makes in every drawing from R2007 and lets nobody rename. */
const FIXED_MATERIALS = [Material.byLayerName, Material.byBlockName, 'Global'];

/** The default plot style name of ACAD_PLOTSTYLENAME, which no drawing renames. */
const NORMAL = 'Normal';

const isHandle = (handle: Handle) => (o: CadObject) =>
  o.handle.toString(16).toUpperCase() === handle;

/** A material or plot style is an object, not a table record: it has no DXF 70 flags. */
function flagProblems(b: SymbolTableRecord | undefined, a: SymbolTableRecord): string[] {
  return changes(b, a)('flags') && a.flags !== undefined ? ['it has no record flags'] : [];
}

/** The model's material changes against the original's mapping, and why any cannot be written. */
export function planMaterials(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Planner,
): { plan: MaterialPlan; problems: string[] } {
  const version = doc.header?.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1021;
  const mapped = (o: CadObject): boolean =>
    [...model.tables.materials.keys()].some((h) => isHandle(h)(o));
  return planRecords(doc, base.tables?.materials ?? [], model.tables.materials, r, {
    what: 'material',
    type: Material,
    make: (a) => new Material(a.name),
    fixedNames: FIXED_MATERIALS,
    // PURGE (purge.ts).
    removable: true,
    problems: (b, a, acad) => [
      ...(b
        ? []
        : [
            'a new material: the Materials Browser makes one from a definition (its properties and asset data) that Triya does not map',
          ]),
      ...flagProblems(b, a),
      // As an entity's material (entities.ts): a drawing before R2007 has no materials, though
      // a file saved down from a later one may still hold its MATERIAL objects.
      ...(b && b.name !== a.name && old
        ? [`${ACadVersion[version!]} has no materials (R2007 added them)`]
        : []),
      ...(b && acad && b.name !== a.name ? entryRenameProblems(acad, a.name, mapped) : []),
    ],
  });
}

/**
 * The model's plot style name changes against the original's mapping, and why any cannot be
 * written. `refusal` is why the drawing has no plot style names to give (`plotStyleNames` in
 * export.ts: before R2000, or colour-dependent).
 */
export function planPlotStyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Planner,
  refusal: string | undefined,
): { plan: PlotStylePlan; problems: string[] } {
  const dict = doc.rootDictionary?.getEntry<CadDictionary>(CadDictionary.acadPlotStyleName);
  return planRecords(doc, base.tables?.plotStyles ?? [], model.tables.plotStyles, r, {
    what: 'plot style',
    type: AcdbPlaceHolder,
    make: (a) => new AcdbPlaceHolder(a.name),
    fixedNames: [NORMAL],
    // PURGE (purge.ts).
    removable: true,
    problems: (b, a) => {
      const out = flagProblems(b, a);
      if (b && b.name !== a.name && b.name.toUpperCase() !== NORMAL.toUpperCase())
        out.push(
          'renaming a plot style name: AutoCAD renames a plot style in its plot style table (STB), not in the drawing',
        );
      if (!b) {
        if (refusal !== undefined) out.push(refusal);
        else if (!(dict instanceof CadDictionary))
          out.push('the drawing has no ACAD_PLOTSTYLENAME dictionary to list it in');
        else {
          // The entry a PURGE in the same save removes still holds the name while the new one
          // is added (purge.ts writes last); a later save can reuse it.
          const held = dict.get(a.name);
          if (held && !model.tables.plotStyles.has(held.handle.toString(16).toUpperCase()))
            out.push(
              `the plot style name ${a.name} is purged by the same save; save the purge first`,
            );
        }
      }
      return out;
    },
  });
}

/**
 * Writes the planned material renames onto `doc`. The entry and the MATERIAL's name change
 * together (`CadDictionary.rename` sets both); a material read from DXF is written back from the
 * group codes acad-ts kept, so its name code (DXF 1 of AcDbMaterial) changes with them.
 */
export function writeMaterials(plan: MaterialPlan): void {
  const renames = plan.updated
    .filter(({ before, after }) => before.name !== after.name)
    .map(({ acad, after }) => ({ acad, name: after.name }));
  renameEntries(renames);
  for (const { acad, name } of renames) {
    const codes = acad.rawDxfCodes;
    if (!codes) continue;
    const at = codes.findIndex((c) => c.code === 100 && c.value === 'AcDbMaterial');
    const nameCode = codes.findIndex((c, i) => i > at && c.code === 1);
    if (at >= 0 && nameCode >= 0) codes[nameCode] = { code: 1, value: name };
  }
}

/** Adds the planned plot style names to the drawing's ACAD_PLOTSTYLENAME dictionary. */
export function writePlotStyles(doc: CadDocument, plan: PlotStylePlan): void {
  if (plan.added.length === 0) return;
  const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadPlotStyleName)!;
  for (const { acad } of plan.added) dict.add(acad);
}
