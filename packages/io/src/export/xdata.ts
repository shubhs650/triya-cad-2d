// TriyaToAcad for an entity's extended data (M1-75 part 19): the xdata an entity or an ATTRIB
// carries per registered application (DXF 1001, then the 1000–1071 groups), new or edited, so
// that COPY, MIRROR and ARRAY can save the xdata their new entities take from the source,
// HYPERLINK its PE_URL xdata and DIMOVERRIDE the ACAD DSTYLE xdata of a dimension.
//
// An application whose values did not change keeps the records it was read with, untouched
// (§6.2 rule 2), and the applications are written in the model's order. Values follow the DXF
// reference's "Group codes in extended data" and AutoCAD's limits (ObjectARX acdbEntMod):
// strings of at most 255 characters, binary chunks of at most 127 bytes, braces that pair up
// and 16 KB per object; AutoCAD Release 11 (AC1009, shared with R12) introduced xdata, so an
// older file cannot take any (export.ts). AutoCAD drops an application that has no values, so the model states
// that by leaving it out. Triya does not write the annotative property yet (M1-75), and
// `AcadAnnotative` xdata goes with the context data in the entity's extension dictionary, so
// changing it is refused like the property.

import {
  AppId,
  ExtendedData,
  ExtendedDataBinaryChunk,
  ExtendedDataControlString,
  ExtendedDataCoordinate,
  ExtendedDataDirection,
  ExtendedDataDisplacement,
  ExtendedDataDistance,
  ExtendedDataHandle,
  ExtendedDataInteger16,
  ExtendedDataInteger32,
  ExtendedDataLayer,
  ExtendedDataReal,
  ExtendedDataScale,
  ExtendedDataString,
  ExtendedDataWorldCoordinate,
  Layer,
  XYZ,
  type CadObject,
  type ExtendedDataRecord,
} from '@node-projects/acad-ts';
import type { Entity, EntityInit, Handle, Vec3, Xdata, XdataApp, XdataValue } from '@triya/engine';
import { resolve, same, type Resolver } from './entities';

/** AutoCAD's limit on the xdata of one object (ObjectARX: "16K bytes"). */
const MAX_BYTES = 16 * 1024;
/** DXF reference: strings in extended data "can be up to 255 bytes long". */
const MAX_STRING = 255;
/** DXF reference: 1004 binary data "is organized into variable-length chunks", 127 bytes each. */
const MAX_CHUNK = 127;

const POINT_CODES = new Set([1010, 1011, 1012, 1013]);
const REAL_CODES = new Set([1040, 1041, 1042]);

const isPoint = (v: unknown): v is Vec3 =>
  typeof v === 'object' &&
  v !== null &&
  !ArrayBuffer.isView(v) &&
  [(v as Vec3).x, (v as Vec3).y, (v as Vec3).z].every(Number.isFinite);

const integer = (v: unknown): number | undefined =>
  typeof v === 'bigint' ? Number(v) : typeof v === 'number' && Number.isInteger(v) ? v : undefined;

const isHandle = (v: unknown): v is string => typeof v === 'string' && /^[0-9A-F]+$/i.test(v);

/** Why one value cannot be written, or undefined. */
function valueProblem(r: Resolver, { code, value }: XdataValue): string | undefined {
  if (code === 1000) {
    if (typeof value !== 'string') return `1000 holds a string`;
    if (value.length > MAX_STRING) return `a string longer than ${MAX_STRING} characters`;
    // A DXF group is one line.
    if (/[\r\n]/.test(value)) return 'a line break in a string';
    return undefined;
  }
  if (code === 1002) return value === '{' || value === '}' ? undefined : '1002 holds { or }';
  if (code === 1003) {
    // acad-ts keeps a 1003 as the layer's handle (it writes the name to DXF), as Triya maps it.
    const h = integer(value);
    return h !== undefined && h > 0 && resolve(r, h.toString(16).toUpperCase(), Layer)
      ? undefined
      : `1003 ${String(value)} names no layer`;
  }
  if (code === 1004) {
    if (!(value instanceof Uint8Array)) return '1004 holds bytes';
    return value.length > MAX_CHUNK ? `a binary chunk longer than ${MAX_CHUNK} bytes` : undefined;
  }
  // A 1005 may name an object the drawing does not hold, as AutoCAD keeps one to an erased
  // object; both writers write it as read (acad-ts patches 0029 and 0149).
  if (code === 1005) return isHandle(value) ? undefined : `1005 ${String(value)} is not a handle`;
  if (POINT_CODES.has(code)) return isPoint(value) ? undefined : `${code} holds a finite point`;
  if (REAL_CODES.has(code)) {
    return typeof value === 'number' && Number.isFinite(value)
      ? undefined
      : `${code} holds a finite number`;
  }
  if (code === 1070) {
    const n = integer(value);
    return n !== undefined && n >= -0x8000 && n <= 0x7fff
      ? undefined
      : `${code} holds a 16-bit integer`;
  }
  if (code === 1071) {
    const n = integer(value);
    return n !== undefined && n >= -0x80000000 && n <= 0x7fffffff
      ? undefined
      : `${code} holds a 32-bit integer`;
  }
  return `group code ${code} is not an extended data value`;
}

/**
 * The size of one application's values as an R2007+ DWG stores them (a code byte, then UTF-16
 * strings with their length and terminator, the bytes, 8-byte handles and reals, 24-byte points),
 * plus its size and application handle: the largest of the formats, so within 16 KB anywhere.
 */
function size(values: readonly XdataValue[]): number {
  let n = 2 + 8;
  for (const { code, value } of values) {
    n += 1;
    if (code === 1000) n += 2 + 2 * ((value as string).length + 1);
    else if (code === 1002) n += 1;
    else if (code === 1004) n += 1 + (value as Uint8Array).length;
    else if (code === 1070) n += 2;
    else if (code === 1071) n += 4;
    else if (POINT_CODES.has(code)) n += 24;
    else n += 8;
  }
  return n;
}

const byApp = (x: Xdata | undefined): Map<Handle, XdataApp> =>
  new Map((x ?? []).map((a) => [a.appId, a]));

/** The applications whose values differ from `before` (added, edited or dropped). */
export function changedApps(before: Xdata | undefined, after: Xdata | undefined): Set<Handle> {
  const was = byApp(before);
  const now = byApp(after);
  const out = new Set<Handle>();
  for (const [h, a] of now) if (!same(was.get(h)?.values, a.values)) out.add(h);
  for (const h of was.keys()) if (!now.has(h)) out.add(h);
  return out;
}

/** Whether the entity's or one of its ATTRIBs' xdata differs from `before` (undefined: new). */
export function xdataChanges(before: EntityInit | undefined, after: Entity): boolean {
  if (changedApps(before?.xdata, after.xdata).size > 0) return true;
  if (after.geom.kind !== 'INSERT') return false;
  const was = new Map(
    (before?.geom.kind === 'INSERT' ? before.geom.attributes : []).map((a) => [a.handle, a]),
  );
  return after.geom.attributes.some((a) => changedApps(was.get(a.handle)?.xdata, a.xdata).size > 0);
}

const appName = (r: Resolver, h: Handle): string | undefined => resolve(r, h, AppId)?.name;

/** Why the xdata change from `before` (undefined: a new object) to `after` cannot be written. */
export function xdataProblems(
  r: Resolver,
  before: Xdata | undefined,
  after: Xdata | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<Handle>();
  for (const a of after ?? []) {
    if (seen.has(a.appId)) out.push(`application ${a.appId} listed twice`);
    seen.add(a.appId);
  }
  let bytes = 0;
  for (const a of after ?? []) bytes += size(a.values);
  for (const h of changedApps(before, after)) {
    const name = appName(r, h);
    const now = (after ?? []).find((a) => a.appId === h);
    if (name?.toUpperCase() === 'ACADANNOTATIVE') {
      out.push(`${name} xdata changes (the annotative property is not written yet)`);
      continue;
    }
    if (!now) continue;
    if (!name) {
      out.push(`application ${h} is not a registered application (APPID) of the drawing`);
      continue;
    }
    if (now.values.length === 0) out.push(`${name}: no values (AutoCAD drops the application)`);
    let depth = 0;
    for (const v of now.values) {
      const p = valueProblem(r, v);
      if (p) {
        out.push(`${name}: ${p}`);
        continue;
      }
      if (v.code === 1002) depth += v.value === '{' ? 1 : -1;
      if (depth < 0) break;
    }
    if (depth !== 0) out.push(`${name}: braces (1002) that do not pair up`);
  }
  if (bytes > MAX_BYTES) out.push(`xdata of more than 16 KB (${bytes} bytes)`);
  return out;
}

const xyz = (v: Vec3): XYZ => new XYZ(v.x, v.y, v.z);

function record({ code, value }: XdataValue): ExtendedDataRecord {
  switch (code) {
    case 1000:
      return new ExtendedDataString(value as string);
    case 1002:
      return new ExtendedDataControlString(value === '}');
    case 1003:
      return new ExtendedDataLayer(Number(value));
    case 1004:
      return new ExtendedDataBinaryChunk(value as Uint8Array);
    case 1005:
      return new ExtendedDataHandle(Number.parseInt(value as string, 16));
    case 1010:
      return new ExtendedDataCoordinate(xyz(value as Vec3));
    case 1011:
      return new ExtendedDataWorldCoordinate(xyz(value as Vec3));
    case 1012:
      return new ExtendedDataDisplacement(xyz(value as Vec3));
    case 1013:
      return new ExtendedDataDirection(xyz(value as Vec3));
    case 1040:
      return new ExtendedDataReal(value as number);
    case 1041:
      return new ExtendedDataDistance(value as number);
    case 1042:
      return new ExtendedDataScale(value as number);
    case 1070:
      return new ExtendedDataInteger16(Number(value));
    default:
      return new ExtendedDataInteger32(Number(value));
  }
}

/**
 * Writes `after`'s xdata onto `o`, in the model's order; an application whose values match
 * `before` keeps the records it was read with. Callers check `xdataProblems` first.
 */
export function writeXdata(
  r: Resolver,
  o: CadObject,
  before: Xdata | undefined,
  after: Xdata | undefined,
): void {
  const kept = new Map<Handle, [AppId, ExtendedData]>();
  for (const [app, data] of o.extendedData) {
    kept.set(app.handle.toString(16).toUpperCase(), [app, data]);
  }
  const changed = changedApps(before, after);
  o.extendedData.clear();
  for (const a of after ?? []) {
    const old = kept.get(a.appId);
    if (old && !changed.has(a.appId)) o.extendedData.set(old[0], old[1]);
    else o.extendedData.set(resolve(r, a.appId, AppId)!, new ExtendedData(a.values.map(record)));
  }
}
