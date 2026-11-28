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
import type { ChangeSetBuilder } from '../model/builder';
import { dynamicBlockOf } from '../model/dynamic-block';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import { insUnitsOf, metresPerUnit } from '../model/units';
import { isDimensionalConstraint, isGeometricConstraint, isUserParameter } from '../model/types';
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

/** OVERKILL's plan for each space, in drawing order, with the objects it may touch. */
export function duplicatePlans(model: DocumentModel): OverkillPlan[] {
  const locked = (layer: string) => model.tables.layers.get(layer)?.locked === true;
  return model.layouts.map((l) => {
    const ids: EntityId[] = [];
    for (const id of model.blockEntities(l.blockRecord)) {
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
  };
}
