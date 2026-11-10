// Regeneration of the dimensions an edit changed (M2-10 part 3): their blocks rewritten by the
// dimension engine the bus was given (`ctx.dimensions`), in the same command, so one undo takes
// back the edit and the regeneration together. The engine worker has no fonts: the texts are
// measured by the canvas (`textWidths`), each once, and drawing is tried again with the widths
// it asked for until nothing is missing (a dimension measures its main text and, for some
// rules, a second one).
import type { Entity, MTextGeometry } from '../../model/types';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { DocumentModel } from '../../model/document';
import { ChangeSetBuilder } from '../../model/builder';
import { loadedXrefHandles } from '../../model/xref';
import { isEmptyChangeSet, type ChangeSet } from '../../model/changeset';
import type { TextMeasure } from '../../annotation/tolerance';
import {
  writeDimensionBlock,
  type DimensionRegenerator,
  type RegeneratedParts,
} from '../../edit/dimension-block';
import { AnonymousNames } from '../../edit/edit';
import type { CommandContext } from '../command';
import type { ViewHost } from '../view/host';

/** Measuring rounds before giving up: a dimension asks for at most a few texts in turn. */
const ROUNDS = 4;

/**
 * What the dimension engine draws for each of `ids` now, measuring their texts on the canvas
 * (`textWidths`); a dimension it cannot draw (its kind, a text not measured) is left out.
 */
async function drawDimensions(
  model: DocumentModel,
  ids: readonly EntityId[],
  regenerate: DimensionRegenerator,
  view: ViewHost,
): Promise<Map<EntityId, RegeneratedParts>> {
  const drawn = new Map<EntityId, RegeneratedParts>();
  const widths = new Map<string, number | undefined>();
  for (let round = 0; round < ROUNDS; round++) {
    const missing = new Map<string, MTextGeometry>();
    const measure: TextMeasure = (t) => {
      const key = JSON.stringify(t);
      if (widths.has(key)) return widths.get(key);
      missing.set(key, t);
      return undefined;
    };
    for (const id of ids) {
      const e = model.entity(id);
      if (!e || drawn.has(id)) continue;
      const r = regenerate(e, model, measure);
      if (r) drawn.set(id, r);
    }
    if (missing.size === 0) break;
    const texts = [...missing.values()];
    const reply = await view.request({ op: 'textWidths', texts });
    const got = reply.ok ? reply.widths : undefined;
    [...missing.keys()].forEach((key, i) => widths.set(key, got?.[i] ?? undefined));
  }
  return drawn;
}

/**
 * Rewrites the blocks of the dimensions `ids` as the dimension engine draws them now. Says on
 * the command line how many could not be (no dimension engine, no canvas, a font not loaded),
 * which keep the graphics carried with them. Returns what each regenerated one draws.
 */
export async function regenerateDimensions(
  ctx: CommandContext,
  ids: readonly EntityId[],
): Promise<ReadonlyMap<EntityId, RegeneratedParts>> {
  if (ids.length === 0) return new Map();
  const drawn = ctx.dimensions
    ? await drawDimensions(ctx.model, ids, ctx.dimensions, ctx.view)
    : new Map<EntityId, RegeneratedParts>();
  if (drawn.size > 0) {
    ctx.edit((b) => {
      const names = new AnonymousNames(ctx.model);
      for (const [id, r] of drawn) writeDimensionBlock(b, ctx.model, id, r, names);
    });
  }
  const left = ids.filter((id) => ctx.model.entity(id) && !drawn.has(id)).length;
  if (left > 0) {
    ctx.message(
      `${left} ${left === 1 ? 'dimension was' : 'dimensions were'} not regenerated (its text cannot be measured).`,
    );
  }
  return drawn;
}

const DIMENSION_KINDS = new Set(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);

type Styled = Entity & { readonly geom: { readonly style: Handle; readonly text: string } };

const isDimension = (e: Entity | undefined): e is Styled =>
  e !== undefined && DIMENSION_KINDS.has(e.geom.kind);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The dimensions `changes` restyled without redrawing them (M2-30 part 2): those whose
 * dimension style, text override or DIMVAR overrides (xdata) changed, and every dimension of a
 * DIMSTYLE whose DIMVARs changed. A dimension whose block the same changes rewrote (a command
 * that regenerated it, or drew it) is left out.
 */
export function restyledDimensions(
  model: DocumentModel,
  changes: readonly ChangeSet[],
): EntityId[] {
  const out = new Set<EntityId>();
  const styles = new Set<Handle>();
  const drawnInto = new Set<Handle>();
  for (const cs of changes) {
    for (const { before, after } of cs.tables?.dimStyles?.updated ?? []) {
      if (!same(before.vars, after.vars) || !same(before.trueColors, after.trueColors)) {
        styles.add(after.handle);
      }
    }
    for (const { entity } of cs.entities?.added ?? []) drawnInto.add(entity.owner);
    for (const { before, after } of cs.entities?.updated ?? []) {
      if (!isDimension(before) || !isDimension(after)) continue;
      if (
        before.geom.style !== after.geom.style ||
        before.geom.text !== after.geom.text ||
        !same(before.xdata, after.xdata)
      ) {
        out.add(after.id);
      }
    }
  }
  if (styles.size > 0) {
    for (const e of model.entities()) {
      if (isDimension(e) && styles.has(e.geom.style)) out.add(e.id);
    }
  }
  return [...out].filter((id) => {
    const e = model.entity(id);
    if (!isDimension(e)) return false;
    const block = (e.geom as { readonly block?: Handle }).block;
    return block === undefined || !drawnInto.has(block);
  });
}

/**
 * Regenerates what a command's `changes` restyled (`restyledDimensions`), as the command ends,
 * in its undo step. Without a dimension engine the dimensions are carried as they are.
 */
export async function regenerateRestyled(
  ctx: CommandContext,
  changes: readonly ChangeSet[],
): Promise<void> {
  if (!ctx.dimensions) return;
  const ids = restyledDimensions(ctx.model, changes);
  if (ids.length > 0) await regenerateDimensions(ctx, ids);
}

/**
 * The blocks a save gives the dimensions that have none (M2-30 part 2): a change set that
 * draws each into a new anonymous `*D` block, built on the drawing as it is but not applied
 * to it, so the drawing keeps drawing them from the engine and the saved file holds them as
 * AutoCAD writes them. Its handles are taken from the drawing's own (never given out again).
 * Undefined when there is nothing to add, no dimension engine, or no text could be measured.
 */
export async function blocklessDimensionBlocks(
  model: DocumentModel,
  regenerate: DimensionRegenerator | undefined,
  view: ViewHost,
): Promise<ChangeSet | undefined> {
  if (!regenerate) return undefined;
  // A loaded xref's dimensions are its own file's (FR-B4): saves leave them out.
  const xref = loadedXrefHandles(model);
  const ids: EntityId[] = [];
  for (const e of model.entities()) {
    if (!isDimension(e) || xref.has(e.handle)) continue;
    const block = (e.geom as { readonly block?: Handle }).block;
    if (block === undefined || !model.hasBlock(block)) ids.push(e.id);
  }
  if (ids.length === 0) return undefined;
  const drawn = await drawDimensions(model, ids, regenerate, view);
  if (drawn.size === 0) return undefined;
  const b = new ChangeSetBuilder(model);
  const names = new AnonymousNames(model);
  for (const [id, r] of drawn) writeDimensionBlock(b, model, id, r, names);
  const change = b.build();
  return isEmptyChangeSet(change) ? undefined : change;
}
