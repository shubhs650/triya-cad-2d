// Value conversions shared by the AcadToTriya mappers (ARCHITECTURE.md §6.1).

import type { CadObject, Color as AcadColor } from '@node-projects/acad-ts';
import { aciOfTrueColor } from '@triya/engine';
import type {
  Color,
  Handle,
  Lineweight,
  ObjectCommon,
  Vec2,
  Vec3,
  Xdata,
  XdataValue,
} from '@triya/engine';

/** acad-ts keeps handles as numbers; Triya as canonical upper-case hex. */
export const hex = (n: number | bigint): Handle => n.toString(16).toUpperCase();

/** Handle of a referenced object, or undefined for none (null object or handle 0). */
export function ref(o: { readonly handle: number } | null | undefined): Handle | undefined {
  return o && o.handle !== 0 ? hex(o.handle) : undefined;
}

export const vec2 = (p: { readonly x: number; readonly y: number }): Vec2 => ({ x: p.x, y: p.y });
export const vec3 = (p: { readonly x: number; readonly y: number; readonly z: number }): Vec3 => ({
  x: p.x,
  y: p.y,
  z: p.z,
});

// `aciOfTrueColor` moved to the engine (M2-30 part 3) so the dimension health check can use
// it on the render side; re-exported here for the mappers and writers.
export { aciOfTrueColor } from '@triya/engine';

/** A colour as a DXF 62 number: ByBlock 0, ByLayer 256, a true colour as AutoCAD's ACI for it. */
export function colorNumber(c: AcadColor): number {
  return c.isTrueColor ? aciOfTrueColor(c.r, c.g, c.b) : c.index;
}

/** DXF 62/420: ACI 0 is ByBlock and 256 ByLayer; true colours carry their RGB. */
export function mapColor(c: AcadColor): Color {
  if (c.isByLayer) return { kind: 'byLayer' };
  if (c.isByBlock) return { kind: 'byBlock' };
  if (c.isTrueColor) return { kind: 'rgb', r: c.r, g: c.g, b: c.b };
  return { kind: 'aci', index: c.index };
}

/**
 * An AcCmEntityColor (MULTILEADER and MLEADERSTYLE colours). acad-ts decodes it from DXF and
 * DWG alike (patch 0122); the method None (ACI 257 there) is taken as ByBlock.
 */
export function mapEntityColor(c: AcadColor): Color {
  return c.index === 257 ? { kind: 'byBlock' } : mapColor(c);
}

/** DXF 370: hundredths of a millimetre, or −1 ByLayer, −2 ByBlock, −3 Default. */
export function mapLineweight(w: number): Lineweight {
  if (w === -1) return 'ByLayer';
  if (w === -2) return 'ByBlock';
  if (w === -3) return 'Default';
  return w;
}

function xdataValue(code: number, raw: unknown): XdataValue {
  if (typeof raw === 'object' && raw !== null && 'x' in raw && 'y' in raw && 'z' in raw) {
    return { code, value: vec3(raw as Vec3) };
  }
  // 1005 database handles are numbers in acad-ts; Triya keeps every handle as hex text.
  if (code === 1005 && (typeof raw === 'number' || typeof raw === 'bigint')) {
    return { code, value: hex(raw) };
  }
  return { code, value: raw as XdataValue['value'] };
}

/** Extended data per application, in file order, as read. */
export function mapXdata(o: CadObject): Xdata | undefined {
  const out: { appId: Handle; values: XdataValue[] }[] = [];
  for (const [app, data] of o.extendedData) {
    out.push({
      appId: hex(app.handle),
      values: data.records.map((r) => xdataValue(r.code as number, r.rawValue)),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** The fields every handle-bearing record carries from the file (ObjectCommon). */
export function common(o: CadObject): ObjectCommon {
  const handle = hex(o.handle);
  const xdata = mapXdata(o);
  const reactors = o.reactors.map((r) => hex(r.handle));
  const extDict = ref(o.xDictionary);
  return {
    handle,
    ...(xdata ? { xdata } : {}),
    ...(reactors.length > 0 ? { reactors } : {}),
    ...(extDict ? { extDict } : {}),
    raw: { handle },
  };
}
