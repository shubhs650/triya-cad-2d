// The stored-block health check (DEC-011, ARCHITECTURE.md §9): a dimension's `*D` block, as
// the program that last drew it stored it, against what the engine draws for it. A dimension
// whose regenerated parts differ beyond tolerance points at an engine rule that does not match
// the writer's.
//
// Tolerances, in the dimension's text height h (DIMTXT × DIMSCALE):
// - geometry (line and arc paths, arrowheads, definition points) within h / 1000;
// - near the text (within twice its rough half width plus 2h of its middle), linework within h and the
//   text's middle within h: text widths come from Triya's fonts (DEC-044), not the writer's,
//   so where a dimension line stops at the text, and how far text sits off its line, differ
//   by a fraction of a text height.
// Linework compares as paths (each path's sampled points lie on the other side's paths in the
// same colour, linetype and lineweight, both ways), so one line drawn as two pieces matches.
// Text compares by its characters with formatting codes the writers spell differently
// (`\A1;`, `%%c`, `%%d`, `\U+2205`) made equal.

import type {
  AnnotationTables,
  Color,
  Entity,
  EntityGeometry,
  EntityId,
  Handle,
  TextMeasure,
  Vec2,
} from '@triya/engine';
import { add, dist, dot, fromAngle, normAngle, sub, type DimPart } from './geometry';
import { dimensionParts } from './parts';
import { dimStyle } from './style';

/** What reading a dimension's stored block needs. */
export interface StoredBlocks extends AnnotationTables {
  blockEntities(block: Handle): readonly EntityId[];
  entity(id: EntityId): Entity | undefined;
}

export interface DimComparison {
  readonly ok: boolean;
  /** What differs, for the health report. */
  readonly problems: readonly string[];
}

/**
 * A stored `*D` block's entities as parts. Anonymous blocks nested at the origin unscaled (how
 * R12 files keep the text) are opened; arrowhead blocks stay INSERTs.
 */
export function storedParts(block: Handle, model: StoredBlocks): DimPart[] {
  const out: DimPart[] = [];
  const visit = (b: Handle, depth: number) => {
    if (depth > 4 || !model.blocks.get(b)) return;
    for (const id of model.blockEntities(b)) {
      const e = model.entity(id);
      if (!e) continue;
      const g = e.geom;
      if (
        g.kind === 'INSERT' &&
        model.blocks.get(g.block)?.name.startsWith('*') &&
        g.position.x === 0 &&
        g.position.y === 0 &&
        g.rotation === 0 &&
        g.scale.x === 1 &&
        g.scale.y === 1
      ) {
        visit(g.block, depth + 1);
        continue;
      }
      const layer = model.tables.layers.get(e.layer)?.name.toUpperCase();
      out.push({
        geom: g,
        ...(e.color ? { color: e.color } : {}),
        ...(e.linetype !== undefined ? { linetype: e.linetype } : {}),
        ...(e.lineweight !== undefined ? { lineweight: e.lineweight } : {}),
        ...(g.kind === 'POINT' && layer === 'DEFPOINTS' ? { defpoint: true as const } : {}),
      });
    }
  };
  visit(block, 0);
  return out;
}

const inherit = (v: unknown) => (v === undefined || v === 'ByBlock' || v === 'ByLayer' ? '' : v);
const colorKey = (c: Color | undefined): string =>
  JSON.stringify(!c || c.kind === 'byBlock' ? { kind: 'byBlock' } : c);

/** Whether two colours are the same; a generated ACI may stand for a stored true colour. */
export type ColorMatch = (generated: Color, stored: Color) => boolean;

/**
 * Whether two parts draw in the same properties: their colours (absent is ByBlock, the
 * dimension's own), and a linetype or lineweight only when one names it (ByBlock and ByLayer
 * both follow the dimension inside its block).
 */
function sameProps(g: DimPart, s: DimPart, colors?: ColorMatch): boolean {
  if (inherit(g.linetype) !== inherit(s.linetype)) return false;
  if (inherit(g.lineweight) !== inherit(s.lineweight)) return false;
  if (colorKey(g.color) === colorKey(s.color)) return true;
  return !!(colors && g.color && s.color && colors(g.color, s.color));
}

const propsLabel = (p: DimPart): string =>
  `${colorKey(p.color)} ${String(inherit(p.linetype))} ${String(inherit(p.lineweight))}`;

/** The text's characters, its writers' spellings of the same thing made equal. */
export function normalText(s: string): string {
  return (
    s
      .replace(/\\A[012];/g, '')
      // A stacked fraction's size and stacking style vary between writers (R2000 writes `\S1/4;`
      // where later versions write `{\H1x;\S1#4;}`); its numbers do not.
      .replace(/\{\\H[\d.]+x;(\\S[^;]*;)\}/g, '$1')
      .replace(/\\S([^;#/^]*)[#^]([^;]*);/g, '\\S$1/$2;')
      .replace(/%%[cC]|\\U\+2205|\\U\+00D8|∅/g, 'Ø')
      .replace(/%%[dD]|\\U\+00B0/g, '°')
      .replace(/%%[pP]|\\U\+00B1/g, '±')
  );
}

interface Text {
  readonly contents: string;
  readonly position: Vec2;
  readonly rotation: number;
  readonly height: number;
  readonly part: DimPart;
}

function textOf(p: DimPart): Text | undefined {
  const g = p.geom;
  if (g.kind === 'MTEXT')
    return {
      contents: normalText(g.contents),
      position: g.position,
      rotation: g.rotation,
      height: g.height,
      part: p,
    };
  if (g.kind === 'TEXT') {
    // R12 dimension text: middle-centred TEXT (DXF 72 = 1 or 4, 73 = 0 or 2) about DXF 11.
    const at = g.alignmentPoint ?? g.position;
    const middle =
      g.valign === 2 || g.halign === 4
        ? at
        : add(at, fromAngle(g.rotation + Math.PI / 2), g.height / 2);
    return {
      contents: normalText(g.value),
      position: middle,
      rotation: g.rotation,
      height: g.height,
      part: p,
    };
  }
  return undefined;
}

/** Points along a line or arc path. */
function samples(g: EntityGeometry): Vec2[] {
  if (g.kind === 'LINE')
    return [0, 0.25, 0.5, 0.75, 1].map((t) => add(g.start, sub(g.end, g.start), t));
  if (g.kind === 'ARC') {
    const sweep = normAngle(g.endAngle - g.startAngle) || 2 * Math.PI;
    return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
      add(g.center, fromAngle(g.startAngle + (sweep * i) / 8), g.radius),
    );
  }
  return [];
}

function distanceTo(p: Vec2, g: EntityGeometry): number {
  if (g.kind === 'LINE') {
    const d = sub(g.end, g.start);
    const len2 = dot(d, d);
    const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, g.start), d) / len2)) : 0;
    return dist(p, add(g.start, d, t));
  }
  if (g.kind === 'ARC') {
    const a = Math.atan2(p.y - g.center.y, p.x - g.center.x);
    const sweep = normAngle(g.endAngle - g.startAngle) || 2 * Math.PI;
    if (normAngle(a - g.startAngle) <= sweep + 1e-12) return Math.abs(dist(p, g.center) - g.radius);
    const s = add(g.center, fromAngle(g.startAngle), g.radius);
    const e = add(g.center, fromAngle(g.startAngle + sweep), g.radius);
    return Math.min(dist(p, s), dist(p, e));
  }
  return Infinity;
}

const angleDiff = (a: number, b: number): number => {
  const d = normAngle(a - b);
  return Math.min(d, 2 * Math.PI - d);
};

/** Generated parts against stored ones, `h` the text height the tolerances scale with. */
export function compareParts(
  generated: readonly DimPart[],
  stored: readonly DimPart[],
  h: number,
  colors?: ColorMatch,
): DimComparison {
  const tol = Math.max(1e-9, h / 1000);
  const problems: string[] = [];
  const texts = (ps: readonly DimPart[]) => ps.map(textOf).filter((t): t is Text => !!t);
  const gt = texts(generated);
  const st = texts(stored);
  // Near the text: its rough width (characters × h) plus 2h around its middle.
  const zones = [...gt, ...st].map((t) => ({
    at: t.position,
    r: t.contents.replace(/\\[A-Za-z][^;]*;|[{}]/g, '').length * h + 2 * h,
  }));
  const nearText = (p: Vec2) => zones.some((z) => dist(p, z.at) <= z.r);

  // Linework, both ways.
  const paths = (ps: readonly DimPart[]) =>
    ps.filter((p) => p.geom.kind === 'LINE' || p.geom.kind === 'ARC');
  const gp = paths(generated);
  const sp = paths(stored);
  const covered = (from: readonly DimPart[], to: readonly DimPart[], label: string) => {
    const generatedSide = label === 'generated';
    for (const p of from) {
      const same = to.filter((q) =>
        generatedSide ? sameProps(p, q, colors) : sameProps(q, p, colors),
      );
      for (const pt of samples(p.geom)) {
        const d = Math.min(...same.map((q) => distanceTo(pt, q.geom)));
        if (d <= tol || (nearText(pt) && d <= h)) continue;
        problems.push(
          `${label} ${p.geom.kind} point (${pt.x.toFixed(4)}, ${pt.y.toFixed(4)}) is ${d === Infinity ? 'unmatched' : d.toPrecision(3) + ' off'}`,
        );
        break;
      }
    }
  };
  covered(gp, sp, 'generated');
  covered(sp, gp, 'stored');

  // Arrowheads: SOLIDs by their corners, INSERTs by placement.
  const solids = (ps: readonly DimPart[]) => ps.filter((p) => p.geom.kind === 'SOLID');
  const sameCorners = (a: DimPart, b: DimPart) => {
    if (a.geom.kind !== 'SOLID' || b.geom.kind !== 'SOLID' || !sameProps(b, a, colors))
      return false;
    const ca = a.geom.corners;
    const cb = b.geom.corners;
    return (
      ca.every((p) => cb.some((q) => dist(p, q) <= tol)) &&
      cb.every((p) => ca.some((q) => dist(p, q) <= tol))
    );
  };
  const gs = solids(generated);
  const ss = solids(stored);
  if (gs.length !== ss.length) problems.push(`${gs.length} SOLIDs generated, ${ss.length} stored`);
  for (const a of ss)
    if (!gs.some((b) => sameCorners(a, b))) problems.push('stored SOLID unmatched');
  const inserts = (ps: readonly DimPart[]) => ps.filter((p) => p.geom.kind === 'INSERT');
  const sameInsert = (a: DimPart, b: DimPart) => {
    const x = a.geom;
    const y = b.geom;
    return (
      x.kind === 'INSERT' &&
      y.kind === 'INSERT' &&
      sameProps(b, a, colors) &&
      x.block === y.block &&
      dist(x.position, y.position) <= tol &&
      Math.abs(x.scale.x - y.scale.x) <= tol &&
      angleDiff(x.rotation, y.rotation) <= 1e-6
    );
  };
  const gi = inserts(generated);
  const si = inserts(stored);
  if (gi.length !== si.length)
    problems.push(`${gi.length} arrowhead blocks generated, ${si.length} stored`);
  for (const a of si)
    if (!gi.some((b) => sameInsert(a, b))) problems.push('stored arrowhead block unmatched');

  // Text.
  if (gt.length !== st.length) problems.push(`${gt.length} texts generated, ${st.length} stored`);
  for (const a of st) {
    const b = gt.find((t) => t.contents === a.contents);
    if (!b) {
      problems.push(
        `stored text "${a.contents}" not generated (${gt.map((t) => `"${t.contents}"`).join(', ')})`,
      );
      continue;
    }
    if (dist(a.position, b.position) > h)
      problems.push(`text "${a.contents}" ${dist(a.position, b.position).toPrecision(3)} off`);
    if (angleDiff(a.rotation, b.rotation) > 1e-4)
      problems.push(
        `text "${a.contents}" turned ${angleDiff(a.rotation, b.rotation).toPrecision(3)}`,
      );
    if (Math.abs(a.height - b.height) > tol)
      problems.push(`text "${a.contents}" height ${b.height} ≠ ${a.height}`);
    if (!sameProps(b.part, a.part, colors))
      problems.push(
        `text "${a.contents}" drawn in ${propsLabel(b.part)}, stored ${propsLabel(a.part)}`,
      );
  }

  // Definition points.
  const points = (ps: readonly DimPart[]) =>
    ps
      .filter((p) => p.defpoint && p.geom.kind === 'POINT')
      .map((p) => (p.geom.kind === 'POINT' ? p.geom.position : { x: 0, y: 0 }));
  const gd = points(generated);
  for (const p of points(stored)) {
    if (!gd.some((q) => dist(p, q) <= tol))
      problems.push(`definition point (${p.x}, ${p.y}) not generated`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The health of one dimension: its regenerated parts against its stored block. Undefined when
 * it has no stored block, the engine does not draw its kind, or its text cannot be measured.
 */
export function dimensionHealth(
  e: Entity,
  model: StoredBlocks,
  measure: TextMeasure,
  colors?: ColorMatch,
): DimComparison | undefined {
  const g = e.geom;
  if (!('dimType' in g) || g.block === undefined || !model.blocks.get(g.block)) return undefined;
  const generated = dimensionParts(e, model, measure);
  if (!generated) return undefined;
  const h = dimStyle(g.style, e.xdata, model).textHeight;
  return compareParts(generated, storedParts(g.block, model), h, colors);
}
