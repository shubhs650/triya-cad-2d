// ACIS model data as records, from either encoding AutoCAD writes for REGION, 3DSOLID and BODY:
// SAT text (R2000–R2010, DXF groups 1/3; R2000–R2004 DXF also apply a character cipher, undone
// by acad-ts) and SAB binary (R2013+ DXF ACDSDATA, and DWG). Only the record structure is read
// here; `region.ts` interprets the records a planar region uses.
//
// Formats re-authored from the published SAT/SAB descriptions (Spatial "SAT Save File Format"
// and the ODA DWG specification §ACIS); no ACIS code is used.

export interface AcisPointer {
  readonly ptr: number;
}

/** A record field. SAB booleans stay booleans; SAT keywords (forward, reversed, I) stay text. */
export type AcisValue = number | string | boolean | AcisPointer | readonly [number, number, number];

export interface AcisRecord {
  /** Full type name, e.g. `plane-surface`, `straight-curve`, `coedge`. */
  readonly type: string;
  /** Fields after the common entity header (see `stripHeader`). */
  readonly fields: readonly AcisValue[];
}

export interface AcisModel {
  readonly version: number;
  /** Indexed by the pointers in the records. */
  readonly records: readonly AcisRecord[];
  /**
   * Where each record's fields start in the data read, per record and field: the character
   * offset of the token in SAT text, the byte offset of the tag in SAB. A writer edits a record
   * in place through them (acis/transform.ts).
   */
  readonly offsets: readonly (readonly number[])[];
}

export const isPointer = (v: AcisValue | undefined): v is AcisPointer =>
  typeof v === 'object' && v !== null && 'ptr' in v;

/**
 * From ACIS 7.0 (save version 700) an entity header has a history id after its attribute
 * pointer. Topology and geometry records (body … vertex, point, curves, surfaces) then have one
 * more pointer, which `transform` and `asmheader` do not; every SAT and SAB file of the corpus
 * (versions 20800 to 22300) shows this. The 400 files have the attribute pointer only.
 */
const NO_THIRD = new Set(['transform', 'asmheader']);
const headerLength = (type: string, version: number): number =>
  version < 700 ? 1 : NO_THIRD.has(type) ? 2 : 3;
function stripHeader(type: string, values: AcisValue[], version: number): AcisRecord {
  return { type, fields: values.slice(headerLength(type, version)) };
}

/** SAT text: one to three header lines, then records ending in `#`. */
export function readSat(text: string): AcisModel {
  const lines = text.split(/\r?\n/);
  const version = Number(lines[0]?.trim().split(/\s+/)[0]);
  if (!Number.isFinite(version)) throw new Error('SAT: no version');
  // The version line, then (from save version 200 or so; R14's 106 has neither) a product
  // line and a units line. A record line starts with its type and the attribute pointer.
  let k = 1;
  while (k < 3 && k < lines.length && !/^\s*(-\d+\s+)?[a-z][\w-]*\s+\$/.test(lines[k]!)) k++;
  // Offsets are into `text` itself, so the body starts where its first line does.
  let i = 0;
  for (let line = 0; line < k; line++) {
    i += lines[line]!.length;
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
  }
  const records: AcisRecord[] = [];
  const offsets: number[][] = [];
  let current: string[] = [];
  let at: number[] = [];
  const tokens: string[] = [];
  const starts: number[] = [];
  // Tokens are space separated, except @n strings, which are n characters after the space.
  while (i < text.length) {
    const c = text[i]!;
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i++;
      continue;
    }
    if (c === '@') {
      const m = /^@(\d+) /.exec(text.slice(i, i + 12));
      if (m) {
        const start = i + m[0].length;
        tokens.push(`@${text.slice(start, start + Number(m[1]))}`);
        starts.push(i);
        i = start + Number(m[1]);
        continue;
      }
    }
    let j = i;
    while (j < text.length && !' \n\r\t'.includes(text[j]!)) j++;
    tokens.push(text.slice(i, j));
    starts.push(i);
    i = j;
  }
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (token === '#') {
      if (current.length > 0) {
        const r = satRecord(current, version);
        records.push(r.record);
        offsets.push(at.slice(r.skip));
      }
      current = [];
      at = [];
    } else if (token === 'End-of-ACIS-data' || token === 'End-of-ASM-data') {
      break;
    } else {
      current.push(token);
      at.push(starts[t]!);
    }
  }
  return { version, records, offsets };
}

/** A record and how many of its tokens come before its fields (sequence number, type, header). */
function satRecord(tokens: string[], version: number): { record: AcisRecord; skip: number } {
  // Files saved with sequence numbers start each record with "-n".
  const start = /^-\d+$/.test(tokens[0]!) ? 1 : 0;
  const type = tokens[start]!;
  const values = tokens.slice(start + 1).map((t): AcisValue => {
    if (t.startsWith('$')) return { ptr: Number(t.slice(1)) };
    if (t.startsWith('@')) return t.slice(1);
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : t;
  });
  return {
    record: stripHeader(type, values, version),
    skip: start + 1 + headerLength(type, version),
  };
}

/** Latin-1, one byte per character (io has no TextDecoder: it runs without DOM or Node types). */
export const latin1 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 4096)
    s += String.fromCharCode(...b.subarray(i, Math.min(i + 4096, b.length)));
  return s;
};

/**
 * SAB binary: a 15-byte signature ("ACIS BinaryFile" or "ASM BinaryFile4"), four int32 header
 * values (version first), then tagged values. A record's type is one or more tag-13/14 names
 * (`plane` + `surface` is `plane-surface`) and it ends at tag 17.
 */
export function readSab(bytes: Uint8Array): AcisModel {
  const sig = latin1(bytes.subarray(0, 15));
  if (sig !== 'ACIS BinaryFile' && sig !== 'ASM BinaryFile4') throw new Error('SAB: no signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getInt32(15, true);
  let p = 31;
  const str = (n: number) => {
    const s = latin1(bytes.subarray(p, p + n));
    p += n;
    return s;
  };
  const records: AcisRecord[] = [];
  const offsets: number[][] = [];
  let names: string[] = [];
  let values: AcisValue[] = [];
  let at: number[] = [];
  let header = true; // product, ACIS version, date and three doubles before the first record
  while (p < bytes.length) {
    const tagAt = p;
    const tag = bytes[p++]!;
    const count = values.length;
    switch (tag) {
      case 2: // char
        values.push(bytes[p++]!);
        break;
      case 3: // short
        values.push(view.getInt16(p, true));
        p += 2;
        break;
      case 4: // int32
      case 21: // enum
        values.push(view.getInt32(p, true));
        p += 4;
        break;
      case 5: // float
        values.push(view.getFloat32(p, true));
        p += 4;
        break;
      case 6:
        values.push(view.getFloat64(p, true));
        p += 8;
        break;
      case 7:
        values.push(str(bytes[p++]!));
        break;
      case 8: {
        const n = view.getUint16(p, true);
        p += 2;
        values.push(str(n));
        break;
      }
      case 9:
      case 18: {
        const n = view.getInt32(p, true);
        p += 4;
        values.push(str(n));
        break;
      }
      case 10:
        values.push(true);
        break;
      case 11:
        values.push(false);
        break;
      case 12:
        values.push({ ptr: view.getInt32(p, true) });
        p += 4;
        break;
      case 13: // the last part of a record type
      case 14: {
        // a leading part, joined with '-'
        if (header) {
          header = false;
          values = [];
          at = [];
        }
        names.push(str(bytes[p++]!));
        break;
      }
      case 15: // sub-type start and end: braces in SAT, kept as text
        values.push('{');
        break;
      case 16:
        values.push('}');
        break;
      case 17:
        if (names.length > 0) {
          const type = names.join('-');
          records.push(stripHeader(type, values, version));
          offsets.push(at.slice(headerLength(type, version)));
        }
        names = [];
        values = [];
        at = [];
        break;
      case 19: // position
      case 20: // vector
        values.push([
          view.getFloat64(p, true),
          view.getFloat64(p + 8, true),
          view.getFloat64(p + 16, true),
        ]);
        p += 24;
        break;
      default:
        throw new Error(`SAB: unknown tag ${tag} at ${p - 1}`);
    }
    if (values.length > count) at.push(tagAt);
  }
  return { version, records, offsets };
}
