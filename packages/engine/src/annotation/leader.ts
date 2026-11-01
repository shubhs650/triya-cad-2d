// LEADER as the parts AutoCAD draws for it (M1-52 part 2, ARCHITECTURE.md §9 "Leaders"): its
// path and its arrowhead, styled by its DIMSTYLE with the entity's own overrides. Its text is
// a separate MTEXT (or TOLERANCE, or INSERT) entity that draws itself.
//
// AutoCAD rules encoded here, from the DXF reference (LEADER, DIMSTYLE) and, where it is
// silent, what AutoCAD files show as ezdxf reads them (MIT; `render/leader.py`):
// - Style values come from the DIMSTYLE (DXF 3) with the entity's overrides on top: the ACAD
//   xdata `DSTYLE` list of (DIMVAR group code, value) pairs, as DIMSTYLE override does.
// - The path runs through the vertices, which already end with the hook line AutoCAD drew.
//   With MTEXT annotation (DXF 73 = 0), a hook line (75) and text above the line (DIMTAD ≠ 0),
//   the path goes on under the text by DIMGAP × DIMSCALE + the text width (DXF 41) along the
//   horizontal direction (211), reversed when DXF 74 is 1. The DXF reference describes DXF 74
//   the other way round; files written by AutoCAD follow this reading.
// - The arrowhead (DXF 71) is DIMLDRBLK, or closed filled when it names no block, DIMASZ ×
//   DIMSCALE long at the first vertex, pointing away from the second. DIMSCALE 0 (scale to the
//   viewport) draws at 1 in model space. The line runs to the tip, under the arrowhead.
// - DIMCLRD, DIMLTYPE and DIMLWD colour, dash and weight the path and arrowhead; ByBlock
//   means the leader's own.
// Spline leaders (DXF 72 = 1) are fit-point splines (M1-47), as for MULTILEADER.

import type { Vec2 } from '../geom/types';
import type { Handle } from '../model/handle';
import type {
  Color,
  DimVarValue,
  Entity,
  LeaderGeometry,
  LinetypeRef,
  Lineweight,
} from '../model/types';
import {
  arrowheadParts,
  linetypeRef,
  type AnnotationPart,
  type AnnotationTables,
} from './multileader';

/** DIMVARs leaders and tolerances read, by their DXF group code in a `DSTYLE` override list. */
const DSTYLE_VARS: Readonly<Record<number, string>> = {
  40: 'DIMSCALE',
  41: 'DIMASZ',
  77: 'DIMTAD',
  140: 'DIMTXT',
  147: 'DIMGAP',
  176: 'DIMCLRD',
  178: 'DIMCLRT',
  340: 'DIMTXSTY',
  341: 'DIMLDRBLK',
  345: 'DIMLTYPE',
  371: 'DIMLWD',
};

/**
 * A dimension-like entity's DIMVARs: its style's, with the `DSTYLE` overrides in its ACAD
 * xdata applied (each override a 1070 group code followed by its value).
 */
export function dimVars(
  style: Handle,
  xdata: Entity['xdata'],
  model: AnnotationTables,
): Readonly<Record<string, DimVarValue>> {
  const vars: Record<string, DimVarValue> = { ...model.tables.dimStyles.get(style)?.vars };
  for (const app of xdata ?? []) {
    if (model.tables.appIds.get(app.appId)?.name.toUpperCase() !== 'ACAD') continue;
    const v = app.values;
    const at = v.findIndex((x) => x.code === 1000 && x.value === 'DSTYLE');
    if (at < 0) continue;
    for (let i = at + 2; i + 1 < v.length; i += 2) {
      const code = v[i]!;
      if (code.code !== 1070) break; // the closing 1002 "}"
      const name = DSTYLE_VARS[Number(code.value)];
      const value = v[i + 1]!.value;
      if (name && (typeof value === 'number' || typeof value === 'string')) vars[name] = value;
    }
  }
  return vars;
}

export const dimNum = (v: DimVarValue | undefined, fallback: number): number =>
  typeof v === 'number' ? v : fallback;

/** A DIMVAR colour (ACI 0 ByBlock, 256 ByLayer). */
export function dimColor(v: DimVarValue | undefined): Color | undefined {
  if (typeof v !== 'number') return undefined;
  if (v === 0) return { kind: 'byBlock' };
  if (v === 256) return { kind: 'byLayer' };
  return { kind: 'aci', index: v };
}

/** A DIMVAR lineweight (hundredths of a mm; −1 ByLayer, −2 ByBlock, −3 default). */
export function dimLineweight(v: DimVarValue | undefined): Lineweight | undefined {
  if (typeof v !== 'number') return undefined;
  if (v === -1) return 'ByLayer';
  if (v === -2) return 'ByBlock';
  if (v === -3) return 'Default';
  return v;
}

/** The parts a LEADER draws: its path (an LWPOLYLINE, or a fit-point SPLINE) and arrowhead. */
export function leaderParts(
  g: LeaderGeometry,
  xdata: Entity['xdata'],
  model: AnnotationTables,
): AnnotationPart[] {
  const pts: Vec2[] = [...g.vertices];
  if (pts.length < 2) return [];
  const vars = dimVars(g.style, xdata, model);
  const dimscale = dimNum(vars.DIMSCALE, 1) || 1;
  const color = dimColor(vars.DIMCLRD);
  const linetype: LinetypeRef | undefined =
    typeof vars.DIMLTYPE === 'string' ? linetypeRef(model, vars.DIMLTYPE) : undefined;
  const lineweight = dimLineweight(vars.DIMLWD);
  const props = {
    ...(color ? { color } : {}),
    ...(linetype ? { linetype } : {}),
    ...(lineweight !== undefined ? { lineweight } : {}),
  };

  if (g.creationType === 0 && g.hookline && dimNum(vars.DIMTAD, 0) !== 0 && g.textWidth > 0) {
    const len = Math.hypot(g.horizontalDirection.x, g.horizontalDirection.y);
    if (len > 0) {
      const k =
        ((g.hookline.sameDirection ? -1 : 1) * (dimNum(vars.DIMGAP, 0) * dimscale + g.textWidth)) /
        len;
      const last = pts[pts.length - 1]!;
      pts.push({
        x: last.x + g.horizontalDirection.x * k,
        y: last.y + g.horizontalDirection.y * k,
      });
    }
  }

  const out: AnnotationPart[] = [];
  if (g.arrowhead) {
    const size = dimNum(vars.DIMASZ, 0) * dimscale;
    const block = typeof vars.DIMLDRBLK === 'string' ? vars.DIMLDRBLK : undefined;
    out.push(...arrowheadParts(pts[0]!, pts[1]!, size, block, model, props).parts);
  }
  out.push({
    ...props,
    geom: g.spline
      ? {
          kind: 'SPLINE',
          degree: 3,
          knots: [],
          controlPoints: [],
          fitPoints: pts,
          closed: false,
          periodic: false,
        }
      : {
          kind: 'LWPOLYLINE',
          vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })),
          closed: false,
        },
  });
  return out;
}
