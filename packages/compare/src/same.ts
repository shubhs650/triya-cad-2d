// Normalised comparison of two entities from two drawings (M8-05, FR-Z3).
//
// Two drawings never share their table and block handles unless one is a revision of the other,
// so a reference is compared by what it names (layer 0, text style Standard, block FLANGE), never
// by handle. Numbers are compared by what they measure: coordinates and lengths within the linear
// tolerance, angles within the angular one and modulo a turn, everything else (counts, flags,
// scale factors, bulges) to floating-point noise. What is not geometry is left out: the handle,
// the owner, xdata, reactors, extension dictionaries, and links to other entities (an associative
// hatch's boundary, a leader's annotation, a viewport's clip boundary), which a drawing redrawn
// from scratch could not keep.

import type {
  BlockDefinition,
  DocumentModel,
  Entity,
  EntityGeometry,
  Handle,
  Tolerance,
} from '@triya/engine';

/** Keys whose values are not compared: identity and links rather than geometry. */
const SKIP_KEYS = new Set([
  'handle',
  'id',
  'owner',
  'raw',
  'xdata',
  'reactors',
  'extDict',
  // Links to other entities or objects of the same drawing.
  'annotation',
  'clipBoundary',
  'sources',
  'objects',
  // Render materials are 3D (PRD non-goal): nothing a 2D revision changes.
  'material',
]);

/** Keys holding a handle of a table record, block or named object, compared by name. */
const REF_KEYS = new Set([
  'layer',
  'style',
  'textStyle',
  'linetype',
  'arrowhead',
  'block',
  'definition',
  'visualStyle',
  'frozenLayers',
  'plotStyle',
]);

/** Keys measured in drawing units. Vectors' x, y and z are too. */
const LENGTH_KEYS = new Set([
  'x',
  'y',
  'z',
  'arrowheadSize',
  'backClip',
  'boundaryHeight',
  'columnSpacing',
  'columnWidths',
  'constantWidth',
  'dashes',
  'definedHeight',
  'doglegLength',
  'drawnArrowheadSize',
  'elevation',
  'endWidth',
  'frontClip',
  'gutter',
  'height',
  'heights',
  'landingGap',
  'leaderLength',
  'lensLength',
  'lineSpacing',
  'radius',
  'rowHeights',
  'rowSpacing',
  'spacing',
  'startWidth',
  'textHeight',
  'textWidth',
  'thickness',
  'viewHeight',
  'width',
]);

/** Keys holding an angle in radians (an ellipse's parameters behave as angles too). */
const ANGLE_KEYS = new Set([
  'angle',
  'endAngle',
  'endParam',
  'oblique',
  'patternAngle',
  'rotation',
  'snapAngle',
  'startAngle',
  'startParam',
  'textRotation',
  'twist',
  'xAxisAngle',
]);

/** Top-level geometry keys that hold what a text says, reported as a `text` change. */
export const TEXT_KEYS = new Set(['contents', 'field', 'prompt', 'tag', 'text', 'value']);

const TAU = 2 * Math.PI;

/** Equality of floats that went through a file: well below any drawing's precision. */
const NOISE = 1e-9;

/** What a handle of one drawing names, so two drawings' references can be compared. */
export class Names {
  readonly #model: DocumentModel;
  readonly #names = new Map<Handle, string>();

  constructor(model: DocumentModel) {
    this.#model = model;
    const tables = model.tables as unknown as Record<string, ReadonlyMap<Handle, { name: string }>>;
    for (const [table, records] of Object.entries(tables)) {
      for (const [h, r] of records) this.#names.set(h, `${table}:${r.name.toUpperCase()}`);
    }
    for (const [h, o] of model.objects) {
      const named = o as { name?: unknown; fileName?: unknown };
      const name = typeof named.name === 'string' ? named.name : named.fileName;
      if (typeof name === 'string') this.#names.set(h, `${o.type}:${name.toUpperCase()}`);
    }
  }

  get model(): DocumentModel {
    return this.#model;
  }

  /** The name `h` stands for; a handle nothing names (a passthrough object) stands for itself. */
  of(h: Handle): string {
    return this.#names.get(h) ?? `#${h}`;
  }

  block(h: Handle): BlockDefinition | undefined {
    return this.#model.blocks.get(h);
  }
}

/** The comparison of two drawings' contents: tolerance, names, and the blocks compared so far. */
export interface SameContext {
  readonly tol: Tolerance;
  readonly a: Names;
  readonly b: Names;
  /** Whether two blocks hold the same entities (memoised; see compare.ts). */
  readonly sameBlock: (a: Handle, b: Handle) => boolean;
}

const isAnonymous = (block: BlockDefinition | undefined) => block?.name.startsWith('*') ?? false;

/**
 * Whether two block references are the same. A named block is the same block in both drawings
 * when the names agree (a change inside it is reported apart, as a `block` change); an anonymous
 * one (`*U`, a dynamic block's state; `*X`, a hatch's or group's) is numbered by each save, so it
 * is the same when it holds the same entities.
 */
function sameBlockRef(ha: Handle, hb: Handle, ctx: SameContext): boolean {
  const ba = ctx.a.block(ha);
  const bb = ctx.b.block(hb);
  if (isAnonymous(ba) && isAnonymous(bb)) return ctx.sameBlock(ha, hb);
  return ctx.a.of(ha) === ctx.b.of(hb);
}

function sameRef(key: string, a: unknown, b: unknown, ctx: SameContext): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === 'ByLayer' || a === 'ByBlock' || b === 'ByLayer' || b === 'ByBlock') return a === b;
    if (key === 'block') return sameBlockRef(a, b, ctx);
    return ctx.a.of(a) === ctx.b.of(b);
  }
  // A layer list (a viewport's frozen layers) is a set of names.
  if (Array.isArray(a) && Array.isArray(b)) {
    const na = new Set(a.map((h) => (typeof h === 'string' ? ctx.a.of(h) : String(h))));
    const nb = new Set(b.map((h) => (typeof h === 'string' ? ctx.b.of(h) : String(h))));
    return na.size === nb.size && [...na].every((n) => nb.has(n));
  }
  // `style` is a number on some shapes (an MLINE vertex's); ByLayer and ByBlock are names
  // that every drawing shares.
  return a === b || sameValue('', a, b, ctx);
}

function sameNumber(key: string, a: number, b: number, tol: Tolerance): boolean {
  if (a === b) return true;
  if (LENGTH_KEYS.has(key)) return Math.abs(a - b) <= tol.linear;
  if (ANGLE_KEYS.has(key)) {
    const d = Math.abs((((a - b) % TAU) + TAU) % TAU);
    return Math.min(d, TAU - d) <= tol.angular;
  }
  return Math.abs(a - b) <= NOISE * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Whether `a` and `b` are the same value, found under `key` (which decides how numbers compare). */
export function sameValue(key: string, a: unknown, b: unknown, ctx: SameContext): boolean {
  // A handle names something else in the other drawing, even when the two handles agree.
  if (REF_KEYS.has(key)) return sameRef(key, a, b, ctx);
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return sameNumber(key, a, b, ctx.tol);
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(key, v, b[i], ctx));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return sameObject(a as Record<string, unknown>, b as Record<string, unknown>, ctx);
  }
  return false;
}

function sameObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ctx: SameContext,
): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (SKIP_KEYS.has(k)) continue;
    if (!sameValue(k, a[k], b[k], ctx)) return false;
  }
  return true;
}

/**
 * The top-level geometry keys that differ, after normalising what draws the same: a LINE is the
 * same line from either end. A dimension's or table's own block is the picture its definition
 * draws, not part of it, so it is left out.
 */
export function geometryDifferences(
  a: EntityGeometry,
  b: EntityGeometry,
  ctx: SameContext,
): string[] {
  if (a.kind === 'LINE' && b.kind === 'LINE') {
    const reversed = { ...b, start: b.end, end: b.start };
    const forward = keyDifferences(a, b, ctx);
    if (forward.length === 0) return forward;
    const back = keyDifferences(a, reversed, ctx);
    if (back.length === 0) return back;
    return forward;
  }
  return keyDifferences(a, b, ctx);
}

const generatedBlock = (g: EntityGeometry) => 'dimType' in g || g.kind === 'ACAD_TABLE';

function keyDifferences(a: EntityGeometry, b: EntityGeometry, ctx: SameContext): string[] {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (SKIP_KEYS.has(k)) continue;
    if (k === 'block' && generatedBlock(a)) continue;
    if (!sameValue(k, ra[k], rb[k], ctx)) out.push(k);
  }
  return out.sort();
}

/** The entity properties compared (AcDbEntity), in the order a change lists them. */
export const PROPERTY_KEYS = [
  'layer',
  'color',
  'linetype',
  'lineweight',
  'transparency',
  'ltScale',
  'visible',
  'plotStyle',
] as const;

export type PropertyKey = (typeof PROPERTY_KEYS)[number];

export function propertyDifferences(a: Entity, b: Entity, ctx: SameContext): PropertyKey[] {
  return PROPERTY_KEYS.filter((k) => !sameValue(k, a[k], b[k], ctx));
}

/**
 * A point the entity is filed under for matching by geometry: the mean of every x, y pair in it,
 * which does not move by more than the tolerance when no coordinate does, and not at all when a
 * line is reversed.
 */
export function anchorOf(g: EntityGeometry): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (v: unknown, key: string): void => {
    if (SKIP_KEYS.has(key) || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o['x'] === 'number' && typeof o['y'] === 'number') {
      sx += o['x'];
      sy += o['y'];
      n++;
    }
    for (const [k, child] of Object.entries(o)) walk(child, k);
  };
  walk(g, '');
  return n === 0 ? { x: 0, y: 0 } : { x: sx / n, y: sy / n };
}

/** The largest coordinate or span in a geometry, for the drawings' default tolerance. */
export function magnitudeOf(g: EntityGeometry): number {
  let m = 0;
  const walk = (v: unknown, key: string): void => {
    if (SKIP_KEYS.has(key) || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
      return;
    }
    const o = v as Record<string, unknown>;
    for (const k of ['x', 'y']) {
      const c = o[k];
      if (typeof c === 'number' && Number.isFinite(c)) m = Math.max(m, Math.abs(c));
    }
    for (const [k, child] of Object.entries(o)) walk(child, k);
  };
  walk(g, '');
  return m;
}
