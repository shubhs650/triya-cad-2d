// A dimension's `*D` block rewritten with what the dimension engine draws for it (M2-10 part 3,
// DEC-011: stored block until touched, then regenerated). The engine cannot draw a dimension
// itself (`@triya/dims` sits above it and the fonts are the renderer's), so the drawing comes
// in as a `RegeneratedDimension`: the parts and the dimension's geometry after regeneration.
//
// The block holds the parts as AutoCAD writes them: on layer 0 in ByBlock colour, linetype and
// lineweight unless a DIMVAR names one (DIMCLRD, DIMLTEX1, DIMLWD…), and the definition points
// as POINTs on layer DEFPOINTS, which is made (not plotted) when the drawing has none, as
// AutoCAD makes it with the first dimension. The old contents go and the new get new handles
// above $HANDSEED, as AutoCAD's regeneration renumbers a `*D` block's contents; the block
// record keeps its handle. A dimension without a block (one made by a command, or whose block
// is missing) gets a new anonymous `*D<n>` block.
import type { AnnotationPart } from '../annotation/multileader';
import type { TextMeasure } from '../annotation/tolerance';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity, EntityGeometry } from '../model/types';
import { AnonymousNames } from './edit';

/** What a dimension draws as regenerated, and its geometry afterwards (`@triya/dims`). */
export interface RegeneratedParts {
  readonly parts: readonly (AnnotationPart & { readonly defpoint?: true })[];
  readonly geom: EntityGeometry;
  /** What it measures, formatted ("Dimension text = 10.0000", M2-11). */
  readonly measurement?: string;
}

/** The layer named `name` (any case), as the change being built sees the drawing. */
function layerNamed(b: ChangeSetBuilder, model: DocumentModel, name: string): Handle | undefined {
  for (const l of model.tables.layers.values()) {
    if (l.name.toUpperCase() === name && b.tableRecord('layers', l.handle)) return l.handle;
  }
  return undefined;
}

/** Layer DEFPOINTS, made like layer 0 but not plotted when the drawing has none. */
function defpointsLayer(b: ChangeSetBuilder, model: DocumentModel, zero: Handle): Handle {
  const found = layerNamed(b, model, 'DEFPOINTS');
  if (found !== undefined) return found;
  const z = b.tableRecord('layers', zero)!;
  return b.addTableRecord('layers', {
    name: 'Defpoints',
    color: { kind: 'aci', index: 7 },
    linetype: z.linetype,
    lineweight: 'Default',
    transparency: z.transparency,
    plot: false,
    on: true,
    frozen: false,
    locked: false,
  }).handle;
}

/**
 * Rewrites dimension `id`'s block with `drawn` and gives the dimension its regenerated
 * geometry. Returns false when the dimension is gone or the drawing has no layer 0.
 */
export function writeDimensionBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  id: EntityId,
  drawn: RegeneratedParts,
  names: AnonymousNames = new AnonymousNames(model),
): boolean {
  const e = b.entity(id);
  const g = drawn.geom;
  if (!e || !('dimType' in g)) return false;
  const zero = layerNamed(b, model, '0');
  if (zero === undefined) return false;
  let block = g.block !== undefined && b.block(g.block) ? g.block : undefined;
  if (block === undefined) {
    block = b.addBlock({ name: names.take('D'), basePoint: { x: 0, y: 0 }, flags: 1 }).handle;
  } else {
    for (const old of b.blockEntities(block)) b.removeEntity(old);
  }
  const defpoints = drawn.parts.some((p) => p.defpoint)
    ? defpointsLayer(b, model, zero)
    : undefined;
  for (const p of drawn.parts) {
    b.addEntity({
      owner: block,
      layer: p.defpoint ? defpoints! : zero,
      geom: p.geom,
      color: p.color ?? { kind: 'byBlock' },
      linetype: p.linetype ?? 'ByBlock',
      lineweight: p.lineweight ?? 'ByBlock',
    });
  }
  b.updateEntity(id, { geom: { ...g, block } as EntityGeometry });
  return true;
}

/**
 * Draws a dimension as regenerated (`regenerateDimension` of `@triya/dims`), measuring its text
 * with `measure`; undefined while a text cannot be measured.
 */
export type DimensionRegenerator = (
  e: Entity,
  model: DocumentModel,
  measure: TextMeasure,
) => RegeneratedParts | undefined;
