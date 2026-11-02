/**
 * Handle-coverage gate (roadmap M1-27, docs/TESTING.md §3.2). `structuralDiff` compares the
 * acad-ts graph before and after a save, so an object acad-ts never loads is absent on both
 * sides and invisible to it. This lists the handles the file itself declares (DWG handle map,
 * DXF `5`/`105`) and checks that each one is in the reopened document.
 */
import {
  ACadVersion,
  CadDictionary,
  Field,
  DwgObjectReader,
  DwgReader,
  DwgSectionDefinition,
  DwgStreamReaderBase,
  Insert,
  ObjectType,
  PolyfaceMesh,
  Polyline,
  type CadDocument,
  type CadObject,
  type DxfClassCollection,
} from '@node-projects/acad-ts';
import { sniffCadFile } from '../corpus/sniff.ts';

export type HandleSource = 'dwg-handle-map' | 'dxf-ascii' | 'dxf-binary';

export interface DeclaredHandles {
  source: HandleSource;
  /** Handle → the record's type name (DXF `0` value, DWG object type or class DXF name). */
  handles: Map<number, string>;
}

export interface HandleLoss {
  /** Upper-case hex, as AutoCAD prints it. */
  handle: string;
  type: string;
  /** `read`: acad-ts never loaded it. `save`: it was loaded and the writer dropped it. */
  stage: 'read' | 'save';
}

export interface HandleCoverage {
  source: HandleSource;
  declared: number;
  lost: HandleLoss[];
}

/**
 * Every handle the file declares. DWG object types come from each record's header, so the
 * file's DXF classes are needed to name custom objects; without them they show as `class N`.
 */
export function declaredHandles(
  bytes: Uint8Array,
  classes?: DxfClassCollection | null,
): DeclaredHandles {
  const format = sniffCadFile(bytes).format;
  if (format === 'dwg') return { source: 'dwg-handle-map', handles: dwgHandles(bytes, classes) };
  if (format === 'dxf-ascii')
    return { source: 'dxf-ascii', handles: dxfHandles(asciiGroups(bytes)) };
  if (format === 'dxf-binary')
    return { source: 'dxf-binary', handles: dxfHandles(binaryGroups(bytes)) };
  throw new Error(`cannot list the handles of a ${format} stream`);
}

/**
 * Every object the document holds, by handle. acad-ts keeps polyline vertices, polyface-mesh
 * faces, attributes and their `SEQEND`, and child fields inside their owner (under their file
 * handles) rather than in the document's object map, so those are added from the owner. A held
 * child is not registered with the document, so neither is its extension dictionary; the
 * dictionary and its entries are reached only through the child.
 */
export function documentObjects(doc: CadDocument): Map<number, CadObject> {
  const out = new Map<number, CadObject>();
  const addTree = (o: CadObject): void => {
    if (out.has(o.handle)) return;
    out.set(o.handle, o);
    if (o.xDictionary) addTree(o.xDictionary);
    if (o instanceof CadDictionary) for (const e of o) addTree(e);
    addHeld(o);
  };
  const addHeld = (o: CadObject): void => {
    if (o instanceof Field) for (const f of o.children) addTree(f);
    const children = o instanceof Polyline ? o.vertices : o instanceof Insert ? o.attributes : null;
    if (!children) return;
    for (const c of children) addTree(c);
    if (children.seqend) addTree(children.seqend);
    if (o instanceof PolyfaceMesh) for (const f of o.faces) addTree(f);
  };
  const registered = [...doc.getCadObjects()];
  for (const o of registered) out.set(o.handle, o);
  for (const o of registered) addHeld(o);
  out.delete(0);
  return out;
}

/** Handles of every object the document holds (`documentObjects`). */
export function documentHandles(doc: CadDocument): Set<number> {
  return new Set(documentObjects(doc).keys());
}

/** Declared handles absent from `reopened`; `original` (the first read) says at which stage. */
export function handleCoverage(
  declared: ReadonlyMap<number, string>,
  original: ReadonlySet<number>,
  reopened: ReadonlySet<number>,
): Omit<HandleCoverage, 'source'> {
  const lost: HandleLoss[] = [];
  for (const [h, type] of [...declared].sort((a, b) => a[0] - b[0])) {
    if (reopened.has(h)) continue;
    lost.push({ handle: hex(h), type, stage: original.has(h) ? 'save' : 'read' });
  }
  return { declared: declared.size, lost };
}

// ---------------------------------------------------------------------------------------------
// The ratchet against corpus/handle-coverage-baseline.json

export type HandleRun =
  | { path: string; coverage: HandleCoverage; unscanned?: undefined }
  | { path: string; unscanned: string; coverage?: undefined };

export type HandleBaselineEntry =
  { declared: number; lost: Record<string, string> } | { unscanned: string };

export interface HandleBaseline {
  note: string;
  files: Record<string, HandleBaselineEntry>;
}

export function toHandleBaseline(runs: HandleRun[]): HandleBaseline {
  const files: Record<string, HandleBaselineEntry> = {};
  for (const run of [...runs].sort((a, b) => a.path.localeCompare(b.path))) {
    if (run.unscanned !== undefined) {
      files[run.path] = { unscanned: run.unscanned };
      continue;
    }
    const lost: Record<string, string[]> = {};
    for (const l of run.coverage.lost) (lost[l.type] ??= []).push(l.handle);
    files[run.path] = {
      declared: run.coverage.declared,
      lost: Object.fromEntries(
        Object.keys(lost)
          .sort()
          .map((t) => [t, lost[t]!.join(' ')]),
      ),
    };
  }
  return {
    note: 'Handle-coverage ratchet (docs/TESTING.md §3.2, M1-27): declared handles each corpus file loses on a save, by type. pnpm test fails on any handle not listed here; after a fix, TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip removes it. Expected end state (M1-31): every lost list empty.',
    files,
  };
}

export interface HandleComparison {
  /** `path: HANDLE TYPE` for each newly lost handle, or why a file stopped being scanned. */
  regressions: string[];
  improvements: string[];
  added: string[];
}

export function compareToHandleBaseline(
  runs: HandleRun[],
  baseline: HandleBaseline,
): HandleComparison {
  const out: HandleComparison = { regressions: [], improvements: [], added: [] };
  for (const run of runs) {
    const before = baseline.files[run.path];
    if (!before) {
      out.added.push(run.path);
      continue;
    }
    if (run.unscanned !== undefined) {
      if (!('unscanned' in before))
        out.regressions.push(`${run.path}: no longer scanned (${run.unscanned})`);
      continue;
    }
    if ('unscanned' in before) {
      out.improvements.push(`${run.path}: now scanned`);
      // Nothing to compare against: every loss is new.
      for (const l of run.coverage.lost) out.regressions.push(`${run.path}: ${l.handle} ${l.type}`);
      continue;
    }
    const known = new Set(Object.values(before.lost).flatMap((s) => s.split(' ')));
    const now = new Set<string>();
    for (const l of run.coverage.lost) {
      now.add(l.handle);
      if (!known.has(l.handle)) out.regressions.push(`${run.path}: ${l.handle} ${l.type}`);
    }
    for (const [type, list] of Object.entries(before.lost))
      for (const h of list.split(' '))
        if (!now.has(h)) out.improvements.push(`${run.path}: ${h} ${type}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scanners. They read the file independently of the acad-ts object graph, so they also see
// objects acad-ts never builds.

type Group = readonly [code: number, value: string];

function dxfHandles(groups: Iterable<Group>): Map<number, string> {
  const out = new Map<number, string>();
  let type = '';
  let skip = false; // HEADER ($HANDSEED is a 5) and CLASSES carry no object handles
  let subclassed = false; // a 100 marker has been seen in the current record
  for (const [code, value] of groups) {
    if (code === 0) {
      type = value.trim();
      subclassed = false;
      continue;
    }
    if (code === 100) subclassed = true;
    if (code === 2 && type === 'SECTION') skip = value === 'HEADER' || value === 'CLASSES';
    if (skip || type === 'SECTION') continue;
    // SORTENTSTABLE pairs each 331 entity with a 5 sort handle after AcDbSortentsTable (DXF
    // reference, SORTENTSTABLE). A sort handle is a draw-order key, not an object.
    if (code === 5 && type === 'SORTENTSTABLE' && subclassed) continue;
    // DIMSTYLE records keep their handle in 105 because 5 is DIMBLK there (DXF reference,
    // DIMSTYLE group codes).
    if (!(code === 105 || (code === 5 && type !== 'DIMSTYLE'))) continue;
    const text = value.trim();
    if (!/^[0-9A-Fa-f]{1,16}$/.test(text)) continue;
    const h = Number.parseInt(text, 16);
    if (h !== 0 && !out.has(h)) out.set(h, type);
  }
  return out;
}

function* asciiGroups(bytes: Uint8Array): Generator<Group> {
  const lines = new TextDecoder('latin1').decode(bytes).split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    yield [Number.parseInt(lines[i]!.trim(), 10), lines[i + 1]!];
  }
}

const BINARY_SENTINEL_LENGTH = 22; // "AutoCAD Binary DXF\r\n\x1a\0"

/**
 * Binary DXF group stream (DXF reference, "Binary DXF Files"): R12 writes one-byte group codes
 * (255 escapes a two-byte code), R13 and later two-byte codes. The value size follows from the
 * code's range. Only strings are decoded; numbers are skipped.
 */
function* binaryGroups(bytes: Uint8Array): Generator<Group> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The first group is always 0/SECTION: a two-byte code is `00 00`, a one-byte code `00 'S'`.
  const wideCodes = bytes[BINARY_SENTINEL_LENGTH + 1] === 0;
  let pos = BINARY_SENTINEL_LENGTH;
  const latin1 = new TextDecoder('latin1');
  const string = (): string => {
    const end = bytes.indexOf(0, pos);
    if (end < 0) throw new Error(`unterminated string at byte ${pos}`);
    const s = latin1.decode(bytes.subarray(pos, end));
    pos = end + 1;
    return s;
  };
  while (pos < bytes.length) {
    let code: number;
    if (wideCodes) {
      code = view.getInt16(pos, true);
      pos += 2;
    } else {
      code = bytes[pos++]!;
      if (code === 0xff) {
        code = view.getInt16(pos, true);
        pos += 2;
      }
    }
    const size = binaryValueSize(code);
    if (size === 'string') {
      const value = string();
      yield [code, value];
      if (code === 0 && value === 'EOF') return;
    } else if (size === 'chunk') {
      pos += 1 + bytes[pos]!;
    } else if (size === undefined) {
      throw new Error(`binary DXF: group code ${code} has no known value type (byte ${pos})`);
    } else {
      pos += size;
    }
  }
  throw new Error('binary DXF: no EOF group');
}

function binaryValueSize(code: number): number | 'string' | 'chunk' | undefined {
  const within = (lo: number, hi: number): boolean => code >= lo && code <= hi;
  if (
    within(0, 9) ||
    within(100, 105) ||
    within(300, 309) ||
    within(320, 369) ||
    within(390, 399) ||
    within(410, 419) ||
    within(430, 439) ||
    within(470, 481) ||
    code === 999 ||
    within(1000, 1003) ||
    within(1005, 1009)
  )
    return 'string';
  if (within(310, 319) || code === 1004) return 'chunk';
  if (
    within(10, 59) ||
    within(110, 149) ||
    within(210, 239) ||
    within(460, 469) ||
    within(1010, 1059)
  )
    return 8;
  if (
    within(60, 79) ||
    within(170, 179) ||
    within(270, 289) ||
    within(370, 389) ||
    within(400, 409) ||
    within(1060, 1070)
  )
    return 2;
  if (within(90, 99) || within(420, 429) || within(440, 459) || code === 1071) return 4;
  if (within(160, 169)) return 8;
  if (within(290, 299)) return 1;
  return undefined;
}

/**
 * The DWG handle map, typed from each object record's header (size, R2010+ handle-stream size,
 * object type). acad-ts reads objects by following references from the header, so the map is
 * the only list of everything the file holds. The reader internals are reached by name because
 * acad-ts exposes no public API for either.
 */
function dwgHandles(bytes: Uint8Array, classes?: DxfClassCollection | null): Map<number, string> {
  const reader = new DwgReader(bytes.slice().buffer) as unknown as DwgReaderInternals;
  const map = reader._readHandles();
  const version = reader._fileHeader.acadVersion;
  const stream =
    version <= ACadVersion.AC1015
      ? DwgStreamReaderBase.getStreamHandler(version, reader._fileBytes, reader._encoding)
      : reader._getSectionStream(DwgSectionDefinition.acDbObjects);
  if (!stream) throw new Error('DWG: no AcDb:AcDbObjects section');
  const objects = new DwgObjectReader(
    version,
    {} as never, // the builder is only used when reading an object's body
    stream,
    [],
    map,
    classes ?? ([] as unknown as DxfClassCollection),
  ) as unknown as DwgObjectReaderInternals;
  const out = new Map<number, string>();
  for (const [h, offset] of map) {
    const type = objects._getEntityType(offset);
    out.set(h, objects._classes.get(type)?.dxfName ?? ObjectType[type] ?? `class ${String(type)}`);
  }
  return out;
}

interface DwgReaderInternals {
  _readHandles(): Map<number, number>;
  _fileHeader: { acadVersion: ACadVersion };
  _fileBytes: Uint8Array;
  _encoding: string | undefined;
  _getSectionStream(name: string): ReturnType<typeof DwgStreamReaderBase.getStreamHandler> | null;
}

interface DwgObjectReaderInternals {
  _getEntityType(offset: number): number;
  _classes: Map<number, { dxfName: string }>;
}

function hex(h: number): string {
  return h.toString(16).toUpperCase();
}
