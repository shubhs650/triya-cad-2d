// Value conversions shared by the AcadToTriya mappers (ARCHITECTURE.md §6.1).

import type { CadObject, Color as AcadColor } from '@node-projects/acad-ts';
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

// The ACI AutoCAD stores for a true colour: in DXF 62 beside 420, in DIMSTYLE groups 176–178
// (which hold no true colour), and in R2000 saves (M1-55). It is the nearest entry by squared RGB
// distance in the palette below, lowest index on a tie, over 1–255. This palette's hue rows have
// the values 1, 0.8, 0.6, 0.5 and 0.3 of 255 (the table published as AutoCAD's, e.g. ACI 12 =
// 204,0,0), each at full (even index) and half (odd index) saturation. It reproduces every one of
// the 21 distinct true colours AutoCAD wrote with an ACI in the public corpus
// (true-color.corpus.test.ts); the 0.65/0.5/0.3/0.15 rows acad-ts and `aciRgb` use get 7 of them
// wrong (M1-57). The greys 250–254 are the published table's; no corpus colour tests them.
const LOOKUP_VALUES = [1, 0.8, 0.6, 0.5, 0.3];
const LOOKUP_GREYS = [51, 80, 105, 130, 190, 255];
const LOOKUP_NAMED = [
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255],
  [128, 128, 128],
  [192, 192, 192],
] as const;

function lookupRgb(index: number): readonly [number, number, number] {
  if (index < 10) return LOOKUP_NAMED[index - 1]!;
  if (index >= 250) {
    const g = LOOKUP_GREYS[index - 250]!;
    return [g, g, g];
  }
  const hue = (Math.floor(index / 10) - 1) * 15;
  const v = 255 * LOOKUP_VALUES[Math.floor((index % 10) / 2)]!;
  const min = index % 2 ? v / 2 : 0;
  const f = (hue % 60) / 60;
  const up = min + (v - min) * f;
  const down = v - (v - min) * f;
  const sectors = [
    [v, up, min],
    [down, v, min],
    [min, v, up],
    [min, down, v],
    [up, min, v],
    [v, min, down],
  ] as const;
  const [r, g, b] = sectors[Math.floor(hue / 60)]!;
  return [Math.floor(r), Math.floor(g), Math.floor(b)];
}

const LOOKUP: readonly (readonly [number, number, number])[] = Array.from({ length: 255 }, (_, i) =>
  lookupRgb(i + 1),
);

/** The ACI (1–255) AutoCAD writes for the true colour `r, g, b`. */
export function aciOfTrueColor(r: number, g: number, b: number): number {
  let best = 1;
  let bestDist = Infinity;
  LOOKUP.forEach(([pr, pg, pb], i) => {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i + 1;
    }
  });
  return best;
}

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
