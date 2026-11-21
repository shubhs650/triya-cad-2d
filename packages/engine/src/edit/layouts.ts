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
//     device in Options, which Triya has no list of. The new layout has no viewport: it gets one
//     the first time it is shown (LAYOUTCREATEVIEWPORT, M6-06: commands/layout-init.ts).
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
import type { EntityId } from '../model/entity-ids';
import type { Entity, HeaderValue, Layout, LayoutPlot, ObjectCommon, Xdata } from '../model/types';
import { metric } from './center-settings';
import { blockDrawOrder, sortTableOf } from './draw-order';
import { copiedProps, copyObjects, refusalMessages } from './edit';
import { moveBy } from './similarity';

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
 * Puts `layout` at tab `at` (1 first; past the last puts it last) among `sheets` (the paper
 * layouts in tab order, `layout` among them or not) and numbers the tabs 1 to N, as AutoCAD keeps
 * them (and the save requires, M1-75 part 20): dragging a tab, the Move or Copy dialog.
 */
export function placeLayout(
  b: ChangeSetBuilder,
  sheets: readonly Layout[],
  layout: Layout,
  at: number,
): void {
  const order = sheets.filter((l) => l.handle !== layout.handle);
  order.splice(Math.max(0, Math.min(order.length, at - 1)), 0, layout);
  order.forEach((l, i) => {
    if (l.tabOrder !== i + 1) b.updateLayout(l.handle, { tabOrder: i + 1 });
  });
}

/**
 * LAYOUT Copy's default name: "the name of the copied layout with an incremental number in
 * parentheses" (AutoCAD 2024 Help), the lowest from 2 no layout has.
 */
export function copyLayoutName(model: DocumentModel, source: Layout): string {
  let n = 2;
  while (layoutNamed(model, `${source.name} (${n})`)) n++;
  return `${source.name} (${n})`;
}

/** What a layout copy made, and what it left out. */
export interface LayoutCopy {
  readonly layout: Layout;
  /** Reason → how many objects of the sheet it kept out (`copyObjects`'). */
  readonly refused: ReadonlyMap<string, number>;
  /** Copies of annotative objects made without their annotation scales. */
  readonly unannotated: number;
  /** Copied viewports whose source has layer overrides (VP Color and the rest) not copied. */
  readonly withoutOverrides: number;
}

/**
 * LAYOUT Copy (and the Move or Copy dialog's Create a copy): a new layout named `name` at tab
 * `at` (LAYOUT Copy: the copied layout's own place, "The new tab is inserted before the copied
 * layout tab"), with the copied layout's page setup, limits, flags, space and xdata and a copy of
 * everything on its sheet in its draw order (the copies' new handles keep it, so no draw order
 * table is needed). Its viewports keep their ids (DXF 69) and stacking (68): AutoCAD's files
 * number each layout's viewports from 1 (sample_AC1032: every layout has 1 and 2). A clipped
 * viewport comes with its boundary's copy. Layer overrides of the copied viewports are not copied
 * yet: the save cannot write new ones until M6-02's VPLAYER writer (said so).
 */
export function copyLayout(
  b: ChangeSetBuilder,
  model: DocumentModel,
  source: Layout,
  name: string,
  at: number = paperLayouts(model).findIndex((l) => l.handle === source.handle) + 1,
): LayoutCopy {
  const setup = newLayoutSetup(model);
  const layout = b.addLayout({
    name,
    ...(source.flags !== undefined && { flags: source.flags }),
    limits: source.limits ?? setup.limits,
    plot: source.plot ?? setup.plot,
    ...(source.space && { space: source.space }),
  });
  if (source.xdata) b.updateLayout(layout.handle, { xdata: source.xdata });
  placeLayout(b, paperLayouts(model), b.layout(layout.handle) ?? layout, at);

  const order = blockDrawOrder(
    model,
    source.blockRecord,
    sortTableOf(b, model, source.blockRecord),
  ).map((o) => o.id);
  // The layout's own paper-space viewport (69 = 1) is no object COPY takes: it is the sheet's
  // view, copied as it is, first (it draws nothing, so its place in the draw order is moot).
  const copies = new Map<Handle, Entity>();
  const rest: EntityId[] = [];
  for (const id of order) {
    const e = model.entity(id)!;
    if (e.geom.kind !== 'VIEWPORT' || e.geom.id !== 1) {
      rest.push(id);
      continue;
    }
    const geom = e.geom;
    copies.set(
      e.handle,
      b.addEntity({ ...copiedProps(b, e, true), owner: layout.blockRecord, geom }),
    );
  }
  const report = copyObjects(b, model, rest, moveBy({ x: 0, y: 0 }), {}, layout.blockRecord);
  for (const [h, copy] of report.copies) copies.set(h, copy);
  const overridden = new Set<Handle>();
  for (const l of model.tables.layers.values())
    for (const o of l.viewportOverrides ?? []) overridden.add(o.viewport);
  let withoutOverrides = 0;
  for (const [h, copy] of copies) {
    const g = model.entityByHandle(h)?.geom;
    if (g?.kind !== 'VIEWPORT' || copy.geom.kind !== 'VIEWPORT') continue;
    const now = b.entity(copy.id)!.geom;
    if (now.kind === 'VIEWPORT' && (now.id !== g.id || now.status !== g.status))
      b.updateEntity(copy.id, { geom: { ...now, id: g.id, status: g.status } });
    if (overridden.has(h)) withoutOverrides++;
  }
  return {
    layout: b.layout(layout.handle) ?? layout,
    refused: report.refused,
    unannotated: report.unannotated,
    withoutOverrides,
  };
}

/** The command-line lines for what a layout copy left out. */
export function copyMessages(c: LayoutCopy): string[] {
  const out = refusalMessages(c.refused, 'copied');
  if (c.unannotated > 0) {
    const n = c.unannotated;
    out.push(
      `${n} ${n === 1 ? 'copy is' : 'copies are'} not annotative (annotative copies are not saved yet).`,
    );
  }
  if (c.withoutOverrides > 0) {
    const n = c.withoutOverrides;
    out.push(
      `${n} ${n === 1 ? 'viewport was' : 'viewports were'} copied without ${n === 1 ? 'its' : 'their'} layer overrides (not saved yet).`,
    );
  }
  return out;
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

const isPlotTransparencyApp = (a: { readonly name: string }): boolean =>
  a.name.toUpperCase() === PLOT_TRANSPARENCY_APP;

/** The 1071 value of `app`'s xdata on `x`, non-zero. */
function transparencyIn(app: Handle | undefined, x: Pick<ObjectCommon, 'xdata'>): boolean {
  const values = app === undefined ? undefined : x.xdata?.find((d) => d.appId === app)?.values;
  const on = values?.find((v) => v.code === 1071)?.value;
  return typeof on === 'bigint' ? on !== 0n : typeof on === 'number' && on !== 0;
}

/**
 * A layout's "Plot transparency" (or a named page setup's, M6-01 part 3): its PLOTTRANSPARENCY
 * xdata's first 1071 value, non-zero.
 */
export function plotTransparencyOf(
  model: DocumentModel,
  layout: Pick<ObjectCommon, 'xdata'>,
): boolean {
  return transparencyIn(
    [...model.tables.appIds.values()].find(isPlotTransparencyApp)?.handle,
    layout,
  );
}

/**
 * The same, with the applications as change `b` leaves the drawing so far: a page setup made in
 * it may name the application it registers (M6-01 part 3, New then Set Current).
 */
export function plotTransparencyIn(b: ChangeSetBuilder, x: Pick<ObjectCommon, 'xdata'>): boolean {
  return transparencyIn([...b.tableRecords('appIds')].find(isPlotTransparencyApp)?.handle, x);
}

/**
 * The layout's xdata with "Plot transparency" set to `on` (M6-04 part 2, Apply to Layout),
 * registering PLOTTRANSPARENCY when the drawing has no such application; undefined when it is so
 * already (a layout without the xdata is off). Off keeps the application with 0, as AutoCAD writes.
 * The application is looked for as `b` leaves the drawing, so that one change set registers it
 * once.
 */
export function withPlotTransparency(
  b: ChangeSetBuilder,
  _model: DocumentModel,
  layout: Pick<ObjectCommon, 'xdata'>,
  on: boolean,
): Xdata | undefined {
  let app = [...b.tableRecords('appIds')].find(isPlotTransparencyApp)?.handle;
  if (transparencyIn(app, layout) === on) return undefined;
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
