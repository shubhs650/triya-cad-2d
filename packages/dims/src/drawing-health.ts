// The stored-block health check over a whole drawing (M2-30 part 3): what the Health palette
// lists. Every dimension the engine draws is sorted into one of four piles: its stored `*D`
// block matches what the engine draws for it, it differs (listed with what differs), it has no
// block (the engine draws it, and a save gives it one, M2-30 part 2), or it could not be
// checked (a text no loaded font measures).

import {
  aciOfTrueColor,
  type Color,
  type Entity,
  type EntityId,
  type Handle,
  type Layout,
  type TextMeasure,
} from '@triya/engine';
import { dimensionHealth, type ColorMatch, type StoredBlocks } from './health';
import { generates } from './parts';

/**
 * DXF DIMSTYLE records keep a true DIMCLRx colour only as AutoCAD's ACI for it, while the
 * stored block keeps the true colour itself: that ACI stands for it.
 */
export const dimstyleAci: ColorMatch = (g: Color, s: Color) =>
  g.kind === 'aci' && s.kind === 'rgb' && aciOfTrueColor(s.r, s.g, s.b) === g.index;

/** What reading every dimension of a drawing needs. */
export interface DrawingDimensions extends StoredBlocks {
  entities(): Iterable<Entity>;
  readonly layouts: readonly Layout[];
}

/** Where a dimension is: on a layout (Model is one) or in a block definition. */
export type DimensionSpace =
  | { readonly kind: 'layout'; readonly name: string }
  | { readonly kind: 'block'; readonly name: string };

export interface DimensionMismatch {
  readonly id: EntityId;
  readonly handle: Handle;
  /** The BLOCK_RECORD holding it. */
  readonly owner: Handle;
  readonly space: DimensionSpace;
  /** AutoCAD's name for its kind: Linear, Aligned, Radius… */
  readonly type: string;
  /** What differs, as `compareParts` words it. */
  readonly problems: readonly string[];
}

export interface DrawingDimensionHealth {
  /** Dimensions compared with their stored block. */
  readonly checked: number;
  /** Of those, the ones whose block differs from what the engine draws. */
  readonly mismatched: readonly DimensionMismatch[];
  /** Dimensions without a stored block: the engine draws them, a save gives them one. */
  readonly blockless: number;
  /** Dimensions that could not be checked: a text no loaded font measures. */
  readonly unchecked: number;
}

const DIM_TYPE: Record<string, string> = {
  linear: 'Linear',
  aligned: 'Aligned',
  angular: 'Angular',
  angular3pt: 'Angular',
  radius: 'Radius',
  diameter: 'Diameter',
  ordinate: 'Ordinate',
  jogged: 'Jogged',
  arc: 'Arc length',
};

function typeName(e: Entity): string {
  const g = e.geom;
  return ('dimType' in g && DIM_TYPE[g.dimType]) || e.type;
}

/**
 * The dimension health of a drawing, mismatches in drawing order. `measure` measures texts in
 * the fonts the drawing draws with, so the check sees what the screen shows.
 */
export function drawingDimensionHealth(
  model: DrawingDimensions,
  measure: TextMeasure,
  colors: ColorMatch = dimstyleAci,
): DrawingDimensionHealth {
  const layouts = new Map(model.layouts.map((l) => [l.blockRecord, l.name]));
  const space = (owner: Handle): DimensionSpace => {
    const layout = layouts.get(owner);
    if (layout !== undefined) return { kind: 'layout', name: layout };
    const name = model.blocks.get(owner)?.name ?? owner;
    // A file before R2000 has no Model layout: its model space is still the Model tab.
    return /^\*model_space$/i.test(name)
      ? { kind: 'layout', name: 'Model' }
      : { kind: 'block', name };
  };
  let checked = 0;
  let blockless = 0;
  let unchecked = 0;
  const mismatched: DimensionMismatch[] = [];
  for (const e of model.entities()) {
    const g = e.geom;
    if (!generates(g) || !('dimType' in g)) continue;
    if (g.block === undefined || !model.blocks.get(g.block)) {
      blockless++;
      continue;
    }
    const health = dimensionHealth(e, model, measure, colors);
    if (!health) {
      unchecked++;
      continue;
    }
    checked++;
    if (health.ok) continue;
    mismatched.push({
      id: e.id,
      handle: e.handle,
      owner: e.owner,
      space: space(e.owner),
      type: typeName(e),
      problems: health.problems,
    });
  }
  return { checked, mismatched, blockless, unchecked };
}
