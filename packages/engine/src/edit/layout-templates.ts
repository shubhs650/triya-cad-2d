// Layouts carried between drawings (M6-01 part 4): LAYOUT Template and SAveas (AutoCAD 2024 Help,
// "LAYOUT (Command)"):
//
//   - Template: "Creates a new layout based on an existing layout in a template (DWT), drawing
//     (DWG), or drawing interchange (DXF) file. ... After you select a layout, the layout and all
//     objects from the specified template or drawing file are inserted into the current drawing."
//   - SAveas: "Saves a layout as a drawing template (DWT) file without saving any unreferenced
//     symbol table and block definition information."
//
// A `LayoutTemplate` is plain data, as the Clipboard is (it crosses from the drawing read to the
// drawing's engine by structured clone): the layout's page setup, limits, flags and space, and
// everything on its sheet, its viewports with it, carried as COPYCLIP carries objects between
// drawings (records matched by name, the ones the target lacks brought along). Its objects keep
// their place and size: a sheet is drawn in paper units, which the page setup gives, so a paste
// between drawings of other units does not scale them. They come in their draw order (the
// copies' new handles keep it, as LAYOUT Copy's do), and the viewports keep their ids (DXF 69).
//
// Ambiguities, settled for the common drafter expectation and noted in the PR:
// - a name the drawing has already takes LAYOUT Copy's next free "Name (2)";
// - a page setup plotting a named view the drawing lacks plots the layout instead, and a standard
//   scale comes as the custom scale of the same ratio (`settingsIn`);
// - the viewports' layer overrides are not carried (their writer is M6-02's VPLAYER), said so.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { EntityId } from '../model/entity-ids';
import type { Layout, LayoutPlot, SortEntsTable } from '../model/types';
import { copyToClipboard, pasteObjects, type Clipboard } from './clipboard';
import { blockDrawOrder } from './draw-order';
import { refusalMessages } from './edit';
import {
  layoutNamed,
  newLayoutSetup,
  paperLayouts,
  plotTransparencyOf,
  withPlotTransparency,
} from './layouts';

/** A layout as LAYOUT Template inserts it and SAveas writes it. */
export interface LayoutTemplate {
  readonly name: string;
  readonly flags?: number;
  readonly limits?: Layout['limits'];
  readonly plot?: LayoutPlot;
  readonly space?: Layout['space'];
  /** The page setup's "Plot transparency" (the layout's PLOTTRANSPARENCY xdata, M6-04). */
  readonly plotTransparency: boolean;
  /** Everything on its sheet, its viewports with it, in its draw order. */
  readonly content: Clipboard;
  /** How many of its viewports have layer overrides, which are not carried. */
  readonly withOverrides: number;
}

/** A template taken from a drawing, and what it left out. */
export interface LayoutTemplateCopy {
  readonly template: LayoutTemplate;
  /** Reason → how many objects of the sheet it kept out. */
  readonly refused: ReadonlyMap<string, number>;
  /** Annotative objects carried without their annotation scales. */
  readonly unannotated: number;
}

/** What inserting a template made. */
export interface LayoutInserted {
  readonly layout: Layout;
  /** The objects pasted on its sheet. */
  readonly ids: readonly EntityId[];
}

/** The SORTENTSTABLE of `block` as the drawing holds it. */
function sortTable(model: DocumentModel, block: Handle): SortEntsTable | undefined {
  for (const o of model.objects.values()) {
    if (o.type === 'SORTENTSTABLE' && (o as SortEntsTable).block === block) {
      return o as SortEntsTable;
    }
  }
  return undefined;
}

/** `layout` of `model` as a template: its settings and its sheet's objects. */
export function layoutTemplate(model: DocumentModel, layout: Layout): LayoutTemplateCopy {
  const order = blockDrawOrder(model, layout.blockRecord, sortTable(model, layout.blockRecord));
  const copy = copyToClipboard(
    model,
    order.map((o) => o.id),
    { x: 0, y: 0 },
    undefined,
    [],
    { viewports: true },
  );
  // The Clipboard is in block order; the sheet is drawn in draw order.
  const rank = new Map(order.map((o, i) => [model.ids.handleOf(o.id)!, i]));
  const entities = [...copy.clipboard.entities].sort(
    (a, b) => (rank.get(a.handle) ?? 0) - (rank.get(b.handle) ?? 0),
  );
  const carried = new Set(entities.map((e) => e.handle));
  let withOverrides = 0;
  const overridden = new Set<Handle>();
  for (const l of model.tables.layers.values())
    for (const o of l.viewportOverrides ?? []) overridden.add(o.viewport);
  for (const h of overridden) if (carried.has(h)) withOverrides++;
  return {
    template: {
      name: layout.name,
      ...(layout.flags !== undefined && { flags: layout.flags }),
      ...(layout.limits && { limits: layout.limits }),
      ...(layout.plot && { plot: layout.plot }),
      ...(layout.space && { space: layout.space }),
      plotTransparency: plotTransparencyOf(model, layout),
      content: { ...copy.clipboard, entities },
      withOverrides,
    },
    refused: copy.refused,
    unannotated: copy.unannotated,
  };
}

/** Every paper layout of `model` as a template, in tab order (the Insert Layout(s) list). */
export function layoutTemplates(model: DocumentModel): LayoutTemplateCopy[] {
  return paperLayouts(model).map((l) => layoutTemplate(model, l));
}

/**
 * The name a template takes in `model`: its own, else LAYOUT Copy's next "Name (n)"; `taken`
 * (upper case) holds the names of layouts inserted with it.
 */
export function templateLayoutName(
  model: DocumentModel,
  name: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const free = (n: string) => !layoutNamed(model, n) && !taken.has(n.toUpperCase());
  if (free(name)) return name;
  let n = 2;
  while (!free(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

/** The command-line lines for what inserting (or writing) templates left out. */
export function templateMessages(
  copies: readonly LayoutTemplateCopy[],
  verb: 'inserted' | 'written',
): string[] {
  const refused = new Map<string, number>();
  let unannotated = 0;
  let withOverrides = 0;
  for (const c of copies) {
    for (const [reason, n] of c.refused) refused.set(reason, (refused.get(reason) ?? 0) + n);
    unannotated += c.unannotated;
    withOverrides += c.template.withOverrides;
  }
  const out = refusalMessages(refused, verb);
  if (unannotated > 0) {
    const n = unannotated;
    out.push(
      `${n} ${n === 1 ? 'object is' : 'objects are'} not annotative (annotative copies are not saved yet).`,
    );
  }
  if (withOverrides > 0) {
    const n = withOverrides;
    out.push(
      `${n} ${n === 1 ? 'viewport was' : 'viewports were'} ${verb} without ${n === 1 ? 'its' : 'their'} layer overrides (not saved yet).`,
    );
  }
  return out;
}

/** DXF 72 flag 16: the layout plots at the standard scale DXF 75 names. */
const STANDARD_SCALE = 16;

/**
 * The page setup and limits a template's layout takes in `model`: its own, as far as the save
 * writes them for a new layout (export layouts.ts), which checks a page setup only against the
 * drawing's own. A standard scale (flag 16, DXF 75) plots as the custom scale of the same ratio
 * (DXF 142 / 143 hold it either way); a paper of no size (ezdxf leaves 0 x 0) or limits that are
 * no rectangle are the units' own sheet's, as LAYOUT New's; a named view the drawing lacks
 * plots the layout instead.
 */
function settingsIn(
  model: DocumentModel,
  template: LayoutTemplate,
): { plot: LayoutPlot; limits: NonNullable<Layout['limits']> } {
  const setup = newLayoutSetup(model);
  const l = template.limits;
  const limits = l && l.max.x > l.min.x && l.max.y > l.min.y ? l : setup.limits;
  let plot = template.plot;
  if (!plot || !(plot.paperWidth > 0 && plot.paperHeight > 0)) return { plot: setup.plot, limits };
  if ((plot.flags & STANDARD_SCALE) !== 0 && plot.standardScaleType !== 0) {
    const { standardScaleType: _type, ...rest } = plot;
    plot = { ...rest, flags: plot.flags & ~STANDARD_SCALE };
  }
  if (plot.viewName !== undefined && plot.viewName !== '') {
    const upper = plot.viewName.toUpperCase();
    if (![...model.tables.views.values()].some((v) => v.name.toUpperCase() === upper)) {
      const { viewName: _view, ...rest } = plot;
      plot = { ...rest, plotType: plot.plotType === 3 ? 5 : plot.plotType };
    }
  }
  return { plot, limits };
}

/**
 * LAYOUT Template: `template` inserted into `model` as a new layout named `name`, after the last
 * tab, with its objects on the new sheet. `into` (SAveas's new drawing): that layout takes the
 * template instead, renamed, its sheet holding the objects.
 */
export function insertLayoutTemplate(
  b: ChangeSetBuilder,
  model: DocumentModel,
  template: LayoutTemplate,
  name: string,
  into?: Layout,
): LayoutInserted {
  const settings = {
    ...(template.flags !== undefined && { flags: template.flags }),
    ...settingsIn(model, template),
    ...(template.space && { space: template.space }),
  };
  let layout = into
    ? b.updateLayout(into.handle, { name, ...settings })
    : b.addLayout({ name, ...settings });
  const xdata = withPlotTransparency(b, model, layout, template.plotTransparency);
  if (xdata) layout = b.updateLayout(layout.handle, { xdata });
  // Unscaled: the source's units are not the target's paper units' business.
  const { insUnits: _units, ...content } = template.content;
  const report = pasteObjects(b, model, content, layout.blockRecord, { x: 0, y: 0 });
  // A clipped viewport's boundary names it among its reactors, as VPCLIP leaves them (the
  // Clipboard carries no reactors).
  for (const id of report.ids) {
    const g = b.entity(id)?.geom;
    if (g?.kind !== 'VIEWPORT' || g.clipBoundary === undefined) continue;
    const boundary = report.ids.map((i) => b.entity(i)!).find((e) => e.handle === g.clipBoundary);
    const viewport = b.entity(id)!.handle;
    if (boundary && !(boundary.reactors ?? []).includes(viewport))
      b.updateEntity(boundary.id, { reactors: [...(boundary.reactors ?? []), viewport] });
  }
  return { layout: b.layout(layout.handle) ?? layout, ids: report.ids };
}
