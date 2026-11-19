// Layouts made, deleted and renamed (M6-01): what LAYOUT New, Delete and Rename, the layout tab's
// shortcut menu and the session's layout edits share (AutoCAD 2024 Help, "LAYOUT (Command)").
//
//   - Names: "Layout names must be unique. Layout names can be up to 255 characters long and are
//     not case sensitive." AutoCAD refuses the characters `LAYOUT_NAME_INVALID` lists.
//   - New: "Creates a new layout tab. Up to 255 layouts can be created in a single drawing." The
//     default name is Layout and the next number no layout has. Its page setup is the units' own
//     sheet, as Triya's drawings without a template have it (assets/templates, M5-10): ISO A4 in
//     millimetres in a metric drawing (MEASUREMENT 1), ANSI A in inches otherwise, landscape,
//     1:1, plotting the layout, its limits the paper. AutoCAD takes it from the default output
//     device in Options, which Triya has no list of. The new layout has no viewport: AutoCAD
//     makes one on first showing it (LAYOUTCREATEVIEWPORT), which waits for MVIEW (M6-02).
//   - Delete: "The Model tab cannot be deleted." Deleting the current layout (the one on
//     `*Paper_Space`) makes another current first, as AutoCAD does: the save swaps the two sheet
//     blocks (M1-75 part 30). Every save starts from the file as it was opened, which can make only
//     one of its own layouts current, so a drawing whose other layouts are all new since it opened
//     cannot lose its current layout yet (said so). Deleting the only layout leaves an empty one
//     named Layout1 in its place, as AutoCAD keeps one layout (ambiguous in Help; the common
//     drafter expectation): Triya empties and resets the same layout, which saves as a rename.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { HeaderValue, Layout, LayoutPlot, Xdata } from '../model/types';
import { metric } from './center-settings';

/**
 * Characters AutoCAD refuses in a layout name (LAYOUT Rename: "Invalid layout name"), and its
 * 255-character limit; the save checks the same (M1-75 part 20).
 */
export const LAYOUT_NAME_INVALID = /[<>/\\":;?*|,=`]/;
export const LAYOUT_NAME_MAX = 255;
/** "Up to 255 layouts can be created in a single drawing." */
export const LAYOUT_MAX = 255;

/** Whether `layout` is model space's (the Model tab). */
export function isModelLayout(model: DocumentModel, layout: Layout): boolean {
  return model.tables.blockRecords.get(layout.blockRecord)?.name.toUpperCase() === '*MODEL_SPACE';
}

/** The paper layouts, in tab order. */
export function paperLayouts(model: DocumentModel): Layout[] {
  return model.layouts.filter((l) => !isModelLayout(model, l));
}

/** The layout (Model too) named `name`, whatever its case. */
export function layoutNamed(model: DocumentModel, name: string): Layout | undefined {
  const key = name.trim().toUpperCase();
  return model.layouts.find((l) => l.name.toUpperCase() === key);
}

/** The paper layout on `*Paper_Space`: the drawing's current layout, as saved. */
export function currentSheetLayout(model: DocumentModel): Layout | undefined {
  return paperLayouts(model).find(
    (l) => model.tables.blockRecords.get(l.blockRecord)?.name.toUpperCase() === '*PAPER_SPACE',
  );
}

/** Why `name` cannot name a layout (other than `self`), or undefined. */
export function layoutNameProblem(
  model: DocumentModel,
  name: string,
  self?: Layout,
): string | undefined {
  if (name.trim() === '' || name.length > LAYOUT_NAME_MAX || LAYOUT_NAME_INVALID.test(name))
    return 'Invalid layout name.';
  const taken = layoutNamed(model, name);
  if (taken && taken !== self) return `A layout named "${name}" already exists.`;
  return undefined;
}

/** "Layout" and the lowest number from the layouts' count on that no layout has. */
export function nextLayoutName(model: DocumentModel): string {
  let n = paperLayouts(model).length + 1;
  while (layoutNamed(model, `Layout${n}`)) n++;
  return `Layout${n}`;
}

/** The page setup and limits of a new layout: the units' own sheet (see the head comment). */
export function newLayoutSetup(model: DocumentModel): {
  plot: LayoutPlot;
  limits: NonNullable<Layout['limits']>;
} {
  const mm = metric(model);
  const [w, h] = mm ? [297, 210] : [11, 8.5];
  const plot: LayoutPlot = {
    paperSize: mm
      ? 'ISO_full_bleed_A4_(297.00_x_210.00_MM)'
      : 'ANSI_full_bleed_A_(11.00_x_8.50_Inches)',
    // DXF 44 / 45 are millimetres whatever the paper units: 11 × 8.5 in is 279.4 × 215.9 mm.
    paperWidth: mm ? w : 279.4,
    paperHeight: mm ? h : 215.9,
    margins: { left: 0, bottom: 0, right: 0, top: 0 },
    paperUnits: mm ? 'millimeters' : 'inches',
    rotation: 0,
    origin: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    plotType: 5,
    // 32 plot with plot styles, 128 lineweights, 512 paperspace last: what the no-template
    // drawings' layouts have (672). 1:1 is a custom scale there, flag 16 off.
    flags: 32 | 128 | 512,
  };
  return { plot, limits: { min: { x: 0, y: 0 }, max: { x: w, y: h } } };
}

/** LAYOUT New: a layout named `name`, after the last tab. */
export function addNewLayout(b: ChangeSetBuilder, model: DocumentModel, name: string): Layout {
  return b.addLayout({ name, ...newLayoutSetup(model) });
}

/**
 * Why LAYOUT Delete cannot delete `layout`, or undefined: the Model tab, or the current layout
 * when no other layout the drawing had as it opened can be made current in its place.
 */
export function deleteLayoutProblem(model: DocumentModel, layout: Layout): string | undefined {
  if (isModelLayout(model, layout)) return 'The Model tab cannot be deleted.';
  const sheets = paperLayouts(model);
  if (sheets.length === 1 || currentSheetLayout(model) !== layout) return undefined;
  if (successor(model, layout)) return undefined;
  return `Layout "${layout.name}" cannot be deleted until the drawing is saved and opened again: its other layouts are new.`;
}

/** The layout made current as the current one goes: the nearest one the drawing opened with. */
function successor(model: DocumentModel, layout: Layout): Layout | undefined {
  const sheets = paperLayouts(model);
  const at = sheets.indexOf(layout);
  const distance = (l: Layout) => Math.abs(sheets.indexOf(l) - at);
  // The next tab before the one in front at the same distance.
  return sheets
    .filter((l) => l !== layout && model.openedLayouts.has(l.handle))
    .sort((x, y) => distance(x) - distance(y) || sheets.indexOf(y) - sheets.indexOf(x))[0];
}

/**
 * LAYOUT Delete of `layout` (`deleteLayoutProblem` first): the current layout makes another
 * current first; the only layout is emptied and reset instead.
 */
export function deleteLayout(b: ChangeSetBuilder, model: DocumentModel, layout: Layout): void {
  const problem = deleteLayoutProblem(model, layout);
  if (problem) throw new Error(problem);
  if (paperLayouts(model).length === 1) {
    resetLayout(b, model, layout);
    return;
  }
  if (currentSheetLayout(model) === layout) b.setCurrentLayout(successor(model, layout)!.handle);
  b.removeLayout(layout.handle);
}

/** The only layout deleted: emptied, named Layout1 and given a new layout's page setup. */
function resetLayout(b: ChangeSetBuilder, model: DocumentModel, layout: Layout): void {
  for (const id of b.blockEntities(layout.blockRecord)) b.removeEntity(id);
  const { plot, limits } = newLayoutSetup(model);
  const name = 'Layout1';
  b.updateLayout(layout.handle, {
    ...(name !== layout.name && { name }),
    plot,
    limits,
  });
  // The current layout's limits live in the header too: kept agreeing where they agreed.
  if (currentSheetLayout(model) !== layout || !layout.limits) return;
  const agrees = (v: HeaderValue | undefined, p: { x: number; y: number }) =>
    typeof v === 'object' && v.x === p.x && v.y === p.y;
  const min = model.header.get('$PLIMMIN');
  const max = model.header.get('$PLIMMAX');
  if (agrees(min, layout.limits.min) && agrees(max, layout.limits.max)) {
    b.setHeader('$PLIMMIN', { ...limits.min });
    b.setHeader('$PLIMMAX', { ...limits.max });
  }
}

/**
 * The application whose xdata on a LAYOUT holds the page setup's "Plot transparency" (M6-04): AutoCAD
 * keeps it there (1071 1 on, 0 off; ezdxf documents the layout), not in the PLOTSETTINGS flags.
 */
export const PLOT_TRANSPARENCY_APP = 'PLOTTRANSPARENCY';

const plotTransparencyApp = (model: DocumentModel): Handle | undefined =>
  [...model.tables.appIds.values()].find((a) => a.name.toUpperCase() === PLOT_TRANSPARENCY_APP)
    ?.handle;

/** A layout's "Plot transparency": its PLOTTRANSPARENCY xdata's first 1071 value, non-zero. */
export function plotTransparencyOf(model: DocumentModel, layout: Layout): boolean {
  const app = plotTransparencyApp(model);
  const values = app === undefined ? undefined : layout.xdata?.find((x) => x.appId === app)?.values;
  const on = values?.find((v) => v.code === 1071)?.value;
  return typeof on === 'bigint' ? on !== 0n : typeof on === 'number' && on !== 0;
}

/**
 * The layout's xdata with "Plot transparency" set to `on` (M6-04 part 2, Apply to Layout),
 * registering PLOTTRANSPARENCY when the drawing has no such application; undefined when it is so
 * already (a layout without the xdata is off). Off keeps the application with 0, as AutoCAD writes.
 */
export function withPlotTransparency(
  b: ChangeSetBuilder,
  model: DocumentModel,
  layout: Layout,
  on: boolean,
): Xdata | undefined {
  if (plotTransparencyOf(model, layout) === on) return undefined;
  let app = plotTransparencyApp(model);
  const apps = layout.xdata ?? [];
  const i = app === undefined ? -1 : apps.findIndex((a) => a.appId === app);
  if (!on && i < 0) return undefined;
  app ??= b.addTableRecord('appIds', { name: PLOT_TRANSPARENCY_APP, flags: 0 }).handle;
  const value = { code: 1071, value: on ? 1 : 0 } as const;
  if (i < 0) return [...apps, { appId: app, values: [value] }];
  const old = apps[i]!.values;
  const at = old.findIndex((v) => v.code === 1071);
  const values = at < 0 ? [value, ...old] : old.map((v, j) => (j === at ? value : v));
  return apps.map((a, j) => (j === i ? { appId: app, values } : a));
}
