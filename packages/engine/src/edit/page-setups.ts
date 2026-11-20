// Named page setups (M6-01 part 3): what AutoCAD's Page Setup Manager (PAGESETUP) does with them.
// AutoCAD 2024 Help, "Page Setup Manager": a named page setup is kept in the drawing's
// `ACAD_PLOTSETTINGS` dictionary under its name (a PLOTSETTINGS object, DXF 1 its name too), model
// space's with flag 1024; New saves the settings of the Page Setup dialog under a new name,
// Modify changes them, the list's shortcut menu renames and deletes one, Set Current applies one
// to the layout ("Sets the selected page setup to be the current page setup for the current
// layout": its settings are copied into the layout's own and the layout names it, LAYOUT DXF 1),
// and Import copies another drawing's ("If a page setup with the same name exists in the current
// drawing, ... you are asked whether to redefine it").
//
// AutoCAD keeps a page setup's "Plot transparency" in the PLOTTRANSPARENCY xdata of the object
// that holds the settings (`withPlotTransparency`), a named page setup's as a layout's, and Set
// Current carries it to the layout. The Help gives no naming rules for page setups: names follow
// the layout's (up to 255 characters, none of < > / \ " ; ? * | , = `) except that a colon is
// allowed, as page setups are commonly named for their scale ("A1 1:100"; the page setups test
// drawing has "Model ANSI B 1:2"). They are unique without regard to case across model space's and
// the layouts' page setups, as the one dictionary keeps them.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Layout, LayoutPlot, NamedPageSetup, NonGraphicalObject } from '../model/types';
import {
  LAYOUT_NAME_MAX,
  plotTransparencyIn,
  plotTransparencyOf,
  withPlotTransparency,
} from './layouts';

/** What a page setup's name cannot hold (see the head comment). */
export const PAGE_SETUP_NAME_INVALID = /[<>/\\";?*|,=`]/;

/** DXF 70 flag 1024 (ModelType): a page setup for model space. */
export const MODEL_PAGE_SETUP = 1024;

export const isNamedPageSetup = (o: NonGraphicalObject | undefined): o is NamedPageSetup =>
  o?.type === 'PLOTSETTINGS';

/** A named page setup as the Page Setup Manager states one: no handle or owner yet. */
export interface PageSetupInit {
  readonly name: string;
  /** Model space's (flag 1024) rather than the layouts'. */
  readonly model: boolean;
  readonly plot: LayoutPlot;
  /** The Page Setup dialog's "Plot transparency"; absent keeps what it was (off for a new one). */
  readonly plotTransparency?: boolean;
}

const upper = (s: string): string => s.trim().toUpperCase();

/** The drawing's named page setups, by name; only model space's or the layouts' when `model` says. */
export function namedPageSetups(model: DocumentModel, kind?: 'model' | 'layout'): NamedPageSetup[] {
  return [...model.objects.values()]
    .filter(isNamedPageSetup)
    .filter((p) => kind === undefined || p.model === (kind === 'model'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The named page setup called `name`, whatever its case. */
export function pageSetupNamed(model: DocumentModel, name: string): NamedPageSetup | undefined {
  const key = upper(name);
  return namedPageSetups(model).find((p) => upper(p.name) === key);
}

/** The `ACAD_PLOTSETTINGS` dictionary new page setups are filed in. */
export function pageSetupDictionary(model: DocumentModel): Handle | undefined {
  if (model.meta.plotSettingsDictionary) return model.meta.plotSettingsDictionary;
  return namedPageSetups(model)[0]?.owner;
}

/** Why `name` cannot name a page setup (other than `self`), or undefined. */
export function pageSetupNameProblem(
  model: DocumentModel,
  name: string,
  self?: Handle,
): string | undefined {
  if (name.trim() === '' || name.length > LAYOUT_NAME_MAX || PAGE_SETUP_NAME_INVALID.test(name))
    return 'Invalid page setup name.';
  const taken = pageSetupNamed(model, name);
  if (taken && taken.handle !== self) return `A page setup named "${taken.name}" already exists.`;
  return undefined;
}

/** "Setup" and the lowest number from 1 that no page setup has: New Page Setup's default name. */
export function nextPageSetupName(model: DocumentModel): string {
  let n = 1;
  while (pageSetupNamed(model, `Setup${n}`)) n++;
  return `Setup${n}`;
}

/** Why a page setup's settings cannot be a page setup's, or undefined (PAGESETUP takes no such values). */
export function pageSetupPlotProblem(p: LayoutPlot): string | undefined {
  if (!(p.paperWidth > 0 && p.paperHeight > 0)) return 'the paper size must be greater than 0';
  const m = p.margins;
  if ([m.left, m.bottom, m.right, m.top].some((v) => !(v >= 0)))
    return 'margins cannot be negative';
  if (m.left + m.right >= p.paperWidth || m.bottom + m.top >= p.paperHeight)
    return 'the margins leave no printable area';
  if (!(p.scale.numerator > 0 && p.scale.denominator > 0))
    return 'the plot scale must be greater than 0';
  // DXF 74 = 3 plots the view DXF 6 names (M6-04 part 2).
  if (p.plotType === 3 && !p.viewName) return 'the View plot area needs a view';
  return undefined;
}

/**
 * A named page setup's own settings: its kind's flag 1024, and no applied page setup name (a
 * named page setup's DXF 1 is its own name, `NamedPageSetup.name`).
 */
function ownPlot(plot: LayoutPlot, model: boolean): LayoutPlot {
  const { pageSetupName: _n, ...rest } = plot;
  const flags = model ? plot.flags | MODEL_PAGE_SETUP : plot.flags & ~MODEL_PAGE_SETUP;
  // The Layout plot area is a layout's: model space plots its extents instead.
  const plotType = model && plot.plotType === 5 ? 1 : plot.plotType;
  return { ...rest, flags, plotType };
}

function plotProblem(init: PageSetupInit): string | undefined {
  const problem = pageSetupPlotProblem(init.plot);
  return problem && `Invalid page setup: ${problem}.`;
}

/**
 * New (and Import): `init` saved as a new named page setup, or over the one of its name when
 * `replace` (Import's "redefine"), which keeps its handle. A message when it cannot be.
 */
export function addPageSetup(
  b: ChangeSetBuilder,
  model: DocumentModel,
  init: PageSetupInit,
  replace = false,
): NamedPageSetup | string {
  const name = init.name.trim();
  const existing = pageSetupNamed(model, name);
  // Redefined, it keeps its name as the drawing has it.
  if (existing && replace)
    return changePageSetup(b, model, existing, { ...init, name: existing.name });
  const problem = pageSetupNameProblem(model, name) ?? plotProblem(init);
  if (problem) return problem;
  const owner = pageSetupDictionary(model);
  if (owner === undefined) return 'This drawing has no page setup dictionary (ACAD_PLOTSETTINGS).';
  let page = b.addObject({
    type: 'PLOTSETTINGS',
    owner,
    // AutoCAD lists the dictionary as the page setup's reactor too.
    reactors: [owner],
    name,
    model: init.model,
    plot: ownPlot(init.plot, init.model),
  } as Omit<NamedPageSetup, 'handle'>) as NamedPageSetup;
  if (init.plotTransparency) {
    const xdata = withPlotTransparency(b, model, page, true);
    if (xdata) page = b.updateObject(page.handle, { xdata }) as NamedPageSetup;
  }
  return page;
}

/**
 * Modify (the Page Setup dialog's OK) and Rename: the page setup's settings, name and "Plot
 * transparency" as `patch` says. A message when they cannot be.
 */
export function changePageSetup(
  b: ChangeSetBuilder,
  model: DocumentModel,
  page: NamedPageSetup,
  patch: Partial<PageSetupInit>,
): NamedPageSetup | string {
  const out: { -readonly [K in 'name' | 'plot' | 'xdata' | 'model']?: NamedPageSetup[K] } = {};
  if (patch.name !== undefined && patch.name.trim() !== page.name) {
    const name = patch.name.trim();
    const problem = pageSetupNameProblem(model, name, page.handle);
    if (problem) return problem;
    out.name = name;
  }
  if (patch.model !== undefined && patch.model !== page.model)
    return page.model
      ? `"${page.name}" is a page setup for model space.`
      : `"${page.name}" is a page setup for layouts.`;
  if (patch.plot !== undefined) {
    const problem = plotProblem({ name: page.name, model: page.model, plot: patch.plot });
    if (problem) return problem;
    const plot = ownPlot(patch.plot, page.model);
    if (JSON.stringify(plot) !== JSON.stringify(page.plot)) out.plot = plot;
  }
  if (patch.plotTransparency !== undefined) {
    const xdata = withPlotTransparency(b, model, page, patch.plotTransparency);
    if (xdata) out.xdata = xdata;
  }
  if (Object.keys(out).length === 0) return page;
  return b.updateObject(page.handle, out) as NamedPageSetup;
}

/** The list's Delete: the page setup goes; a layout that names it keeps its settings. */
export function deletePageSetup(b: ChangeSetBuilder, page: NamedPageSetup): void {
  b.removeObject(page.handle);
}

/** Why `page` cannot be made current for `layout`, or undefined. */
export function setCurrentProblem(
  model: DocumentModel,
  layout: Layout,
  page: NamedPageSetup,
  modelLayout: boolean,
): string | undefined {
  if (page.model !== modelLayout)
    return page.model
      ? `"${page.name}" is a page setup for model space.`
      : `"${page.name}" is a page setup for layouts.`;
  if (!layout.plot) return `The ${layout.name} layout has no page setup.`;
  return pageSetupPlotProblem(page.plot) && `Invalid page setup "${page.name}".`;
}

/**
 * Set Current: the layout takes the page setup's settings and names it as the one it has applied
 * (DXF 1), with its "Plot transparency". The layout's patch, for one LAYOUT update.
 */
export function currentPageSetupPatch(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layout: Layout,
  page: NamedPageSetup,
): Partial<Pick<Layout, 'plot' | 'xdata'>> {
  // The layout's flag 1024 stays its own (a drawing may not mark its Model layout so).
  const flags =
    (page.plot.flags & ~MODEL_PAGE_SETUP) | ((layout.plot?.flags ?? 0) & MODEL_PAGE_SETUP);
  const plot: LayoutPlot = { ...page.plot, flags, pageSetupName: page.name };
  const out: { -readonly [K in 'plot' | 'xdata']?: Layout[K] } = {};
  if (JSON.stringify(plot) !== JSON.stringify(layout.plot)) out.plot = plot;
  const xdata = withPlotTransparency(b, model, layout, plotTransparencyIn(b, page));
  if (xdata) out.xdata = xdata;
  return out;
}

/** A named page setup as Import copies it from another drawing. */
export function pageSetupInitOf(model: DocumentModel, page: NamedPageSetup): PageSetupInit {
  return {
    name: page.name,
    model: page.model,
    plot: page.plot,
    plotTransparency: plotTransparencyOf(model, page),
  };
}
