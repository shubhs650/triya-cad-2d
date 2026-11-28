// A library part as a block definition (M8-01, M8-02): its parts on layer 0 ByBlock, so an
// insert takes its layer's colour, linetype and lineweight; hidden edges and centre lines take
// the drawing's HIDDEN and CENTER linetypes (or another scale of them) when it has them.
import {
  insUnitsOf,
  metresPerUnit,
  type ChangeSetBuilder,
  type DocumentModel,
  type Handle,
  type LinetypeRef,
} from '@triya/engine';
import type { LibraryPart, PartRole } from './parts';

/** INSUNITS 1, inches. */
const INCHES = 1;

/**
 * What inches are multiplied by to draw in `model`'s units: by its INSUNITS when it has one,
 * else 25.4 for a metric drawing ($MEASUREMENT 1) and 1 for an imperial one.
 */
export function drawingScale(model: DocumentModel): number {
  const metres = metresPerUnit(insUnitsOf(model));
  if (metres !== undefined) return metresPerUnit(INCHES)! / metres;
  const m = model.header.get('$MEASUREMENT');
  const metric = typeof m === 'number' ? m === 1 : model.meta.measurement === 'metric';
  return metric ? 25.4 : 1;
}

/**
 * The drawing's first linetype among `names` (without regard to case). Triya's ISO and ANSI
 * templates have HIDDEN2 and CENTER2 (half scale) rather than HIDDEN and CENTER, so a part
 * takes the family's other scales when the drawing lacks the full one (DEC-090).
 */
function linetypeNamed(model: DocumentModel, names: readonly string[]): Handle | undefined {
  for (const name of names) {
    for (const lt of model.tables.linetypes.values()) {
      if (lt.name.toUpperCase() === name) return lt.handle;
    }
  }
  return undefined;
}

/** The drawing's block named `name` (without regard to case). */
export function blockNamed(model: DocumentModel, name: string): Handle | undefined {
  for (const block of model.blocks.values()) {
    if (block.name.toUpperCase() === name.toUpperCase()) return block.handle;
  }
  return undefined;
}

/**
 * Adds the block `name`, based at the origin of `parts` (already in the drawing's units), and
 * returns its handle; the drawing's own block of that name when it has one.
 */
export function addPartsBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  name: string,
  description: string,
  parts: () => readonly LibraryPart[],
): Handle {
  const found = blockNamed(model, name);
  if (found) return found;
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
  const linetypes: Readonly<Record<PartRole, LinetypeRef>> = {
    visible: 'ByBlock',
    hatch: 'ByBlock',
    hidden: linetypeNamed(model, ['HIDDEN', 'HIDDEN2', 'HIDDENX2']) ?? 'ByBlock',
    center: linetypeNamed(model, ['CENTER', 'CENTER2', 'CENTERX2']) ?? 'ByBlock',
  };
  const block = b.addBlock({
    name,
    basePoint: { x: 0, y: 0 },
    units: insUnitsOf(model),
    description,
  }).handle;
  for (const part of parts()) {
    b.addEntity({
      owner: block,
      layer: zero,
      geom: part.geom,
      color: { kind: 'byBlock' },
      linetype: linetypes[part.role],
      lineweight: 'ByBlock',
    });
  }
  return block;
}
