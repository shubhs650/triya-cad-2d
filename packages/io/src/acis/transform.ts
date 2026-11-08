// Moving, turning and scaling an ACIS body (M1-75 part 39), for a REGION edited by MOVE, ROTATE
// or SCALE. ACIS states where a body sits by its transform record (`body` → `transform`: a
// 3 × 3 matrix applied to row vectors, a translation, a scale factor and the rotate, reflect
// and shear flags; Spatial "SAT Save File Format"), which region.ts applies on read. The motion
// is composed into that record, edited in place, so the faces, loops, edges and curves (with
// their parameter ranges, which baking a scale into them would change) stay byte for byte as
// read. Every REGION of the corpus, from R14 to R2018, has a transform record; a body without
// one is refused rather than given a new record.

import { isPointer, latin1, readSab, readSat, type AcisModel } from './records';

type V3 = readonly [number, number, number];

/**
 * A similarity in plan view: p′ = scale · R(rotation) · p + offset. The plane at Z `from` moves
 * to Z `to`, and other heights scale about it, as a uniform 3D scale about a point on it does.
 * Mirroring is not one: a reflected body would need its faces' senses checked (see export/region.ts).
 */
export interface PlanMotion {
  /** Counter-clockwise about +Z, radians. */
  readonly rotation: number;
  /** Uniform, positive. */
  readonly scale: number;
  readonly offset: { readonly x: number; readonly y: number };
  readonly from: number;
  readonly to: number;
}

const SAB_SIGNATURES = ['ACIS BinaryFile', 'ASM BinaryFile4'];
const isSab = (data: Uint8Array): boolean => SAB_SIGNATURES.includes(latin1(data.subarray(0, 15)));

/** The motion as an ACIS transform: rows of the turn, translation, scale. */
function asTransform(m: PlanMotion): { rows: number[]; t: V3; s: number } {
  const c = Math.cos(m.rotation);
  const s = Math.sin(m.rotation);
  // Row vectors: (x, y, z) · rows = (x c − y s, x s + y c, z).
  return {
    rows: [c, s, 0, -s, c, 0, 0, 0, 1],
    t: [m.offset.x, m.offset.y, m.to - m.scale * m.from],
    s: m.scale,
  };
}

/** `p` under `m`, as moveBody moves the body it lies on. */
export function movePoint(
  m: PlanMotion,
  p: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  const c = Math.cos(m.rotation);
  const s = Math.sin(m.rotation);
  return {
    x: m.scale * (p.x * c - p.y * s) + m.offset.x,
    y: m.scale * (p.x * s + p.y * c) + m.offset.y,
    z: m.scale * (p.z - m.from) + m.to,
  };
}

const multiply = (a: readonly number[], b: readonly number[]): number[] =>
  [0, 1, 2].flatMap((i) =>
    [0, 1, 2].map((j) => a[3 * i]! * b[j]! + a[3 * i + 1]! * b[3 + j]! + a[3 * i + 2]! * b[6 + j]!),
  );
const rowTimes = (v: V3, m: readonly number[]): V3 => [
  v[0] * m[0]! + v[1] * m[3]! + v[2] * m[6]!,
  v[0] * m[1]! + v[1] * m[4]! + v[2] * m[7]!,
  v[0] * m[2]! + v[1] * m[5]! + v[2] * m[8]!,
];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Where the body's transform record is, or why there is none to edit. */
function transformRecord(model: AcisModel): number | string {
  const bodies = model.records.filter((r) => r.type === 'body');
  if (bodies.length !== 1) return `ACIS data with ${bodies.length} bodies`;
  // body: lump, wire, transform (region.ts reads it the same way).
  const t = bodies[0]!.fields.filter(isPointer)[2]?.ptr;
  if (t === undefined || t < 0) return 'an ACIS body without a transform record';
  if (model.records[t]?.type !== 'transform') return 'an ACIS body transform that is not one';
  return t;
}

/**
 * The ACIS data `data` (SAT text or SAB binary, as acad-ts keeps a REGION's) with its body moved
 * by `motion`, or why it cannot be.
 */
export function moveBody(data: Uint8Array, motion: PlanMotion): Uint8Array | string {
  const binary = isSab(data);
  let model: AcisModel;
  try {
    model = binary ? readSab(data) : readSat(latin1(data));
  } catch {
    return 'ACIS data Triya cannot read';
  }
  const index = transformRecord(model);
  if (typeof index === 'string') return index;
  const fields = model.records[index]!.fields;
  const at = model.offsets[index]!;
  const numbers = fields.flatMap((v): number[] =>
    typeof v === 'number' ? [v] : Array.isArray(v) ? [...(v as V3)] : [],
  );
  if (numbers.length < 13) return 'an ACIS transform laid out unlike AutoCAD’s';
  const m0 = numbers.slice(0, 9);
  const t0: V3 = [numbers[9]!, numbers[10]!, numbers[11]!];
  const s0 = numbers[12]!;
  const w = asTransform(motion);
  // ((p · m0) · s0 + t0) · rows · s + t = p · (m0 · rows) · s0 · s + ((t0 · rows) · s + t).
  const m = multiply(m0, w.rows);
  const moved = rowTimes(t0, w.rows);
  const t: V3 = [moved[0] * w.s + w.t[0], moved[1] * w.s + w.t[1], moved[2] * w.s + w.t[2]];
  const s = s0 * w.s;
  const rotates = m.some((v, i) => v !== IDENTITY[i]);
  return binary
    ? writeSab(data, fields, at, m, t, s, rotates)
    : writeSat(data, fields, at, [...m, ...t, s], rotates);
}

/** SAB: four vectors (tag 20), the scale (tag 6), three logicals (tags 10 true, 11 false). */
function writeSab(
  data: Uint8Array,
  fields: AcisModel['records'][number]['fields'],
  at: readonly number[],
  m: readonly number[],
  t: V3,
  s: number,
  rotates: boolean,
): Uint8Array | string {
  const tags = at.map((o) => data[o]);
  if (fields.length < 8 || tags.slice(0, 4).some((g) => g !== 20) || tags[4] !== 6) {
    return 'an ACIS transform laid out unlike AutoCAD’s';
  }
  if (tags[5] !== 10 && tags[5] !== 11) return 'an ACIS transform laid out unlike AutoCAD’s';
  const out = data.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const values = [...m, ...t];
  for (let i = 0; i < 12; i++)
    view.setFloat64(at[Math.floor(i / 3)]! + 1 + 8 * (i % 3), values[i]!, true);
  view.setFloat64(at[4]! + 1, s, true);
  out[at[5]!] = rotates ? 10 : 11;
  return out;
}

/** Shortest text that reads back as the same double. */
const number = (n: number): string => (Object.is(n, -0) ? '0' : String(n));

/**
 * SAT: 13 numbers, then the three flags as keywords (`rotate` / `no_rotate`, …) or, in save
 * version 106, as 1 / 0. The record is rewritten from its first number to its last flag.
 */
function writeSat(
  data: Uint8Array,
  fields: AcisModel['records'][number]['fields'],
  at: readonly number[],
  values: readonly number[],
  rotates: boolean,
): Uint8Array | string {
  if (fields.length < 16 || fields.slice(0, 13).some((v) => typeof v !== 'number')) {
    return 'an ACIS transform laid out unlike AutoCAD’s';
  }
  const flag = fields[13];
  const rotate =
    typeof flag === 'number' ? (rotates ? '1' : '0') : rotates ? 'rotate' : 'no_rotate';
  const start = at[0]!;
  let end = at[15]!;
  while (end < data.length && ![0x20, 0x0a, 0x0d, 0x09].includes(data[end]!)) end++;
  const tail = latin1(data.subarray(at[14]!, end));
  const text = [...values.map(number), rotate, tail].join(' ');
  const out = new Uint8Array(start + text.length + data.length - end);
  out.set(data.subarray(0, start));
  for (let i = 0; i < text.length; i++) out[start + i] = text.charCodeAt(i);
  out.set(data.subarray(end), start + text.length);
  return out;
}
