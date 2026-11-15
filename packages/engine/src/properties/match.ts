// MATCHPROP's properties (M3-02 part 5), as AutoCAD 2024's Property Settings dialog lists them
// (AutoCAD Help, "Property Settings Dialog Box"): the basic properties every object takes, and
// the special ones only objects of the source's kind take. The text, dimension and multileader
// styles go through the Properties palette's edit (the text placed again where it must be),
// the rest is patched here.
//
// Not offered yet: Viewport, Table and Center object (their objects keep blocks or settings a
// style change must regenerate), and the annotative property (DEC-013).
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityPatch } from '../model/update';
import type { Entity, EntityGeometry, HatchGeometry } from '../model/types';
import { hasThickness, namedPlotStyles, thicknessOf } from './general';
import { patternOrigin } from './sheet';

/** Which properties MATCHPROP copies; all of them until the drafter turns some off. */
export interface MatchSettings {
  readonly color: boolean;
  readonly layer: boolean;
  readonly linetype: boolean;
  readonly ltScale: boolean;
  readonly lineweight: boolean;
  readonly transparency: boolean;
  readonly thickness: boolean;
  readonly plotStyle: boolean;
  readonly dimension: boolean;
  readonly text: boolean;
  readonly hatch: boolean;
  readonly polyline: boolean;
  readonly material: boolean;
  readonly multileader: boolean;
}

export const ALL_MATCH_SETTINGS: MatchSettings = {
  color: true,
  layer: true,
  linetype: true,
  ltScale: true,
  lineweight: true,
  transparency: true,
  thickness: true,
  plotStyle: true,
  dimension: true,
  text: true,
  hatch: true,
  polyline: true,
  material: true,
  multileader: true,
};

/** AutoCAD's names for the settings, in the order "Current active settings" lists them. */
export const MATCH_SETTING_NAMES: readonly [keyof MatchSettings, string][] = [
  ['color', 'Color'],
  ['layer', 'Layer'],
  ['linetype', 'Ltype'],
  ['ltScale', 'Ltscale'],
  ['lineweight', 'Lineweight'],
  ['transparency', 'Transparency'],
  ['thickness', 'Thickness'],
  ['plotStyle', 'PlotStyle'],
  ['dimension', 'Dim'],
  ['text', 'Text'],
  ['hatch', 'Hatch'],
  ['polyline', 'Polyline'],
  ['material', 'Material'],
  ['multileader', 'Multileader'],
];

/** "Current active settings:  Color Layer …". */
export function activeSettingsLine(s: MatchSettings): string {
  const on = MATCH_SETTING_NAMES.filter(([k]) => s[k]).map(([, n]) => n);
  return `Current active settings:  ${on.join(' ')}`;
}

/** Objects that take no linetype or linetype scale of their own from MATCHPROP. */
const NO_LINETYPE = new Set(['HATCH', 'MTEXT', 'POINT', 'VIEWPORT']);

const isDimensionLike = (g: EntityGeometry): boolean =>
  g.kind === 'DIMENSION' || g.kind === 'LEADER' || g.kind === 'TOLERANCE';
const isText = (g: EntityGeometry): boolean => g.kind === 'TEXT' || g.kind === 'MTEXT';
const isPolyline = (g: EntityGeometry): boolean =>
  g.kind === 'LWPOLYLINE' || (g.kind === 'POLYLINE' && !g.is3d);

/** The polyline's one width, or undefined when its segments differ. */
function uniformWidth(g: EntityGeometry): number | undefined {
  if (g.kind === 'LWPOLYLINE') {
    if (g.vertices.every((v) => v.startWidth === undefined && v.endWidth === undefined)) {
      return g.constantWidth ?? 0;
    }
  } else if (g.kind !== 'POLYLINE') return undefined;
  const dsw = g.kind === 'POLYLINE' ? (g.startWidth ?? 0) : (g.constantWidth ?? 0);
  const dew = g.kind === 'POLYLINE' ? (g.endWidth ?? 0) : (g.constantWidth ?? 0);
  const n = g.closed ? g.vertices.length : g.vertices.length - 1;
  const ws = g.vertices
    .slice(0, Math.max(0, n))
    .flatMap((v) => [v.startWidth ?? dsw, v.endWidth ?? dew]);
  const w = ws[0] ?? 0;
  return ws.every((x) => x === w) ? w : undefined;
}

/** `target` given `width` everywhere and `plinegen` (MATCHPROP's Polyline). */
function polylineMatch(
  target: EntityGeometry,
  width: number | undefined,
  plinegen: boolean,
): EntityGeometry {
  if (target.kind !== 'LWPOLYLINE' && target.kind !== 'POLYLINE') return target;
  let g: EntityGeometry = target;
  if (width !== undefined) {
    const vertices = target.vertices.map(({ startWidth: _s, endWidth: _e, ...v }) => v);
    if (target.kind === 'LWPOLYLINE') {
      const { constantWidth: _c, ...rest } = target;
      g = { ...rest, vertices, ...(width !== 0 && { constantWidth: width }) };
    } else {
      const { startWidth: _s, endWidth: _e, ...rest } = target;
      g = { ...rest, vertices, ...(width !== 0 && { startWidth: width, endWidth: width }) };
    }
  }
  const { plinegen: _p, ...rest } = g as typeof target;
  return (plinegen ? { ...rest, plinegen: true } : rest) as EntityGeometry;
}

/** `target` hatched as `source`, its boundary and origin kept (AutoCAD: "To match the hatch origin, use Inherit Properties"). */
function hatchMatch(target: HatchGeometry, source: HatchGeometry): HatchGeometry {
  const from = patternOrigin(source);
  const to = patternOrigin(target);
  const shift = (p: Vec2): Vec2 => ({ x: p.x - from.x + to.x, y: p.y - from.y + to.y });
  const { gradient: _g, ...rest } = target;
  return {
    ...rest,
    pattern: source.pattern,
    solid: source.solid,
    style: source.style,
    patternType: source.patternType,
    patternAngle: source.patternAngle,
    patternScale: source.patternScale,
    double: source.double,
    patternLines: source.patternLines.map((l) => ({ ...l, base: shift(l.base) })),
    ...(source.gradient && { gradient: source.gradient }),
  };
}

/**
 * What MATCHPROP changes of `target` from `source` directly (all but the styles the palette's
 * edit places: `matchedStyles`), or undefined when nothing changes.
 */
export function matchedPatch(
  model: DocumentModel,
  source: Entity,
  target: Entity,
  s: MatchSettings,
): EntityPatch | undefined {
  const patch: Record<string, unknown> = {};
  const set = (k: keyof Entity, v: unknown) => {
    if (JSON.stringify(target[k]) !== JSON.stringify(v)) patch[k] = v;
  };
  const tg = target.geom;
  if (s.color) set('color', source.color);
  if (s.layer) set('layer', source.layer);
  if (!NO_LINETYPE.has(tg.kind)) {
    if (s.linetype) set('linetype', source.linetype);
    if (s.ltScale) set('ltScale', source.ltScale);
  }
  if (s.lineweight) set('lineweight', source.lineweight);
  if (s.transparency) set('transparency', source.transparency);
  if (s.plotStyle && namedPlotStyles(model)) set('plotStyle', source.plotStyle);
  if (s.material) set('material', source.material);
  let geom: EntityGeometry = tg;
  if (s.thickness && hasThickness(target)) {
    const t = thicknessOf(source);
    const { thickness: _t, ...rest } = geom as EntityGeometry & { thickness?: number };
    geom = (t === 0 ? rest : { ...rest, thickness: t }) as EntityGeometry;
  }
  const sg = source.geom;
  if (s.polyline && isPolyline(sg) && isPolyline(geom)) {
    geom = polylineMatch(geom, uniformWidth(sg), (sg as { plinegen?: boolean }).plinegen === true);
  }
  if (s.hatch && sg.kind === 'HATCH' && geom.kind === 'HATCH') geom = hatchMatch(geom, sg);
  if (s.dimension && (sg.kind === 'LEADER' || sg.kind === 'TOLERANCE')) {
    // A dimension's style goes through the palette's edit (its block is drawn again).
    if (geom.kind === 'LEADER' || geom.kind === 'TOLERANCE') geom = { ...geom, style: sg.style };
  }
  if (JSON.stringify(geom) !== JSON.stringify(tg)) patch.geom = geom;
  return Object.keys(patch).length > 0 ? (patch as EntityPatch) : undefined;
}

/**
 * The Properties palette edits that give `targets` the source's styles: a dimension's style
 * (from a dimension, leader or tolerance), a text's (from a TEXT or MTEXT) and a multileader's.
 */
export function matchedStyles(
  source: Entity,
  targets: readonly Entity[],
  s: MatchSettings,
): { key: string; value: string; ids: Entity['id'][] }[] {
  const sg = source.geom;
  const out: { key: string; value: string; ids: Entity['id'][] }[] = [];
  const add = (key: string, value: string | undefined, f: (g: EntityGeometry) => boolean) => {
    if (value === undefined) return;
    const ids = targets
      .filter((t) => f(t.geom) && (t.geom as { style?: string }).style !== value)
      .map((t) => t.id);
    if (ids.length > 0) out.push({ key, value, ids });
  };
  if (s.dimension && isDimensionLike(sg)) {
    add('dimStyle', (sg as { style: string }).style, (g) => g.kind === 'DIMENSION');
  }
  if (s.text && isText(sg)) add('style', (sg as { style: string }).style, isText);
  if (s.multileader && sg.kind === 'MULTILEADER') {
    add('mleaderStyle', sg.style, (g) => g.kind === 'MULTILEADER');
  }
  return out;
}
