/**
 * `structuralDiff`: compares two acad-ts object graphs by handle (docs/TESTING.md §3).
 *
 * Every registered CadObject is matched by handle and compared field by field: its own
 * data fields (acad-ts keeps state in plain instance fields, including `_`-prefixed backing
 * fields behind getters), xdata, reactors, extension dictionary and owner. A field that points
 * at another CadObject is compared as a reference (type + handle), never deeply, so one changed
 * object yields differences on that object only. Header variables are compared by `$NAME`
 * with the TESTING.md §3 allowed exceptions.
 *
 * Deliberately not compared (not part of the object graph): DXF CLASSES instance counts, DWG
 * summary info, the preview image, and acad-ts' internal reference bookkeeping.
 */
import { ACadVersion, CadDocument, CadHeader, CadObject, DxfClass } from '@node-projects/acad-ts';

export type DifferenceKind = 'missing' | 'added' | 'type' | 'value' | 'order';

export interface Difference {
  /** Upper-case hex handle; `0` for the header. */
  handle: string;
  /** DXF type name of the object in the original document (`HEADER` for header variables). */
  objectName: string;
  /** Field path inside the object, e.g. `endPoint.y`, `_layer`, `$LTSCALE`. Empty for whole objects. */
  path: string;
  kind: DifferenceKind;
  /** Short rendering of the original and reopened values. */
  a?: string;
  b?: string;
}

export interface DiffReport {
  differences: Difference[];
  objectsA: number;
  objectsB: number;
  /** True when `maxDifferences` was reached and the rest were not recorded. */
  truncated: boolean;
}

export interface DiffOptions {
  /** Handles touched by an editing session; their objects are not compared (TESTING.md §3). */
  ignoreHandles?: ReadonlySet<number>;
  /** Stop recording after this many differences. Default 10 000. */
  maxDifferences?: number;
}

/** acad-ts internals that describe bookkeeping, not drawing data. */
const SKIP_FIELDS = new Set(['document', '_referenceHandler']);
const MAX_DEPTH = 24;

/**
 * Header variables that may differ after a save (TESTING.md §3). `$HANDSEED` (must not go
 * down) and `$DWGCODEPAGE` (only when the written version is Unicode) are checked separately.
 * Adding to this list requires a DECISIONS.md entry.
 */
const ALLOWED_HEADER_CHANGES = new Set([
  '$TDUPDATE',
  '$TDUUPDATE', // UTC twin of $TDUPDATE (DEC-034)
  '$TDUSRTIMER',
  '$TDINDWG',
  '$VERSIONGUID',
  '$FINGERPRINTGUID',
  '$LASTSAVEDBY', // who saved the file (DEC-041)
  '$ACADMAINTVER', // maintenance version of the program that saved it (DEC-041)
]);

class Collector {
  readonly differences: Difference[] = [];
  truncated = false;
  constructor(private readonly max: number) {}
  add(d: Difference): void {
    if (this.differences.length >= this.max) {
      this.truncated = true;
      return;
    }
    this.differences.push(d);
  }
  get full(): boolean {
    return this.truncated;
  }
}

export function structuralDiff(
  a: CadDocument,
  b: CadDocument,
  options: DiffOptions = {},
): DiffReport {
  const out = new Collector(options.maxDifferences ?? 10_000);
  const ignore = options.ignoreHandles ?? new Set<number>();
  const objsA = indexByHandle(a);
  const objsB = indexByHandle(b);

  if (a.header && b.header) compareHeader(a.header, b.header, out);

  for (const [handle, oa] of objsA) {
    if (out.full) break;
    if (ignore.has(handle)) continue;
    const ob = objsB.get(handle);
    const where = { handle: hex(handle), objectName: oa.objectName };
    if (!ob) {
      out.add({ ...where, path: '', kind: 'missing' });
      continue;
    }
    if (ob.objectName !== oa.objectName || ob.constructor !== oa.constructor) {
      out.add({ ...where, path: '', kind: 'type', a: describe(oa), b: describe(ob) });
      continue;
    }
    compareFields(oa, ob, '', 0, new WeakSet(), (d) => out.add({ ...where, ...d }));
  }
  for (const [handle, ob] of objsB) {
    if (out.full) break;
    if (!objsA.has(handle) && !ignore.has(handle)) {
      out.add({ handle: hex(handle), objectName: ob.objectName, path: '', kind: 'added' });
    }
  }
  return {
    differences: out.differences,
    objectsA: objsA.size,
    objectsB: objsB.size,
    truncated: out.truncated,
  };
}

export interface DiffSummary {
  total: number;
  truncated: boolean;
  /** Differences grouped by `OBJECTNAME path` (array indices folded to `[]`), largest first. */
  byPath: { key: string; count: number }[];
  byKind: Partial<Record<DifferenceKind, number>>;
}

export function summarizeDiff(report: DiffReport): DiffSummary {
  const byPath = new Map<string, number>();
  const byKind: Partial<Record<DifferenceKind, number>> = {};
  for (const d of report.differences) {
    const path = d.kind === 'value' || d.kind === 'order' ? d.path : `<${d.kind}>`;
    const key = `${d.objectName} ${path.replace(/\[[^\]]*\]/g, '[]')}`.trimEnd();
    byPath.set(key, (byPath.get(key) ?? 0) + 1);
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  }
  return {
    total: report.differences.length,
    truncated: report.truncated,
    byPath: [...byPath]
      .map(([key, count]) => ({ key, count }))
      .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key)),
    byKind,
  };
}

function indexByHandle(doc: CadDocument): Map<number, CadObject> {
  const map = new Map<number, CadObject>();
  for (const obj of doc.getCadObjects()) map.set(obj.handle, obj);
  return map;
}

let headerNames: Map<string, string> | null = null;

/** CadHeader property name → `$NAME`, from acad-ts' own system-variable metadata. */
function headerVariableNames(): Map<string, string> {
  if (headerNames) return headerNames;
  headerNames = new Map();
  for (const [name, variable] of CadHeader.getHeaderMap()) {
    const property = (variable as unknown as { _propertyName?: string })._propertyName;
    if (property && !headerNames.has(property)) headerNames.set(property, name);
  }
  return headerNames;
}

function compareHeader(ha: CadHeader, hb: CadHeader, out: Collector): void {
  const names = headerVariableNames();
  const unicode = hb.version >= ACadVersion.AC1021;
  for (const key of fieldKeys(ha, hb)) {
    const name = names.get(key) ?? key;
    if (ALLOWED_HEADER_CHANGES.has(name)) continue;
    if (name === '$DWGCODEPAGE' && unicode) continue;
    const va = (ha as unknown as Record<string, unknown>)[key];
    const vb = (hb as unknown as Record<string, unknown>)[key];
    if (name === '$HANDSEED' && typeof va === 'number' && typeof vb === 'number') {
      if (vb < va) out.add(headerDiff(name, hex(va), hex(vb)));
      continue;
    }
    compareValues(va, vb, name, 0, new WeakSet(), (d) =>
      out.add({ handle: '0', objectName: 'HEADER', ...d }),
    );
  }
}

const headerDiff = (path: string, a: string, b: string): Difference => ({
  handle: '0',
  objectName: 'HEADER',
  path,
  kind: 'value',
  a,
  b,
});

type Report = (d: Omit<Difference, 'handle' | 'objectName'>) => void;

function fieldKeys(a: object, b: object): string[] {
  const keys = new Set<string>();
  for (const obj of [a, b]) {
    for (const key of Object.keys(obj)) {
      if (SKIP_FIELDS.has(key)) continue;
      const value = (obj as Record<string, unknown>)[key];
      if (typeof value === 'function') continue;
      keys.add(key);
    }
  }
  return [...keys].sort();
}

function compareFields(
  a: object,
  b: object,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  report: Report,
): void {
  for (const key of fieldKeys(a, b)) {
    // Instance counts are not part of the object graph (see the file comment). Objects kept raw
    // carry their DxfClass, and the writer stores the real count where the file may be stale.
    if (key === 'instanceCount' && a instanceof DxfClass) continue;
    compareValues(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
      depth + 1,
      seen,
      report,
    );
  }
}

/** A field that names another registered object is a reference, compared by handle. */
function isReference(v: unknown): boolean {
  return v instanceof CadDocument || (v instanceof CadObject && v.handle !== 0);
}

function describe(v: unknown): string {
  if (v instanceof CadDocument) return 'DOCUMENT';
  if (v instanceof CadObject) return `${v.objectName}#${hex(v.handle)}`;
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return JSON.stringify(v).slice(0, 80);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v instanceof Map || v instanceof Set) return `${v.constructor.name}(${v.size})`;
  if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.byteLength})`;
  return (v as object).constructor?.name ?? typeof v;
}

/**
 * Lazily created containers: a null field and an empty container mean the same thing. So do
 * an empty and a missing string: DXF and DWG store both as an empty value, so readers fill
 * either one depending on code path.
 */
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (typeof v === 'object' && !(v instanceof CadObject)) {
    const size = (v as { size?: unknown }).size;
    return typeof size === 'number' && size === 0;
  }
  return false;
}

function numbersEqual(x: number, y: number): boolean {
  return x === y || (Number.isNaN(x) && Number.isNaN(y));
}

function keyOf(k: unknown): string {
  return isReference(k) ? describe(k) : String(k);
}

function asList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (v instanceof Set) return [...v];
  return null;
}

function compareValues(
  va: unknown,
  vb: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  report: Report,
): void {
  if (va === vb) return;
  if (isReference(va) || isReference(vb)) {
    if (describe(va) !== describe(vb)) {
      report({ path, kind: 'value', a: describe(va), b: describe(vb) });
    }
    return;
  }
  if (isEmpty(va) && isEmpty(vb)) return;
  if (
    typeof va !== typeof vb ||
    va === null ||
    vb === null ||
    va === undefined ||
    vb === undefined
  ) {
    report({ path, kind: 'value', a: describe(va), b: describe(vb) });
    return;
  }
  if (typeof va === 'number') {
    if (!numbersEqual(va, vb as number))
      report({ path, kind: 'value', a: describe(va), b: describe(vb) });
    return;
  }
  if (typeof va !== 'object') {
    if (va !== vb) report({ path, kind: 'value', a: describe(va), b: describe(vb) });
    return;
  }
  if (depth > MAX_DEPTH || seen.has(va)) return;
  seen.add(va);

  if (va instanceof Date || vb instanceof Date) {
    const ta = va instanceof Date ? va.getTime() : NaN;
    const tb = vb instanceof Date ? vb.getTime() : NaN;
    if (!numbersEqual(ta, tb)) report({ path, kind: 'value', a: describe(va), b: describe(vb) });
    return;
  }
  if (ArrayBuffer.isView(va) || ArrayBuffer.isView(vb)) {
    const ba = ArrayBuffer.isView(va)
      ? new Uint8Array(va.buffer, va.byteOffset, va.byteLength)
      : null;
    const bb = ArrayBuffer.isView(vb)
      ? new Uint8Array(vb.buffer, vb.byteOffset, vb.byteLength)
      : null;
    if (!ba || !bb || ba.length !== bb.length || ba.some((x, i) => x !== bb[i])) {
      report({ path, kind: 'value', a: describe(va), b: describe(vb) });
    }
    return;
  }

  const la = asList(va);
  const lb = asList(vb);
  if (la || lb) {
    if (!la || !lb) {
      report({ path, kind: 'value', a: describe(va), b: describe(vb) });
      return;
    }
    compareLists(la, lb, path, depth, seen, report);
    return;
  }

  if (va instanceof Map || vb instanceof Map) {
    if (!(va instanceof Map) || !(vb instanceof Map)) {
      report({ path, kind: 'value', a: describe(va), b: describe(vb) });
      return;
    }
    // Keyed collections (dictionary entries, table entries, xdata by app) are unordered.
    const ma = new Map([...va].map(([k, v]) => [keyOf(k), v] as const));
    const mb = new Map([...vb].map(([k, v]) => [keyOf(k), v] as const));
    for (const key of new Set([...ma.keys(), ...mb.keys()])) {
      const sub = `${path}[${key}]`;
      if (!ma.has(key)) report({ path: sub, kind: 'value', a: 'absent', b: describe(mb.get(key)) });
      else if (!mb.has(key))
        report({ path: sub, kind: 'value', a: describe(ma.get(key)), b: 'absent' });
      else compareValues(ma.get(key), mb.get(key), sub, depth + 1, seen, report);
    }
    return;
  }

  if (va.constructor !== (vb as object).constructor) {
    report({ path, kind: 'type', a: describe(va), b: describe(vb) });
    return;
  }
  compareFields(va, vb as object, path, depth, seen, report);
}

function compareLists(
  la: unknown[],
  lb: unknown[],
  path: string,
  depth: number,
  seen: WeakSet<object>,
  report: Report,
): void {
  // Lists of references (block entities, reactors, group members): compare handle sequences
  // and tell a pure reordering apart from a membership change.
  if (la.every(isReference) && lb.every(isReference)) {
    const ra = la.map(describe);
    const rb = lb.map(describe);
    if (ra.join() === rb.join()) return;
    const sameMembers = ra.length === rb.length && [...ra].sort().join() === [...rb].sort().join();
    report({
      path,
      kind: sameMembers ? 'order' : 'value',
      a: summarizeList(ra),
      b: summarizeList(rb),
    });
    return;
  }
  if (la.length !== lb.length) {
    report({ path: `${path}.length`, kind: 'value', a: String(la.length), b: String(lb.length) });
  }
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) compareValues(la[i], lb[i], `${path}[${i}]`, depth + 1, seen, report);
}

function summarizeList(items: string[]): string {
  return items.length <= 4 ? items.join(',') : `${items.slice(0, 4).join(',')},…(${items.length})`;
}

function hex(n: number): string {
  return n.toString(16).toUpperCase();
}
