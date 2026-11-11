// The arc a radius or diameter dimension was made on (M2-31 part 2), which its arc extension
// line follows when the dimension line is placed past the arc's ends. AutoCAD 2024 Help,
// "About Creating Radial Dimensions": "If a dimension is positioned past the end of an arc,
// either an extension line will be drawn that follows the path of the arc being dimensioned or
// no extension line will be drawn"; DIMSE1 suppresses it and DIMEXO is its gap from the arc.
//
// AutoCAD files it as `ACAD_DSTYLE_DIMRADIAL_EXTENSION` xdata on the dimension: `1070 387`,
// `1070 1`, `1070 388`, `1040 <angle>`, `1070 390`, `1040 <angle>` (every radial dimension of
// the acadsharp samples, all with both angles 0; ezdxf's source calls the meaning unknown).
// Triya reads 388 and 390 as the dimensioned arc's start and end angles (radians, counter-
// clockwise, in the dimension's plane), both 0 meaning no arc (a circle): the dimension is not
// associative, so it must keep the arc's extent to draw the extension again when a grip moves
// its chord point. That reading is our assumption, recorded in the M2-31 part 2 PR; AutoCAD's
// ObjectARX calls the values the extension arc's start and end angles, which for a location
// inside the arc draws the same arc over the arc itself.
import type { AnnotationTables } from './multileader';
import type { Handle } from '../model/handle';
import type { Xdata, XdataApp } from '../model/types';

export const RADIAL_EXTENSION_APP = 'ACAD_DSTYLE_DIMRADIAL_EXTENSION';

/** The arc a radial dimension measures: its start and end angles, counter-clockwise. */
export interface RadialArc {
  readonly startAngle: number;
  readonly endAngle: number;
}

/** The drawing's APPID record for the radial extension, undefined when it has none. */
export function radialExtensionAppId(model: AnnotationTables): Handle | undefined {
  for (const r of model.tables.appIds.values()) {
    if (r.name.toUpperCase() === RADIAL_EXTENSION_APP) return r.handle;
  }
  return undefined;
}

const isApp = (a: XdataApp, model: AnnotationTables) =>
  model.tables.appIds.get(a.appId)?.name.toUpperCase() === RADIAL_EXTENSION_APP;

/** The arc a radial dimension's xdata names; undefined for none (both angles 0, or absent). */
export function radialArc(
  xdata: Xdata | undefined,
  model: AnnotationTables,
): RadialArc | undefined {
  const app = xdata?.find((a) => isApp(a, model));
  if (!app) return undefined;
  let startAngle: number | undefined;
  let endAngle: number | undefined;
  const v = app.values;
  for (let i = 0; i + 1 < v.length; i++) {
    if (v[i]!.code !== 1070 || v[i + 1]!.code !== 1040) continue;
    const value = Number(v[i + 1]!.value);
    if (Number(v[i]!.value) === 388) startAngle = value;
    if (Number(v[i]!.value) === 390) endAngle = value;
  }
  if (startAngle === undefined || endAngle === undefined) return undefined;
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) return undefined;
  if (startAngle === 0 && endAngle === 0) return undefined;
  return { startAngle, endAngle };
}

/** The xdata entry naming `arc` (none: both angles 0), as AutoCAD lays it out. */
export const radialExtensionXdata = (appId: Handle, arc: RadialArc | undefined): XdataApp => ({
  appId,
  values: [
    { code: 1070, value: 387 },
    { code: 1070, value: 1 },
    { code: 1070, value: 388 },
    { code: 1040, value: arc?.startAngle ?? 0 },
    { code: 1070, value: 390 },
    { code: 1040, value: arc?.endAngle ?? 0 },
  ],
});

/** `xdata` with its radial extension entry replaced by one for `arc` (added when absent). */
export function withRadialArc(
  xdata: Xdata | undefined,
  appId: Handle,
  arc: RadialArc | undefined,
): Xdata {
  const entry = radialExtensionXdata(appId, arc);
  const out = (xdata ?? []).map((a) => (a.appId === appId ? entry : a));
  return out.some((a) => a.appId === appId) ? out : [...out, entry];
}
