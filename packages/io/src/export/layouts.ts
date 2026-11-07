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
// LAYOUT New and Delete (part 28): a new layout joins ACAD_LAYOUT under the engine's handle, on
// the new `*Paper_Space` block the same save adds (blocks.ts), linked both ways; a removed one
// leaves ACAD_LAYOUT, and its block, with everything on its sheet, goes as PURGE takes a block
// (purge.ts). AutoCAD sets every layout up for plotting, so a new one states its limits and
// page setup.
//
// Making another layout current (part 30): AutoCAD swaps the names of the two sheet blocks, so the
// new current layout's block becomes *Paper_Space and the old one's takes its name (the blocks
// keep their handles, and DXF then writes the new current sheet's entities in ENTITIES); the
// header's $P… variables, which hold the current layout's limits, flags and space, take the new
// current layout's, and the layout that was current keeps them in its LAYOUT. The layout that was
// current may then be deleted, as AutoCAD deletes the current layout once another is current.
//
// Refused, before anything changes: removing the Model layout, or the current layout while no
// other one is made current; a layout removed without its block or added without a new one; a
// layout moving to another block record; sheet block names changing other than by that swap
// (blocks.ts), or a layout the same save adds made current; a named paper-space UCS (DXF 345 / 346,
// $PUCSNAME, which Triya does not map) on a switch; any layout change before R2000, which
// introduced layouts; values AutoCAD does not take; and xdata, reactor and extension dictionary
// changes.

import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  Layout as AcadLayout,
  PaperMargin,
  XY,
  XYZ,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type {
  BlockTableRecord,
  DocumentInit,
  DocumentModel,
  Handle,
  HeaderValue,
  Layout,
  LayoutPlot,
  LayoutSpace,
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
  /** New layouts, each made on the block record the same save adds. */
  readonly added: Layout[];
  readonly removed: AcadLayout[];
  /** Another layout made current: its block, which takes the name *Paper_Space (part 30). */
  readonly current?: BlockRecord;
  /**
   * The sheet blocks whose names swap as another layout is made current, which this file checks
   * and writes, not blocks.ts (also when the switch is refused: the problems say why here).
   */
  readonly swapping: ReadonlySet<Handle>;
}

/** The sheet block of a layout other than the current one: `*Paper_Space` and a number. */
const SHEET_BLOCK = /^\*paper_space\d+$/i;

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

/** The name of the current paper layout's block. */
const CURRENT_SHEET = '*PAPER_SPACE';

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

/** The header variables that state a current layout's limits, flags and space. */
const HEADER = {
  model: {
    min: '$LIMMIN',
    max: '$LIMMAX',
    check: '$LIMCHECK',
    ltscale: undefined,
    space: ['$INSBASE', '$EXTMIN', '$EXTMAX', '$ELEVATION', '$UCSORG', '$UCSXDIR', '$UCSYDIR'],
  },
  paper: {
    min: '$PLIMMIN',
    max: '$PLIMMAX',
    check: '$PLIMCHECK',
    ltscale: '$PSLTSCALE',
    space: [
      '$PINSBASE',
      '$PEXTMIN',
      '$PEXTMAX',
      '$PELEVATION',
      '$PUCSORG',
      '$PUCSXDIR',
      '$PUCSYDIR',
    ],
  },
} as const;

/** The `LayoutSpace` values in the order of `HEADER[…].space`. */
const spaceValues = (s: LayoutSpace | undefined): (HeaderValue | undefined)[] =>
  s
    ? [
        s.insertionBase,
        s.extents.min,
        s.extents.max,
        s.elevation,
        s.ucs.origin,
        s.ucs.xAxis,
        s.ucs.yAxis,
      ]
    : [];

/** Whether a header variable states value `v` (a point by its X, Y and Z; Z 0 when it has none). */
function states(h: HeaderValue | undefined, v: HeaderValue | undefined): boolean {
  if (v === undefined || h === undefined) return false;
  if (typeof v === 'boolean') return flagOn(h) === v;
  if (typeof v !== 'object' || typeof h !== 'object') return h === v;
  const z = (p: object) => ('z' in p && typeof p.z === 'number' ? p.z : 0);
  return h.x === v.x && h.y === v.y && z(h) === z(v);
}

/** Each header variable of the current paper layout with what it states of layout `l`. */
function paperHeader(l: Layout): [string, HeaderValue | undefined][] {
  const v = HEADER.paper;
  const values = spaceValues(l.space);
  return [
    [v.min, l.limits?.min],
    [v.max, l.limits?.max],
    [v.check, ((l.flags ?? 0) & 2) !== 0],
    [v.ltscale, ((l.flags ?? 0) & 1) !== 0],
    ...v.space.map((name, i): [string, HeaderValue | undefined] => [name, values[i]]),
  ];
}

/** The model's layout changes against the original's mapping, and why any cannot be written. */
export function planLayouts(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
): { plan: LayoutsPlan; problems: string[] } {
  const plan: { -readonly [K in keyof LayoutsPlan]: LayoutsPlan[K] } = {
    updated: [],
    added: [],
    removed: [],
    swapping: new Set(),
  };
  const problems: string[] = [];
  const version = doc.header?.version;
  const before = new Map((base.layouts ?? []).map((l) => [l.handle, l]));
  const after = new Map(model.layouts.map((l) => [l.handle, l]));
  const noLayouts =
    known(version) && version < ACadVersion.AC1015
      ? `${ACadVersion[version]} has no layouts (R2000 added them)`
      : undefined;
  const baseRecords = new Map((base.tables?.blockRecords ?? []).map((b) => [b.handle, b]));
  const baseHeader = new Map(base.header ?? []);
  // Names are unique without regard to case, among the layouts the drawing ends up with.
  const names = new Map<string, number>();
  for (const l of after.values()) {
    const key = String(l.name).toUpperCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const switched = planCurrent(doc, base, model, r, before, after, baseRecords, noLayouts);
  problems.push(...switched.problems);
  if (switched.current) plan.current = switched.current;
  plan.swapping = switched.swapping ?? new Set();
  let tabsChange = false;
  for (const [h, b] of before) {
    if (after.has(h)) continue;
    tabsChange = true;
    const out = removalProblems(b, baseRecords, model, noLayouts, switched.from === h);
    const acad = resolve(r, h, AcadLayout);
    if (!acad) out.push('the original is not a LAYOUT');
    else if (entryKey(doc, acad) === undefined) out.push('ACAD_LAYOUT does not list it');
    if (out.length > 0) problems.push(...out.map((p) => `layout ${b.name} (${h}): ${p}`));
    else plan.removed.push(acad!);
  }
  for (const [h, a] of after) {
    const b = before.get(h);
    if (b && same(b, a)) continue;
    const label = `layout ${a.name} (${h})`;
    if (!b) {
      tabsChange = true;
      const out = additionProblems(
        doc,
        a,
        baseRecords,
        model,
        names,
        new Set(before.keys()),
        noLayouts,
      );
      if (out.length > 0) problems.push(...out.map((p) => `${label}: ${p}`));
      else plan.added.push(a);
      continue;
    }
    if (noLayouts) {
      problems.push(`${label}: ${noLayouts}`);
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
    if (!same(b.space, a.space)) out.push(...spaceProblems(a.space));
    // On a switch, which layout the header states is planCurrent's to check.
    if (space === 'model' || (space === 'paper' && !switched.from)) {
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

/**
 * Another layout made current: the paper layout the model has on *Paper_Space is not the one the
 * drawing had there. Checks that the two sheet blocks swap names, as AutoCAD swaps them, and that
 * the header, where it stated the old current layout, states the new one.
 */
function planCurrent(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver,
  before: ReadonlyMap<Handle, Layout>,
  after: ReadonlyMap<Handle, Layout>,
  baseRecords: ReadonlyMap<Handle, BlockTableRecord>,
  noLayouts: string | undefined,
): {
  current?: BlockRecord;
  from?: Handle;
  swapping?: ReadonlySet<Handle>;
  problems: string[];
} {
  const was = [...before.values()].find((l) => spaceOf(l, baseRecords) === 'paper');
  const now = [...after.values()].find(
    (l) => model.tables.blockRecords.get(l.blockRecord)?.name.toUpperCase() === CURRENT_SHEET,
  );
  if (!was || !now || was.handle === now.handle) return { problems: [] };
  const label = `layout ${now.name} (${now.handle})`;
  const kept = model.tables.blockRecords.get(was.blockRecord);
  const swapping = new Set([now.blockRecord, ...(kept ? [was.blockRecord] : [])]);
  const fail = (...out: string[]) => ({
    from: was.handle,
    swapping,
    problems: out.map((p) => `${label}: made current, ${p}`),
  });
  if (noLayouts) return fail(noLayouts);
  const sheet = baseRecords.get(was.blockRecord)!.name;
  const old = baseRecords.get(now.blockRecord);
  if (!before.has(now.handle) || !old)
    return fail('but a layout the same save adds cannot be made current yet');
  const out: string[] = [];
  if (model.tables.blockRecords.get(now.blockRecord)!.name !== sheet)
    out.push(`its block takes the name ${sheet}`);
  if (kept && kept.name !== old.name)
    out.push(`the block of the layout that was current takes ${old.name}, its block's name`);
  // A named UCS of paper space (DXF 345 / 346, $PUCSNAME / $PUCSBASE) is not mapped.
  const baseHeader = new Map(base.header ?? []);
  for (const l of [was, now]) {
    const acad = resolve(r, l.handle, AcadLayout);
    if (acad?.ucs || acad?.baseUCS)
      out.push(`layout ${l.name} has a named UCS (DXF 345 / 346), which Triya does not map`);
  }
  for (const name of ['$PUCSNAME', '$PUCSBASE']) {
    const v = baseHeader.get(name) ?? '';
    if (v !== '') out.push(`${name} names a UCS, which Triya does not keep with its layout`);
  }
  const stated = new Map(paperHeader(was));
  for (const [name, value] of paperHeader(now)) {
    if (states(baseHeader.get(name), stated.get(name)) && !states(model.header.get(name), value))
      out.push(`${name} states the current layout's; set it to ${now.name}'s`);
  }
  if (out.length > 0) return fail(...out);
  const block = resolve(r, now.blockRecord, BlockRecord);
  if (!block) return fail('its block is not a BLOCK_RECORD');
  return { current: block, from: was.handle, swapping, problems: [] };
}

/** A layout's space: every value a number. */
function spaceProblems(s: LayoutSpace | undefined): string[] {
  if (!s) return ['space: a layout keeps its space'];
  const points = [s.insertionBase, s.extents?.min, s.extents?.max, s.ucs?.origin, s.ucs?.xAxis];
  const all = [...points, s.ucs?.yAxis];
  if (!all.every((p) => finite(p?.x, p?.y, p?.z)) || !finite(s.elevation))
    return ['space: each value is a number'];
  return [];
}

function removalProblems(
  b: Layout,
  baseRecords: ReadonlyMap<Handle, BlockTableRecord>,
  model: DocumentModel,
  noLayouts: string | undefined,
  wasCurrent: boolean,
): string[] {
  if (noLayouts) return [noLayouts];
  const space = spaceOf(b, baseRecords);
  if (space === 'model') return ['the Model layout cannot be removed'];
  if (space === 'paper' && !wasCurrent)
    return [
      'the current layout (on *Paper_Space) goes only once another is made current, which moves *Paper_Space to its block',
    ];
  const record = model.tables.blockRecords.get(b.blockRecord);
  if (record) return [`its block ${record.name} (${b.blockRecord}) stays; LAYOUT Delete takes it`];
  return [];
}

const layoutDictionary = (doc: CadDocument) =>
  doc.rootDictionary?.getEntry<CadDictionary>(CadDictionary.acadLayout) ?? undefined;

/** The ACAD_LAYOUT entry name `acad` is listed under, if it is. */
function entryKey(doc: CadDocument, acad: AcadLayout): string | undefined {
  const dict = layoutDictionary(doc);
  return dict?.entryNames.find((n): n is string => typeof n === 'string' && dict.get(n) === acad);
}

/** Whether ACAD_LAYOUT lists `name` for an object Triya does not map as a layout. */
function unmappedEntry(doc: CadDocument, name: string, mapped: ReadonlySet<Handle>): boolean {
  const o = layoutDictionary(doc)?.get(name);
  return o !== undefined && !mapped.has(hex(o.handle));
}

/** Why a layout the model adds cannot be written. */
function additionProblems(
  doc: CadDocument,
  a: Layout,
  baseRecords: ReadonlyMap<Handle, BlockTableRecord>,
  model: DocumentModel,
  names: ReadonlyMap<string, number>,
  baseHandles: ReadonlySet<Handle>,
  noLayouts: string | undefined,
): string[] {
  if (noLayouts) return [noLayouts];
  const out: string[] = [];
  if (doc.getCadObject(Number.parseInt(a.handle, 16))) out.push('the handle is already used');
  if (!layoutDictionary(doc)) out.push('the drawing has no ACAD_LAYOUT dictionary to list it in');
  const record = model.tables.blockRecords.get(a.blockRecord);
  if (
    baseRecords.has(a.blockRecord) ||
    !record ||
    !SHEET_BLOCK.test(record.name) ||
    record.layout !== a.handle
  )
    return [
      'a new layout comes with a new *Paper_Space block of its own (ChangeSetBuilder.addLayout)',
    ];
  const name = a.name;
  if (typeof name !== 'string' || name === '') out.push('a layout needs a name');
  else if (name.toUpperCase() === AcadLayout.modelLayoutName.toUpperCase())
    out.push("Model is the model layout's name");
  else if ((names.get(name.toUpperCase()) ?? 0) > 1) out.push(`another layout is named ${name}`);
  else if (INVALID_NAME.test(name) || name.length > NAME_LENGTH)
    out.push(`${JSON.stringify(name)} is not a valid layout name`);
  else if (unmappedEntry(doc, name, baseHandles)) out.push(`another layout is named ${name}`);
  if (!Number.isInteger(a.tabOrder) || a.tabOrder < 1)
    out.push(`tabOrder: ${JSON.stringify(a.tabOrder)} is not a whole number of 1 or more`);
  for (const k of UNSUPPORTED) if (a[k] !== undefined) out.push(`${k} changes`);
  if (!validFlags(a.flags))
    out.push(
      `flags: ${JSON.stringify(a.flags)} has bits other than 1 (PSLTSCALE) and 2 (LIMCHECK)`,
    );
  if (!a.limits) out.push('a new layout needs its limits');
  else out.push(...limitsProblems(a.limits));
  if (!a.plot) out.push('a new layout needs its page setup');
  else out.push(...plotProblems(undefined, a.plot, 'other'));
  if (a.space) out.push(...spaceProblems(a.space));
  return out;
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
  if (!same(b.space, a.space)) {
    const was = spaceValues(b.space);
    const now = spaceValues(a.space);
    vars.space.forEach((name, i) => {
      if (states(baseHeader.get(name), was[i]) && !states(header.get(name), now[i]))
        out.push(`space: ${name} states the current layout's; change it alike`);
    });
  }
  return out;
}

/**
 * Writes the planned layout changes onto their originals, after the blocks (a new layout's block
 * record must be in its table): removed layouts leave ACAD_LAYOUT first and renames go next, as
 * names may swap or pass to a new layout; new layouts join last.
 */
export function writeLayouts(
  doc: CadDocument,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  plan: LayoutsPlan,
): void {
  const dict = layoutDictionary(doc);
  for (const acad of plan.removed) {
    const key = entryKey(doc, acad);
    if (key === undefined || !dict!.remove(key))
      throw new Error(`LAYOUT ${acad.name}: acad-ts did not list it in ACAD_LAYOUT`);
  }
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
    if (changed('space') && a.space) writeSpace(acad, a.space);
  }
  // After the blocks (blocks.ts leaves the two names to this) and before PURGE, which takes the
  // block of a layout deleted once another was made current under the name it then has.
  if (plan.current) doc.blockRecords!.setPaperSpace(plan.current);
  for (const a of plan.added) {
    const acad = new AcadLayout(a.name);
    // acad-ts keeps a non-zero handle it has not seen, so the layout keeps Triya's handle.
    acad.handle = Number.parseInt(a.handle, 16);
    acad.associatedBlock = resolve(r, a.blockRecord, BlockRecord)!;
    acad.tabOrder = a.tabOrder;
    acad.layoutFlags = (a.flags ?? 0) as never;
    acad.minLimits = new XY(a.limits!.min.x, a.limits!.min.y);
    acad.maxLimits = new XY(a.limits!.max.x, a.limits!.max.y);
    writePlot(acad, undefined, a.plot!);
    if (a.space) writeSpace(acad, a.space);
    // planLayouts refuses a new layout where ACAD_LAYOUT is missing (additionProblems).
    dict!.add(acad);
    r.created.set(a.handle, acad);
  }
}

function writeSpace(acad: AcadLayout, s: LayoutSpace): void {
  const xyz = (p: { x: number; y: number; z: number }) => new XYZ(p.x, p.y, p.z);
  acad.insertionBasePoint = xyz(s.insertionBase);
  acad.minExtents = xyz(s.extents.min);
  acad.maxExtents = xyz(s.extents.max);
  acad.elevation = s.elevation;
  acad.origin = xyz(s.ucs.origin);
  acad.xAxis = xyz(s.ucs.xAxis);
  acad.yAxis = xyz(s.ucs.yAxis);
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
