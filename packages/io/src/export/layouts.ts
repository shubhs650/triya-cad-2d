// TriyaToAcad for LAYOUT objects (M1-75 part 20), the inverse of map/layouts.ts: what LAYOUT
// Rename, dragging a layout tab, LIMITS in a layout, PSLTSCALE and PAGESETUP change. A layout's
// name is both its DXF 1 and its ACAD_LAYOUT dictionary entry, so a rename changes both, the
// entry in place (M1-95); everything else points at the layout by handle.
//
// AutoCAD keeps the current space's limits and flags twice: the Model layout's in $LIMMIN /
// $LIMMAX and $LIMCHECK, the current paper layout's (the one on *Paper_Space) in $PLIMMIN /
// $PLIMMAX, $PLIMCHECK and $PSLTSCALE. LIMITS and PSLTSCALE set both, so where the drawing's
// header agreed with its layout, a change to the layout must change the header alike.
//
// Refused, before anything changes: adding or removing a layout (its block record and
// definition come with it: LAYOUT New and Delete, M6), a layout moving to another block record
// (AutoCAD swaps *Paper_Space between layouts only when another one is made current), any
// layout change before R2000, which introduced layouts, values AutoCAD does not take, and
// xdata, reactor and extension dictionary changes.

import {
  ACadVersion,
  Layout as AcadLayout,
  PaperMargin,
  XY,
  type CadDocument,
} from '@node-projects/acad-ts';
import type {
  BlockTableRecord,
  DocumentInit,
  DocumentModel,
  Handle,
  HeaderValue,
  Layout,
  LayoutPlot,
  Vec2,
} from '@triya/engine';
import { entryRenameProblems, renameEntries } from './dictionary-entries';
import { resolve, same, type Resolver } from './entities';

export interface LayoutsPlan {
  readonly updated: {
    readonly acad: AcadLayout;
    readonly before: Layout;
    readonly after: Layout;
  }[];
}

/** DXF 70 of AcDbLayout: 1 PSLTSCALE, 2 LIMCHECK. */
const LAYOUT_FLAGS = 1 | 2;

/** The PLOTSETTINGS 70 bits the DXF reference defines (256 is not one). */
const PLOT_FLAGS = 0x7fff & ~256;
const STANDARD_SCALE = 16;
const MODEL_TYPE = 1024;

/** DXF 72. */
const PAPER_UNITS: readonly LayoutPlot['paperUnits'][] = ['inches', 'millimeters', 'pixels'];
const ACAD_PAPER_UNITS = { inches: 0, millimeters: 1, pixels: 2 } as const;

/**
 * Characters AutoCAD does not allow in a layout name (LAYOUT Rename): < > / \ " : ; ? * | , = `
 * ("Layout names … cannot contain" them; `*` anywhere, unlike a table record's leading `*`).
 */
const INVALID_NAME = /[<>/\\":;?*|,=`]/;
/** "Layout names can contain up to 255 characters." */
const NAME_LENGTH = 255;

/** Fields no writer handles yet. */
const UNSUPPORTED = ['xdata', 'reactors', 'extDict'] as const;

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

const hex = (n: number): Handle => n.toString(16).toUpperCase();

const finite = (...ns: unknown[]): boolean =>
  ns.every((n) => typeof n === 'number' && Number.isFinite(n));

const flagOn = (v: HeaderValue | undefined): boolean => v === true || v === 1;

const sameXY = (a: HeaderValue | undefined, b: Vec2 | undefined): boolean =>
  typeof a === 'object' && b !== undefined && a.x === b.x && a.y === b.y;

/** The layout's space: model, the current paper layout's *Paper_Space, or another sheet. */
function spaceOf(
  l: Layout,
  records: ReadonlyMap<Handle, BlockTableRecord>,
): 'model' | 'paper' | 'other' {
  const name = records.get(l.blockRecord)?.name.toUpperCase();
  if (name === '*MODEL_SPACE') return 'model';
  if (name === '*PAPER_SPACE') return 'paper';
  return 'other';
}

/** The header variables that state a current layout's limits and flags. */
const HEADER = {
  model: { min: '$LIMMIN', max: '$LIMMAX', check: '$LIMCHECK', ltscale: undefined },
  paper: { min: '$PLIMMIN', max: '$PLIMMAX', check: '$PLIMCHECK', ltscale: '$PSLTSCALE' },
} as const;

/** The model's layout changes against the original's mapping, and why any cannot be written. */
export function planLayouts(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: LayoutsPlan; problems: string[] } {
  const plan: LayoutsPlan = { updated: [] };
  const problems: string[] = [];
  const version = doc.header?.version;
  const before = new Map((base.layouts ?? []).map((l) => [l.handle, l]));
  const after = new Map(model.layouts.map((l) => [l.handle, l]));
  for (const [h, b] of before)
    if (!after.has(h)) problems.push(`layout ${b.name} (${h}): removing a layout`);

  const baseRecords = new Map((base.tables?.blockRecords ?? []).map((b) => [b.handle, b]));
  const baseHeader = new Map(base.header ?? []);
  // Names are unique without regard to case, among the layouts the drawing ends up with.
  const names = new Map<string, number>();
  for (const l of after.values()) {
    const key = String(l.name).toUpperCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  let tabsChange = false;
  for (const [h, a] of after) {
    const b = before.get(h);
    if (b && same(b, a)) continue;
    const label = `layout ${a.name} (${h})`;
    if (!b) {
      problems.push(`${label}: adding a layout`);
      continue;
    }
    if (known(version) && version < ACadVersion.AC1015) {
      problems.push(`${label}: ${ACadVersion[version]} has no layouts (R2000 added them)`);
      continue;
    }
    const out: string[] = [];
    const acad = resolve(r, h, AcadLayout);
    if (!acad) out.push('the original is not a LAYOUT');
    const space = spaceOf(b, baseRecords);
    if (b.blockRecord !== a.blockRecord) out.push('blockRecord: a layout keeps its block record');
    for (const k of UNSUPPORTED) if (!same(b[k], a[k])) out.push(`${k} changes`);
    if (b.name !== a.name) out.push(...nameProblems(b, a, space, names, acad, model));
    if (b.tabOrder !== a.tabOrder) {
      tabsChange = true;
      if (!Number.isInteger(a.tabOrder))
        out.push(`tabOrder: ${JSON.stringify(a.tabOrder)} is not a whole number`);
      else if (space === 'model' && a.tabOrder !== 0)
        out.push('the Model tab is always first (tab order 0)');
    }
    if (!same(b.flags, a.flags) && !validFlags(a.flags))
      out.push(
        `flags: ${JSON.stringify(a.flags)} has bits other than 1 (PSLTSCALE) and 2 (LIMCHECK)`,
      );
    if (!same(b.limits, a.limits)) out.push(...limitsProblems(a.limits));
    if (!same(b.plot, a.plot)) out.push(...plotProblems(b.plot, a.plot, space));
    if (space !== 'other') {
      out.push(...headerProblems(b, a, HEADER[space], baseHeader, model.header));
    }
    if (out.length > 0) problems.push(...out.map((p) => `${label}: ${p}`));
    else plan.updated.push({ acad: acad!, before: b, after: a });
  }
  if (tabsChange) {
    // AutoCAD numbers the layout tabs 1 to N after the Model tab.
    const tabs = [...after.values()]
      .filter((l) => spaceOf(l, baseRecords) !== 'model')
      .map((l) => l.tabOrder)
      .sort((x, y) => x - y);
    if (!tabs.every((t, i) => t === i + 1))
      problems.push(`layout tabs: the layouts' tab orders are not 1 to ${tabs.length}, each once`);
  }
  return { plan, problems };
}

function nameProblems(
  b: Layout,
  a: Layout,
  space: 'model' | 'paper' | 'other',
  names: ReadonlyMap<string, number>,
  acad: AcadLayout | undefined,
  model: DocumentModel,
): string[] {
  const name = a.name;
  if (space === 'model' || b.name.toUpperCase() === AcadLayout.modelLayoutName.toUpperCase())
    return ['the Model layout cannot be renamed'];
  if (typeof name !== 'string' || name === '') return ['a layout needs a name'];
  if (name.toUpperCase() === AcadLayout.modelLayoutName.toUpperCase())
    return ["Model is the model layout's name"];
  if ((names.get(name.toUpperCase()) ?? 0) > 1) return [`another layout is named ${name}`];
  if (INVALID_NAME.test(name) || name.length > NAME_LENGTH)
    return [`${JSON.stringify(name)} is not a valid layout name`];
  if (!acad) return [];
  const layouts = new Set(model.layouts.map((l) => l.handle));
  return entryRenameProblems(acad, name, (o) => layouts.has(hex(o.handle)));
}

const validFlags = (f: unknown): boolean =>
  f === undefined || (Number.isInteger(f) && ((f as number) & ~LAYOUT_FLAGS) === 0);

/** LIMITS: "Invalid limits." unless the upper right corner is above and right of the lower left. */
function limitsProblems(l: Layout['limits']): string[] {
  if (!l) return ['limits: a layout keeps its limits'];
  if (!finite(l.min?.x, l.min?.y, l.max?.x, l.max?.y)) return ['limits: each value is a number'];
  if (!(l.max.x > l.min.x && l.max.y > l.min.y))
    return ['limits: the upper right corner is not above and right of the lower left'];
  return [];
}

/** What PAGESETUP does not take, in the page setup fields that change. */
function plotProblems(
  b: LayoutPlot | undefined,
  a: LayoutPlot | undefined,
  space: 'model' | 'paper' | 'other',
): string[] {
  if (!a) return ['plot: a layout keeps its page setup'];
  const out: string[] = [];
  const changed = (k: keyof LayoutPlot) => !b || !same(b[k], a[k]);
  if (changed('paperSize') && typeof a.paperSize !== 'string')
    out.push(`paperSize: ${JSON.stringify(a.paperSize)} is not text`);
  for (const k of ['paperWidth', 'paperHeight'] as const) {
    if (changed(k) && !(finite(a[k]) && a[k] > 0))
      out.push(`${k}: ${JSON.stringify(a[k])} is not a number more than 0`);
  }
  if (changed('margins')) {
    const m = a.margins;
    const values = [m?.left, m?.bottom, m?.right, m?.top];
    if (!finite(...values) || values.some((v) => (v as number) < 0))
      out.push('margins: each value is a number of 0 or more');
  }
  if (changed('paperUnits') && !PAPER_UNITS.includes(a.paperUnits))
    out.push(
      `paperUnits: ${JSON.stringify(a.paperUnits)} is not ${PAPER_UNITS.join(', ').replace(/, (?=[^,]*$)/, ' or ')}`,
    );
  if (changed('rotation') && ![0, 1, 2, 3].includes(a.rotation))
    out.push(`rotation: ${JSON.stringify(a.rotation)} is not 0, 1, 2 or 3`);
  if (changed('origin') && !finite(a.origin?.x, a.origin?.y))
    out.push('origin: each value is a number');
  if (changed('scale')) {
    const s = a.scale;
    if (!(finite(s?.numerator, s?.denominator) && s.numerator > 0 && s.denominator > 0))
      out.push('scale: each value is a number more than 0');
    else if (Number.isInteger(a.flags) && (a.flags & STANDARD_SCALE) !== 0)
      out.push(
        'scale: the layout plots at a standard scale (flag 16), which DXF 75 names; clear the flag for a custom scale',
      );
  }
  if (changed('plotType')) {
    // DXF 74: 0 last screen display, 1 extents, 2 limits, 3 view, 4 window, 5 layout.
    const t = a.plotType;
    if (!(Number.isInteger(t) && t >= 0 && t <= 5))
      out.push(`plotType: ${JSON.stringify(t)} is not a whole number from 0 to 5`);
    else if (t === 3) out.push('plotType: 3 (View) needs the view name, which Triya does not map');
    else if (t === 4) out.push('plotType: 4 (Window) needs the window, which Triya does not map');
    else if (t === 5 && space === 'model')
      out.push('plotType: the Model layout has no layout to plot (5)');
  }
  if (changed('flags')) {
    const f = a.flags;
    const was = b?.flags ?? 0;
    if (!Number.isInteger(f) || f < 0)
      out.push(`flags: ${JSON.stringify(f)} is not a whole number of 0 or more`);
    else if ((f & ~PLOT_FLAGS) !== 0)
      out.push(`flags: ${f} has bits AutoCAD does not define (${f & ~PLOT_FLAGS})`);
    else if ((f & MODEL_TYPE) !== (was & MODEL_TYPE))
      out.push("flags: ModelType (1024) marks the Model layout's page setup and cannot change");
    else if ((f & STANDARD_SCALE) !== 0 && (was & STANDARD_SCALE) === 0)
      out.push(
        'flags: a standard scale (16) is chosen by DXF 75, which Triya does not map; a custom scale leaves 16 off',
      );
  }
  return out;
}

/**
 * Where the drawing's header stated the current layout's limits or flags, a change to them
 * must change the header alike (and the other way round is the header writer's: part 6).
 */
function headerProblems(
  b: Layout,
  a: Layout,
  vars: (typeof HEADER)[keyof typeof HEADER],
  baseHeader: ReadonlyMap<string, HeaderValue>,
  header: ReadonlyMap<string, HeaderValue>,
): string[] {
  const out: string[] = [];
  const agreed = (bit: number, name: string, h: ReadonlyMap<string, HeaderValue>, l: Layout) =>
    flagOn(h.get(name)) === (((l.flags ?? 0) & bit) !== 0);
  if (
    !same(b.limits, a.limits) &&
    sameXY(baseHeader.get(vars.min), b.limits?.min) &&
    sameXY(baseHeader.get(vars.max), b.limits?.max) &&
    !(sameXY(header.get(vars.min), a.limits?.min) && sameXY(header.get(vars.max), a.limits?.max))
  )
    out.push(`limits: ${vars.min} and ${vars.max} state the current layout's; change them alike`);
  const flag = (bit: number, what: string, name: string | undefined) => {
    if (name === undefined || ((b.flags ?? 0) & bit) === ((a.flags ?? 0) & bit)) return;
    if (agreed(bit, name, baseHeader, b) && !agreed(bit, name, header, a))
      out.push(`${what} (flag ${bit}): ${name} states the current layout's; change it alike`);
  };
  flag(1, 'PSLTSCALE', vars.ltscale);
  flag(2, 'LIMCHECK', vars.check);
  return out;
}

/** Writes the planned layout changes onto their originals; renames go first, as names may swap. */
export function writeLayouts(plan: LayoutsPlan): void {
  const renamed = plan.updated.filter(({ before, after }) => before.name !== after.name);
  renameEntries(renamed.map(({ acad, after }) => ({ acad, name: after.name })));
  for (const { acad, after } of renamed) acad.name = after.name;
  for (const { acad, before: b, after: a } of plan.updated) {
    const changed = <K extends keyof Layout>(k: K) => !same(b[k], a[k]);
    if (changed('tabOrder')) acad.tabOrder = a.tabOrder;
    if (changed('flags')) acad.layoutFlags = (a.flags ?? 0) as never;
    if (changed('limits') && a.limits) {
      acad.minLimits = new XY(a.limits.min.x, a.limits.min.y);
      acad.maxLimits = new XY(a.limits.max.x, a.limits.max.y);
    }
    if (changed('plot') && a.plot) writePlot(acad, b.plot, a.plot);
  }
}

function writePlot(acad: AcadLayout, b: LayoutPlot | undefined, a: LayoutPlot): void {
  const changed = (k: keyof LayoutPlot) => !b || !same(b[k], a[k]);
  if (changed('paperSize')) acad.paperSize = a.paperSize;
  if (changed('paperWidth')) acad.paperWidth = a.paperWidth;
  if (changed('paperHeight')) acad.paperHeight = a.paperHeight;
  if (changed('margins')) {
    const m = a.margins;
    acad.unprintableMargin = new PaperMargin(m.left, m.bottom, m.right, m.top);
  }
  if (changed('paperUnits')) acad.paperUnits = ACAD_PAPER_UNITS[a.paperUnits] as never;
  if (changed('rotation')) acad.paperRotation = a.rotation as never;
  if (changed('origin')) {
    acad.plotOriginX = a.origin.x;
    acad.plotOriginY = a.origin.y;
  }
  if (changed('scale')) {
    acad.numeratorScale = a.scale.numerator;
    acad.denominatorScale = a.scale.denominator;
  }
  if (changed('plotType')) acad.plotType = a.plotType as never;
  if (changed('flags')) acad.flags = a.flags as never;
}
