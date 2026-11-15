// SELECTSIMILAR (M3-04 part 3): the objects of the drawing like the ones selected, as AutoCAD
// 2024 finds them (AutoCAD Help, "SELECTSIMILAR (Command)", "SELECTSIMILARMODE (System
// Variable)", "Select Similar Settings Dialog Box"):
//   - an object is similar to a sample when it is of the same type and has the same value of
//     every property SELECTSIMILARMODE's bits name: 1 Color, 2 Layer, 4 Linetype, 8 Linetype
//     scale, 16 Lineweight, 32 Plot style, 64 Object style (text, dimension, table, multileader
//     and multiline styles), 128 Name (blocks, images and underlays by what they reference);
//   - with Name on, "unnamed objects of the same type (such as lines and circles)" are similar
//     to each other; with it off a block reference is similar to any other block reference;
//   - the drawing searched is the space shown, as ALL takes it (frozen and locked layers left
//     out), and what is found is added to the samples.
// Help does not say how near two linetype scales must be to match: Triya takes them equal when
// they differ by no more than the drawing's tolerance would let two lengths differ (1e-10 of
// the larger), so a scale typed as 0.5 matches one computed as 0.5000000000001.
import { blockNameOf } from '../commands/modify/attributes';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity } from '../model/types';
import { selectAll } from './rules';

/** SELECTSIMILARMODE's bits, in the Select Similar Settings dialog's order. */
export const SIMILAR_BITS = {
  color: 1,
  layer: 2,
  linetype: 4,
  linetypeScale: 8,
  lineweight: 16,
  plotStyle: 32,
  objectStyle: 64,
  name: 128,
} as const;

/** AutoCAD's initial SELECTSIMILARMODE: Layer and Name. */
export const DEFAULT_SELECTSIMILARMODE = SIMILAR_BITS.layer | SIMILAR_BITS.name;

export const SELECTSIMILARMODE = 'SELECTSIMILARMODE';

/** What an object references by name: a block (a dynamic block's own name), an image, a PDF. */
function nameOf(model: DocumentModel, e: Entity): string | undefined {
  const g = e.geom;
  if (g.kind === 'INSERT') return blockNameOf(model, g.block);
  if (g.kind === 'IMAGE' || g.kind === 'PDFUNDERLAY') return g.definition;
  return undefined;
}

function styleOf(e: Entity): Handle | undefined {
  return (e.geom as { readonly style?: unknown }).style as Handle | undefined;
}

const sameScale = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b));

/** Whether `e` is similar to `sample` by the properties `mode` names. */
export function isSimilar(model: DocumentModel, sample: Entity, e: Entity, mode: number): boolean {
  if (e.type !== sample.type) return false;
  const on = (bit: number) => (mode & bit) !== 0;
  if (on(SIMILAR_BITS.color) && JSON.stringify(e.color) !== JSON.stringify(sample.color))
    return false;
  if (on(SIMILAR_BITS.layer) && e.layer !== sample.layer) return false;
  if (on(SIMILAR_BITS.linetype) && e.linetype !== sample.linetype) return false;
  if (on(SIMILAR_BITS.linetypeScale) && !sameScale(e.ltScale, sample.ltScale)) return false;
  if (on(SIMILAR_BITS.lineweight) && e.lineweight !== sample.lineweight) return false;
  if (on(SIMILAR_BITS.plotStyle) && e.plotStyle !== sample.plotStyle) return false;
  if (on(SIMILAR_BITS.objectStyle) && styleOf(e) !== styleOf(sample)) return false;
  if (on(SIMILAR_BITS.name) && nameOf(model, e) !== nameOf(model, sample)) return false;
  return true;
}

/** The samples and every object of `space` similar to one of them, samples first. */
export function selectSimilar(
  model: DocumentModel,
  space: Handle,
  samples: readonly EntityId[],
  mode: number,
): EntityId[] {
  const from = samples.flatMap((id) => model.entity(id) ?? []);
  const taken = new Set(from.map((e) => e.id));
  const out = from.map((e) => e.id);
  for (const id of selectAll(model, space)) {
    const e = model.entity(id);
    if (!e || taken.has(id)) continue;
    if (from.some((s) => isSimilar(model, s, e, mode))) {
      taken.add(id);
      out.push(id);
    }
  }
  return out;
}
