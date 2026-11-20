// TriyaToAcad for named page setups (M6-01 part 3), the inverse of map/layouts.ts `mapPageSetups`:
// each is a PLOTSETTINGS object in the `ACAD_PLOTSETTINGS` dictionary under its name, which is
// its DXF 1 too. What the Page Setup Manager does: New and Import add one (filed in the drawing's
// ACAD_PLOTSETTINGS, which acad-ts makes on read when a file has none, listing the dictionary as
// its reactor as AutoCAD does), Modify changes its settings as a layout's are written
// (layouts.ts `writePlot`), Rename changes its entry name in place and its DXF 1, Delete takes
// it out of the dictionary. A page setup's "Plot transparency" is its PLOTTRANSPARENCY xdata,
// written as any object's (xdata.ts). The plotter it names (DXF 2), which Triya does not map,
// stays as read; a new one names none (`none_device`, as AutoCAD writes a page setup without a
// plotter).
//
// Refused, before anything changes: a version before R2000, which introduced page setups; a
// page setup moving to another dictionary or kind (flag 1024, model space's), or filed in a
// dictionary other than ACAD_PLOTSETTINGS; a new one's handle in use; a name another page setup
// has, an invalid one, or one an entry Triya keeps as read holds; settings AutoCAD does not take
// (layouts.ts `plotProblems`); and reactor and extension dictionary changes.
import {
  ACadVersion,
  CadDictionary,
  PlotSettings,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, Handle, NamedPageSetup } from '@triya/engine';
import { namedDictionary } from '../map/header';
import {
  entryKey,
  entryRenameProblems,
  entryTakenProblems,
  renameEntries,
} from './dictionary-entries';
import { resolve, same, type Resolver } from './entities';
import { plotProblems, writePlot } from './layouts';
import type { CadFormat } from '../read';
import { writeXdata, xdataProblems } from './xdata';

export interface PageSetupsPlan {
  readonly updated: {
    readonly acad: PlotSettings;
    readonly before: NamedPageSetup;
    readonly after: NamedPageSetup;
  }[];
  readonly added: NamedPageSetup[];
  readonly removed: PlotSettings[];
}

/** DXF 70 flag 1024 (ModelType). */
const MODEL_TYPE = 1024;

/** The engine's page setup naming rules (`PAGE_SETUP_NAME_INVALID`): a layout's, colons allowed. */
const INVALID_NAME = /[<>/\\";?*|,=`]/;
const NAME_LENGTH = 255;

/** Fields no writer handles yet (xdata has its own). */
const UNSUPPORTED = ['reactors', 'extDict'] as const;

const isPageSetup = (o: { type: string } | undefined): o is NamedPageSetup =>
  o?.type === 'PLOTSETTINGS';

const handle = (h: Handle): number => Number.parseInt(h, 16);

const hex = (n: number): Handle => n.toString(16).toUpperCase();

/** A page setup's standard scale (flag 16, DXF 75) with the scale it states (142 / 143). */
const scaleKey = (p: NamedPageSetup['plot'] | undefined): string =>
  p && (p.flags & 16) !== 0
    ? JSON.stringify([p.standardScaleType, p.scale?.numerator, p.scale?.denominator])
    : '';

const plotSettingsDictionary = (doc: CadDocument): CadDictionary | undefined =>
  namedDictionary(doc, CadDictionary.acadPlotSettings);

export function planPageSetups(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  format?: CadFormat,
): { plan: PageSetupsPlan; problems: string[] } {
  const plan: PageSetupsPlan = { updated: [], added: [], removed: [] };
  const problems: string[] = [];
  const before = new Map((base.objects ?? []).filter(isPageSetup).map((o) => [o.handle, o]));
  const after = [...model.objects.values()].filter(isPageSetup);
  const dict = plotSettingsDictionary(doc);
  const version = r.version;
  const old =
    version !== undefined && version !== ACadVersion.Unknown && version < ACadVersion.AC1015
      ? `${ACadVersion[version]} has no page setups (R2000 added them)`
      : undefined;
  const handleViews =
    format === 'dwg' &&
    version !== undefined &&
    version !== ACadVersion.Unknown &&
    version >= ACadVersion.AC1018;

  for (const [h, b] of before) {
    if (isPageSetup(model.objects.get(h))) continue;
    const acad = resolve(r, h, PlotSettings);
    if (!acad) problems.push(`PLOTSETTINGS ${h}: the original is not a PLOTSETTINGS`);
    else if (old) problems.push(`PLOTSETTINGS ${b.name} (${h}): ${old}`);
    else plan.removed.push(acad);
  }
  // Names are unique without regard to case among the page setups the drawing ends up with.
  const names = new Map<string, number>();
  for (const a of after) {
    const key = String(a.name).toUpperCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  // The standard scales the drawing's page setups have as read, with the scale each states.
  const scales = new Set(
    [...(base.layouts ?? []).map((l) => l.plot), ...[...before.values()].map((p) => p.plot)].map(
      scaleKey,
    ),
  );
  const mapped = new Set([...before.keys()]);
  const isMapped = (o: CadObject) => mapped.has(hex(o.handle));
  for (const a of after) {
    const b = before.get(a.handle);
    if (b && same(b, a)) continue;
    const out: string[] = [];
    if (old) out.push(old);
    const name = a.name;
    const renamed = !b || b.name !== name;
    if (renamed) {
      if (typeof name !== 'string' || name.trim() === '') out.push('a page setup needs a name');
      else if (INVALID_NAME.test(name) || name.length > NAME_LENGTH)
        out.push(`${JSON.stringify(name)} is not a valid page setup name`);
      else if ((names.get(name.toUpperCase()) ?? 0) > 1)
        out.push(`another page setup is named ${name}`);
    }
    if (typeof a.model !== 'boolean') out.push('model: a page setup is for model space or not');
    else if (((a.plot?.flags ?? 0) & MODEL_TYPE) !== (a.model ? MODEL_TYPE : 0))
      out.push('flags: ModelType (1024) says whether a page setup is for model space');
    const space = a.model ? 'model' : 'other';
    // A page setup's own flag 1024 is checked above: the settings are checked without it.
    const plain = (p: NamedPageSetup['plot'] | undefined) =>
      p && { ...p, flags: Number.isInteger(p.flags) ? p.flags & ~MODEL_TYPE : p.flags };
    if (a.plot?.pageSetupName !== undefined)
      out.push('pageSetupName: a named page setup names itself (DXF 1), no other');
    if (b) {
      const acad = resolve(r, a.handle, PlotSettings);
      if (!acad) out.push('the original is not a PLOTSETTINGS');
      if (b.owner !== a.owner) out.push('its dictionary changes');
      if (b.model !== a.model) out.push('a page setup stays for model space or for layouts');
      for (const k of UNSUPPORTED) if (!same(b[k], a[k])) out.push(`${k} changes`);
      if (!same(b.xdata, a.xdata)) out.push(...xdataProblems(r, b.xdata, a.xdata));
      if (!same(b.plot, a.plot))
        out.push(...plotProblems(plain(b.plot), plain(a.plot), space, handleViews));
      if (renamed && acad && typeof name === 'string')
        out.push(...entryRenameProblems(acad, name, isMapped));
      if (out.length === 0) plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      if (doc.getCadObject(handle(a.handle))) out.push('the handle is already used');
      if (!dict) out.push('the drawing has no ACAD_PLOTSETTINGS dictionary to list it in');
      else if (dict.handle !== handle(a.owner))
        out.push(`it is not filed in ${CadDictionary.acadPlotSettings}`);
      for (const k of UNSUPPORTED) {
        // A new page setup lists its dictionary as its reactor, as AutoCAD files one.
        if (k === 'reactors' && (a.reactors === undefined || same(a.reactors, [a.owner]))) continue;
        if (a[k] !== undefined) out.push(`${k} changes`);
      }
      if (a.xdata) out.push(...xdataProblems(r, undefined, a.xdata));
      out.push(
        ...plotProblems(undefined, plain(a.plot), space, handleViews, scales.has(scaleKey(a.plot))),
      );
      if (typeof name === 'string') out.push(...entryTakenProblems(dict, name, isMapped));
      if (out.length === 0) plan.added.push(a);
    }
    problems.push(...out.map((p) => `PLOTSETTINGS ${String(name)} (${a.handle}): ${p}`));
  }
  return { plan, problems };
}

/**
 * Writes the plan, after the application records (a page setup's xdata may name one the same
 * save adds): removed page setups leave the dictionary first, renames go next, as names may swap
 * or pass to a new page setup, and new ones join last.
 */
export function writePageSetups(
  doc: CadDocument,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  plan: PageSetupsPlan,
): void {
  for (const acad of plan.removed) {
    const dict = acad.owner;
    if (!(dict instanceof CadDictionary)) continue;
    const key = entryKey(dict, acad);
    if (key !== undefined) dict.remove(key);
  }
  const renamed = plan.updated.filter(({ before, after }) => before.name !== after.name);
  renameEntries(renamed.map(({ acad, after }) => ({ acad, name: after.name })));
  for (const { acad, before: b, after: a } of plan.updated) {
    if (b.name !== a.name) acad.pageName = a.name;
    if (!same(b.plot, a.plot)) writePlot(acad, b.plot, a.plot);
    if (!same(b.xdata, a.xdata)) writeXdata(r, acad, b.xdata, a.xdata);
  }
  if (plan.added.length === 0) return;
  // planPageSetups refuses a new page setup where ACAD_PLOTSETTINGS is missing.
  const dict = plotSettingsDictionary(doc)!;
  for (const a of plan.added) {
    const acad = new PlotSettings(a.name);
    // acad-ts keeps a non-zero handle it has not seen, so the page setup keeps Triya's handle.
    acad.handle = handle(a.handle);
    acad.pageName = a.name;
    // No plotter: Triya does not map DXF 2 (its plotters are the Plot dialog's own).
    acad.systemPrinterName = 'none_device';
    // Every field written (acad-ts's defaults: no style sheet, no view, DXF 75 0).
    writePlot(acad, undefined, a.plot);
    if (a.xdata) writeXdata(r, acad, undefined, a.xdata);
    dict.add(acad);
    acad.addReactor(dict);
    r.created.set(a.handle, acad);
  }
}
