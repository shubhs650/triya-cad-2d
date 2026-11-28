// The Health palette's drawing checks (M8-07, PRD FR-Z4), beside PURGE's (purge.ts, M5-09 part 3):
//
//   - Duplicates: what OVERKILL with the Delete Duplicate Objects dialog's initial settings
//     would delete in each space (model space and every layout, each on its own, objects on
//     locked layers and viewports left out), and its one-click fix, OVERKILL on all of them as
//     one undo step. The geometry is edit/overkill.ts's.
//   - Units: a unitless drawing (INSUNITS 0: nothing inserted into it or pasted from it is
//     scaled), and a MEASUREMENT that disagrees with INSUNITS (millimetres with imperial hatch
//     patterns and linetypes, or inches with metric ones: AutoCAD picks acad.pat or acadiso.pat,
//     acad.lin or acadiso.lin, by MEASUREMENT). Each has a fix setting the variable.
//   - Dynamic blocks: the definitions and their references, which Triya draws in their saved
//     state without evaluating them (PRD non-goal 2, FR-B3).
//   - Constraints: the drawing's geometric and dimensional constraints and user parameters
//     (M9), those acting and those held in blocks.
//   - Dimension overrides (part 2, the roadmap's "non-standard dim styles"): dimensions in model
//     space and the layouts, outside locked layers, whose ACAD xdata holds a `DSTYLE` list of
//     DIMVARs overriding their style, as the DIMSTYLE dialog's `<style overrides>` shows. Its fix,
//     DIMOVERRIDE's Clear overrides on all of them, is a command (`clearDimensionOverridesCommand`)
//     because the dimensions are redrawn as it ends.
//   - Inline fonts (part 2): the fonts multiline text names with `\F` (a font file) or `\f` (a
//     TrueType family) in MTEXT, multileader text and dimension text, blocks included, which the
//     text style check does not see. The app resolves them against its fonts (`@triya/io/health`).
import type { ChangeSetBuilder } from '../model/builder';
import { dstyleOverrides } from '../annotation/leader';
import { dynamicBlockOf } from '../model/dynamic-block';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import { insUnitsOf, metresPerUnit } from '../model/units';
import {
  isDimensionalConstraint,
  isGeometricConstraint,
  isUserParameter,
  type EntityGeometry,
} from '../model/types';
import { metric } from './center-settings';
import { eraseObjects, reshapeObject } from './edit';
import { DEFAULT_OVERKILL, planOverkill, type OverkillPlan } from './overkill';

/** A units problem the Health palette shows, with what its fix sets. */
export type UnitsProblem =
  | {
      /** INSUNITS 0. */
      readonly kind: 'unitless';
      /** The units the fix sets: millimetres in a metric drawing, inches in an imperial one. */
      readonly suggested: 1 | 4;
    }
  | {
      /** MEASUREMENT says one system, INSUNITS names a unit of the other. */
      readonly kind: 'measurement';
      readonly insUnits: number;
      readonly measurement: 'imperial' | 'metric';
      /** What the fix sets MEASUREMENT to: the system of INSUNITS. */
      readonly suggested: 'imperial' | 'metric';
    };

/** A font multiline text names inline, by its first spelling, with the objects naming it. */
export interface InlineFont {
  /** `F` names a font file (SHX), `f` a TrueType family. */
  readonly code: 'F' | 'f';
  /** As written between the code and its `;`: the name, then `|b1|i0|c0|p34` flags for `\f`. */
  readonly value: string;
  readonly objects: number;
}

export interface HealthChecks {
  /** OVERKILL's two counts over every space, as its two messages print them. */
  readonly duplicates: { readonly duplicates: number; readonly overlaps: number };
  readonly units: {
    /** INSUNITS and MEASUREMENT as the drawing now holds them. */
    readonly insUnits: number;
    readonly measurement: 'imperial' | 'metric';
    readonly problems: readonly UnitsProblem[];
  };
  readonly dynamicBlocks: {
    /** Each dynamic block definition by the name AutoCAD shows, with its references. */
    readonly blocks: readonly { readonly name: string; readonly references: number }[];
    readonly references: number;
  };
  readonly constraints: {
    readonly geometric: number;
    readonly dimensional: number;
    readonly userParameters: number;
  };
  readonly dimensionOverrides: {
    readonly dimensions: number;
    /** The styles those dimensions override, by name, with how many override each. */
    readonly styles: readonly { readonly name: string; readonly dimensions: number }[];
    /** The DIMVARs overridden, by name, with how many dimensions override each. */
    readonly variables: readonly { readonly name: string; readonly dimensions: number }[];
  };
  readonly inlineFonts: readonly InlineFont[];
}

// INSUNITS codes by system (AutoCAD 2024 Help, "INSUNITS (System Variable)"); the astronomical
// units (18–20) are neither.
const IMPERIAL = new Set([1, 2, 3, 8, 9, 10, 21, 22, 23, 24]);
const METRIC = new Set([4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17]);

/** The system an INSUNITS code belongs to; undefined for unitless and the astronomical units. */
export function unitSystem(code: number): 'imperial' | 'metric' | undefined {
  if (metresPerUnit(code) === undefined) return undefined;
  return IMPERIAL.has(code) ? 'imperial' : METRIC.has(code) ? 'metric' : undefined;
}

export function unitsProblems(model: DocumentModel): UnitsProblem[] {
  const measurement = metric(model) ? 'metric' : 'imperial';
  const units = insUnitsOf(model);
  if (units === 0) return [{ kind: 'unitless', suggested: measurement === 'metric' ? 4 : 1 }];
  const system = unitSystem(units);
  return system !== undefined && system !== measurement
    ? [{ kind: 'measurement', insUnits: units, measurement, suggested: system }]
    : [];
}

/**
 * The block records of model space and each layout. Model space is one even in a drawing with no
 * LAYOUT objects (some programs write none; AutoCAD makes them as it opens such a file).
 */
function spaces(model: DocumentModel): string[] {
  const out = model.layouts.map((l) => l.blockRecord);
  for (const r of model.tables.blockRecords.values()) {
    if (r.name.toUpperCase() === '*MODEL_SPACE' && !out.includes(r.handle)) out.unshift(r.handle);
  }
  return out;
}

/** OVERKILL's plan for each space, in drawing order, with the objects it may touch. */
export function duplicatePlans(model: DocumentModel): OverkillPlan[] {
  const locked = (layer: string) => model.tables.layers.get(layer)?.locked === true;
  return spaces(model).map((space) => {
    const ids: EntityId[] = [];
    for (const id of model.blockEntities(space)) {
      const e = model.entity(id);
      // A viewport is a layout's window on model space, not geometry to deduplicate.
      if (e && e.geom.kind !== 'VIEWPORT' && !locked(e.layer)) ids.push(id);
    }
    return planOverkill(model, ids, DEFAULT_OVERKILL);
  });
}

/** OVERKILL's edits for `plans` into `b`; false when they change nothing. */
export function overkillInto(
  b: ChangeSetBuilder,
  model: DocumentModel,
  plans: readonly OverkillPlan[],
): boolean {
  let any = false;
  for (const plan of plans) {
    if (plan.erase.length === 0 && plan.reshape.size === 0 && plan.split.size === 0) continue;
    any = true;
    for (const [id, g] of plan.reshape) reshapeObject(b, model, id, [g]);
    for (const [id, gs] of plan.split) reshapeObject(b, model, id, gs);
    eraseObjects(b, model, plan.erase);
  }
  return any;
}

const DIMENSION_KINDS = new Set(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);

/**
 * The dimensions of model space and the layouts, outside locked layers, that override DIMVARs of
 * their style, in drawing order. A dimension inside a block definition is the block's to change
 * (BEDIT or REFEDIT), as OVERKILL and PURGE leave block contents alone here.
 */
export function overriddenDimensions(model: DocumentModel): EntityId[] {
  const locked = (layer: string) => model.tables.layers.get(layer)?.locked === true;
  const out: EntityId[] = [];
  for (const space of spaces(model)) {
    for (const id of model.blockEntities(space)) {
      const e = model.entity(id);
      if (!e || !DIMENSION_KINDS.has(e.geom.kind) || locked(e.layer)) continue;
      if (Object.keys(dstyleOverrides(e.xdata, model)).length > 0) out.push(id);
    }
  }
  return out;
}

function dimensionOverrides(model: DocumentModel): HealthChecks['dimensionOverrides'] {
  const ids = overriddenDimensions(model);
  const styles = new Map<string, number>();
  const variables = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const id of ids) {
    const e = model.entity(id)!;
    const style = (e.geom as { readonly style?: string }).style;
    bump(styles, (style && model.tables.dimStyles.get(style)?.name) || '(none)');
    for (const name of Object.keys(dstyleOverrides(e.xdata, model))) bump(variables, name);
  }
  const rows = (m: Map<string, number>) =>
    [...m]
      .map(([name, dimensions]) => ({ name, dimensions }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { dimensions: ids.length, styles: rows(styles), variables: rows(variables) };
}

// `\\` is an escaped backslash, read past so the `F` after it is text; `\F` and `\f` run to
// their `;` (AutoCAD 2024 Help, "Format Multiline Text in an Alternate Text Editor").
const FONT_CODE = /\\(?:\\|([Ff])([^;]*);)/g;

/** The MTEXT-coded string of `geom`: an MTEXT's contents, a multileader's, a dimension's text. */
function codedText(geom: EntityGeometry): string | undefined {
  if (geom.kind === 'MTEXT') return geom.contents;
  if (geom.kind === 'MULTILEADER') return geom.text?.content;
  if (geom.kind === 'DIMENSION' || geom.kind === 'ARC_DIMENSION') return geom.text;
  if (geom.kind === 'LARGE_RADIAL_DIMENSION') return geom.text;
  return undefined;
}

/**
 * The fonts every object's multiline text names inline, once per font (by code and name, case
 * aside: the flags only pick a face), sorted by name; each object counted once per font.
 */
export function inlineFonts(model: DocumentModel): InlineFont[] {
  const fonts = new Map<string, { code: 'F' | 'f'; value: string; objects: number }>();
  for (const e of model.entities()) {
    const text = codedText(e.geom);
    if (!text || !text.includes('\\')) continue;
    const seen = new Set<string>();
    for (const m of text.matchAll(FONT_CODE)) {
      const code = m[1] as 'F' | 'f' | undefined;
      const value = m[2] ?? '';
      const name = value.split('|')[0]!.trim();
      if (!code || name === '') continue;
      const key = `${code}\u0000${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = fonts.get(key);
      if (f) f.objects++;
      else fonts.set(key, { code, value, objects: 1 });
    }
  }
  const name = (f: InlineFont) => f.value.split('|')[0]!.toLowerCase();
  return [...fonts.values()].sort((a, b) =>
    name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : a.code < b.code ? -1 : 1,
  );
}

export function healthChecks(model: DocumentModel): HealthChecks {
  let duplicates = 0;
  let overlaps = 0;
  for (const p of duplicatePlans(model)) {
    duplicates += p.duplicates;
    overlaps += p.overlaps;
  }

  const references = new Map<string, number>();
  for (const b of model.blocks.values()) if (b.dynamic) references.set(b.handle, 0);
  let referenced = 0;
  if (references.size > 0) {
    for (const e of model.entities()) {
      if (e.geom.kind !== 'INSERT') continue;
      const d = dynamicBlockOf(model.blocks, e.geom.block);
      if (!d) continue;
      references.set(d.handle, (references.get(d.handle) ?? 0) + 1);
      referenced++;
    }
  }
  const blocks = [...references]
    .map(([h, n]) => ({ name: model.blocks.get(h)!.dynamic!.name, references: n }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  let geometric = 0;
  let dimensional = 0;
  let userParameters = 0;
  for (const o of model.objects.values()) {
    if (isGeometricConstraint(o)) geometric++;
    else if (isDimensionalConstraint(o)) dimensional++;
    else if (isUserParameter(o)) userParameters++;
  }

  return {
    duplicates: { duplicates, overlaps },
    units: {
      insUnits: insUnitsOf(model),
      measurement: metric(model) ? 'metric' : 'imperial',
      problems: unitsProblems(model),
    },
    dynamicBlocks: { blocks, references: referenced },
    constraints: { geometric, dimensional, userParameters },
    dimensionOverrides: dimensionOverrides(model),
    inlineFonts: inlineFonts(model),
  };
}
