// The jog line of a linear or aligned dimension (M4-01; DIMJOGLINE makes it, M4-02). AutoCAD
// 2024 Help, DIMJOGLINE: "Adds or removes a jog line on a linear or aligned dimension. Jog lines
// in a dimension indicate a broken dimension line. The dimension value represents the actual
// distance, rather than the measured distance in the drawing." The jog's height is the
// dimension style's Jog Height Factor times the text height (DIMSTYLE dialog, Symbols and
// Arrows tab: "Linear Jog Height Factor").
//
// AutoCAD files both as xdata (its DXF reference documents neither):
// - the dimension style's factor as `ACAD_DSTYLE_DIMJAG`: `1070 388`, `1040 <factor>` (every
//   DIMSTYLE of the acadsharp R2007+ samples, all 1.5, AutoCAD's default);
// - the jog itself on the dimension as `ACAD_DSTYLE_DIMJAG_POSITION`: `1070 387`, `1070 <n>`,
//   `1070 389`, `1010 <point>`, the point where the jog was placed (WCS).
// No corpus file holds a jog, so the second layout is our reading of AutoCAD's files, recorded
// in the M4-01 PR: the reader takes the point after `1070 389` whatever 387's value is, and
// the drawing puts the jog where that point falls on the dimension line, so a point stored off
// the line still draws the jog on it.
import type { AnnotationTables } from './multileader';
import type { Vec2 } from '../geom/types';
import type { Handle } from '../model/handle';
import type { Xdata, XdataApp } from '../model/types';

export const LINEAR_JOG_APP = 'ACAD_DSTYLE_DIMJAG_POSITION';
export const JOG_HEIGHT_APP = 'ACAD_DSTYLE_DIMJAG';
/** AutoCAD's Jog Height Factor when the style keeps none. */
export const DEFAULT_JOG_HEIGHT_FACTOR = 1.5;

const appNamed = (a: XdataApp, model: AnnotationTables, name: string) =>
  model.tables.appIds.get(a.appId)?.name.toUpperCase() === name;

/** The point after `1070 <code>` in an xdata list, when it is one. */
function pointAfter(values: XdataApp['values'], code: number): Vec2 | undefined {
  for (let i = 0; i + 1 < values.length; i++) {
    if (values[i]!.code !== 1070 || Number(values[i]!.value) !== code) continue;
    const v = values[i + 1]!;
    if (v.code !== 1010 || typeof v.value !== 'object' || !('x' in v.value)) return undefined;
    const { x, y } = v.value;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
  }
  return undefined;
}

/** The number after `1070 <code>` in an xdata list, when it is a positive real. */
function realAfter(values: XdataApp['values'], code: number): number | undefined {
  for (let i = 0; i + 1 < values.length; i++) {
    if (values[i]!.code !== 1070 || Number(values[i]!.value) !== code) continue;
    const v = values[i + 1]!;
    const n = v.code === 1040 ? Number(v.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

/** Where a linear or aligned dimension's jog was placed; undefined when it has none. */
export function linearJog(xdata: Xdata | undefined, model: AnnotationTables): Vec2 | undefined {
  const app = xdata?.find((a) => appNamed(a, model, LINEAR_JOG_APP));
  return app ? pointAfter(app.values, 389) : undefined;
}

/**
 * The Jog Height Factor a dimension draws its jog with: the dimension's own `ACAD_DSTYLE_DIMJAG`
 * entry (an override), else its style's, else AutoCAD's 1.5.
 */
export function jogHeightFactor(
  style: Handle,
  xdata: Xdata | undefined,
  model: AnnotationTables,
): number {
  const from = (list: Xdata | undefined) => {
    const app = list?.find((a) => appNamed(a, model, JOG_HEIGHT_APP));
    return app ? realAfter(app.values, 388) : undefined;
  };
  return from(xdata) ?? from(model.tables.dimStyles.get(style)?.xdata) ?? DEFAULT_JOG_HEIGHT_FACTOR;
}

/** The xdata entry placing a jog at `at`, as AutoCAD lays it out. */
export const linearJogXdata = (appId: Handle, at: Vec2): XdataApp => ({
  appId,
  values: [
    { code: 1070, value: 387 },
    { code: 1070, value: 1 },
    { code: 1070, value: 389 },
    { code: 1010, value: { x: at.x, y: at.y, z: 0 } },
  ],
});

/**
 * `xdata` with its jog entry placing the jog at `at`: the point after 389 replaced in the list
 * as read (its other values kept), or AutoCAD's layout added when there is none.
 */
export function withLinearJog(xdata: Xdata | undefined, appId: Handle, at: Vec2): Xdata {
  const point = { code: 1010, value: { x: at.x, y: at.y, z: 0 } };
  const moved = (a: XdataApp): XdataApp => {
    const i = a.values.findIndex(
      (v, k) => v.code === 1070 && Number(v.value) === 389 && a.values[k + 1]?.code === 1010,
    );
    if (i < 0) return linearJogXdata(appId, at);
    return { appId, values: a.values.map((v, k) => (k === i + 1 ? point : v)) };
  };
  const out = (xdata ?? []).map((a) => (a.appId === appId ? moved(a) : a));
  return out.some((a) => a.appId === appId) ? out : [...out, linearJogXdata(appId, at)];
}
