// Library details drawn from their principal dimensions (M8-02, DEC-090): a nozzle detail or a
// vessel support is not a standard's table but a part the drafter sizes. Each generator lists
// the dimensions it is drawn from (what the library palette, M8-03, asks for), gives defaults,
// says why a set of dimensions makes no such part, and draws it. The block it adds is named by
// its dimensions, so a changed dimension is a new block and the same dimensions find the
// drawing's own.
import type { ChangeSetBuilder, DocumentModel, Handle } from '@triya/engine';
import { addPartsBlock } from '../block';
import type { LibraryPart } from '../parts';

/** A principal dimension: a length in drawing units or an angle in degrees. */
export interface DetailField<K extends string = string> {
  readonly key: K;
  /** Its letters in the block's name: `OD` in `…_OD168.3_…`. */
  readonly code: string;
  readonly label: string;
  readonly kind: 'length' | 'angle';
  /** Whether 0 draws the part without it (no pad, no weld, no holes). */
  readonly optional?: boolean;
}

export type DetailSpec<K extends string> = Readonly<Record<K, number>>;

export interface DetailGenerator<K extends string = string> {
  /** Its name in the block's: `SADDLE` in `TRIYA_SADDLE_…`. */
  readonly id: string;
  readonly label: string;
  /** Which view it draws and where its base point is. */
  readonly view: string;
  readonly fields: readonly DetailField<K>[];
  /** The defaults in inches (the library palette multiplies lengths by `drawingScale`). */
  readonly defaults: DetailSpec<K>;
  /** Why `spec` makes no such part, or undefined when it does. */
  check(spec: DetailSpec<K>): string | undefined;
  /** The part drawn from `spec`, in `spec`'s units, about its base point. */
  parts(spec: DetailSpec<K>): LibraryPart[];
}

/** `g`'s defaults with each length multiplied by `scale` (25.4 for a drawing in millimetres). */
export function detailDefaults<K extends string>(g: DetailGenerator<K>, scale = 1): DetailSpec<K> {
  const out = {} as Record<K, number>;
  for (const f of g.fields)
    out[f.key] = f.kind === 'length' ? g.defaults[f.key] * scale : g.defaults[f.key];
  return out;
}

/** A dimension in a name: at most four decimals, without trailing zeros. */
function figure(v: number): string {
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * The block's name: `TRIYA_<id>` and each dimension as its code and value
 * (`TRIYA_SADDLE_D60_H42_A120_…`), an optional one left out at 0.
 */
export function detailBlockName<K extends string>(
  g: DetailGenerator<K>,
  spec: DetailSpec<K>,
): string {
  const dims = g.fields
    .filter((f) => !(f.optional && spec[f.key] === 0))
    .map((f) => `${f.code}${figure(spec[f.key])}`);
  return ['TRIYA', g.id, ...dims].join('_');
}

/** "Saddle support, end view: vessel OD 60, height 42, contact angle 120°, …". */
export function detailDescription<K extends string>(
  g: DetailGenerator<K>,
  spec: DetailSpec<K>,
): string {
  const dims = g.fields
    .filter((f) => !(f.optional && spec[f.key] === 0))
    .map((f) => `${f.label} ${figure(spec[f.key])}${f.kind === 'angle' ? '°' : ''}`);
  return `${g.label}, ${g.view}: ${dims.join(', ')}`;
}

/**
 * Checks every field is a finite number, not negative, and positive unless optional, then the
 * generator's own rules.
 */
export function checkDetail<K extends string>(
  g: DetailGenerator<K>,
  spec: DetailSpec<K>,
): string | undefined {
  for (const f of g.fields) {
    const v = spec[f.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${f.label} must be a number`;
    if (v < 0 || (v === 0 && !f.optional)) return `${f.label} must be more than 0`;
  }
  return g.check(spec);
}

/**
 * The handle of the drawing's block for `g` drawn from `spec` (in the drawing's units), adding
 * it when the drawing lacks it. Undefined, with nothing added, when `spec` makes no such part.
 */
export function addDetailBlock<K extends string>(
  b: ChangeSetBuilder,
  model: DocumentModel,
  g: DetailGenerator<K>,
  spec: DetailSpec<K>,
): Handle | undefined {
  if (checkDetail(g, spec) !== undefined) return undefined;
  return addPartsBlock(b, model, detailBlockName(g, spec), detailDescription(g, spec), () =>
    g.parts(spec),
  );
}
