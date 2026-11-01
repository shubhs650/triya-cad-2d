// M1-03 acceptance: the tables and header vars AcadToTriya produces for every public-corpus
// ASCII DXF equal what the file itself states, read by an independent group-code reader
// (dxf-oracle.ts). DWG and binary DXF files are checked for completeness (every acad-ts table
// entry is mapped, every reference resolves) because there is no text to compare against.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HeaderValue, TableName, TableRecords, Vec2, Vec3 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapHeader, mapTables, readCadDocument, type MappedTables } from '@triya/io';
import { loadManifest } from '../corpus/manifest.ts';
import {
  all,
  first,
  readDxfOracle,
  recordHandle,
  type DxfRecord,
  type Group,
} from './dxf-oracle.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

const TABLE_OF: Record<string, TableName> = {
  LAYER: 'layers',
  LTYPE: 'linetypes',
  STYLE: 'textStyles',
  DIMSTYLE: 'dimStyles',
  APPID: 'appIds',
  VIEW: 'views',
  UCS: 'ucs',
  VPORT: 'vports',
  BLOCK_RECORD: 'blockRecords',
};

type Getter<R> = (r: R, t: MappedTables) => unknown;
type Kind = 'num' | 'deg' | 'int' | 'str' | 'name' | 'bool' | 'handle';
type Checks<R> = Record<number, [Kind, Getter<R>]>;

const xyz = (
  base: number,
  get: (r: never) => Vec2 | Vec3,
): Record<number, [Kind, Getter<never>]> => ({
  [base]: ['num', (r) => get(r).x],
  [base + 10]: ['num', (r) => get(r).y],
  [base + 20]: ['num', (r) => ('z' in get(r) ? (get(r) as Vec3).z : 0)],
});

const nameOf = (t: MappedTables, table: TableName, h: string | undefined): string | undefined =>
  t[table].find((x) => x.handle === h)?.name;

const LAYER: Checks<TableRecords['layers']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
  62: ['int', (r) => aciSigned(r)],
  6: ['name', (r, t) => nameOf(t, 'linetypes', r.linetype)],
  370: ['int', (r) => (typeof r.lineweight === 'number' ? r.lineweight : LW[r.lineweight])],
  290: ['bool', (r) => r.plot],
  390: ['handle', (r) => r.plotStyle],
  347: ['handle', (r) => r.material],
};
const LW = { ByLayer: -1, ByBlock: -2, Default: -3 } as const;
/** DXF 62 of a layer: the colour index, negative when the layer is off. */
function aciSigned(r: TableRecords['layers']): number | string {
  if (r.color.kind !== 'aci') return 'not aci';
  return r.on ? r.color.index : -r.color.index;
}

const LTYPE: Checks<TableRecords['linetypes']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
  3: ['str', (r) => r.description],
  72: ['int', (r) => r.alignment.charCodeAt(0)],
  73: ['int', (r) => r.elements.length],
  40: ['num', (r) => r.patternLength],
};

const STYLE: Checks<TableRecords['textStyles']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
  40: ['num', (r) => r.height],
  41: ['num', (r) => r.widthFactor],
  50: ['deg', (r) => r.obliqueAngle],
  71: ['int', (r) => r.generation],
  42: ['num', (r) => r.lastHeight],
  3: ['str', (r) => r.font],
  4: ['str', (r) => r.bigFont ?? ''],
};

const BLOCK_RECORD: Checks<TableRecords['blockRecords']> = {
  2: ['str', (r) => r.name],
  340: ['handle', (r) => r.layout],
  70: ['int', (r) => r.units],
  280: ['bool', (r) => r.explodable],
  281: ['bool', (r) => r.scalable],
};

const APPID: Checks<TableRecords['appIds']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
};

const UCS: Checks<TableRecords['ucs']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
  ...xyz(10, (r: TableRecords['ucs']) => r.origin),
  ...xyz(11, (r: TableRecords['ucs']) => r.xAxis),
  ...xyz(12, (r: TableRecords['ucs']) => r.yAxis),
  79: ['int', (r) => r.orthographic],
  146: ['num', (r) => r.elevation],
};

const VIEW: Checks<TableRecords['views']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
  40: ['num', (r) => r.height],
  10: ['num', (r) => r.center.x],
  20: ['num', (r) => r.center.y],
  41: ['num', (r) => r.width],
  ...xyz(11, (r: TableRecords['views']) => r.direction),
  ...xyz(12, (r: TableRecords['views']) => r.target),
  42: ['num', (r) => r.lensLength],
  43: ['num', (r) => r.frontClip],
  44: ['num', (r) => r.backClip],
  50: ['deg', (r) => r.twist],
  71: ['int', (r) => r.viewMode],
  281: ['int', (r) => r.renderMode],
  72: ['bool', (r) => r.ucs !== undefined],
  ...xyz(110, (r: TableRecords['views']) => r.ucs?.origin ?? ZERO),
  ...xyz(111, (r: TableRecords['views']) => r.ucs?.xAxis ?? ZERO),
  ...xyz(112, (r: TableRecords['views']) => r.ucs?.yAxis ?? ZERO),
  79: ['int', (r) => r.ucs?.orthographic ?? 0],
  146: ['num', (r) => r.ucs?.elevation ?? 0],
};
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

const VPORT: Checks<TableRecords['vports']> = {
  2: ['str', (r) => r.name],
  70: ['int', (r) => r.flags ?? 0],
  10: ['num', (r) => r.lowerLeft.x],
  20: ['num', (r) => r.lowerLeft.y],
  11: ['num', (r) => r.upperRight.x],
  21: ['num', (r) => r.upperRight.y],
  12: ['num', (r) => r.center.x],
  22: ['num', (r) => r.center.y],
  13: ['num', (r) => r.snapBase.x],
  23: ['num', (r) => r.snapBase.y],
  14: ['num', (r) => r.snapSpacing.x],
  24: ['num', (r) => r.snapSpacing.y],
  15: ['num', (r) => r.gridSpacing.x],
  25: ['num', (r) => r.gridSpacing.y],
  ...xyz(16, (r: TableRecords['vports']) => r.direction),
  ...xyz(17, (r: TableRecords['vports']) => r.target),
  40: ['num', (r) => r.height],
  41: ['num', (r) => r.aspectRatio],
  42: ['num', (r) => r.lensLength],
  43: ['num', (r) => r.frontClip],
  44: ['num', (r) => r.backClip],
  50: ['deg', (r) => r.snapRotation],
  51: ['deg', (r) => r.twist],
  71: ['int', (r) => r.viewMode],
  72: ['int', (r) => r.circleZoom],
  74: ['int', (r) => r.ucsIcon],
  75: ['bool', (r) => r.snapOn],
  76: ['bool', (r) => r.gridOn],
  77: ['bool', (r) => r.isometricSnap],
  78: ['int', (r) => r.isometricPlane],
  281: ['int', (r) => r.renderMode],
  ...xyz(110, (r: TableRecords['vports']) => r.ucs.origin),
  ...xyz(111, (r: TableRecords['vports']) => r.ucs.xAxis),
  ...xyz(112, (r: TableRecords['vports']) => r.ucs.yAxis),
  79: ['int', (r) => r.ucs.orthographic],
  146: ['num', (r) => r.ucs.elevation],
  60: ['int', (r) => r.gridFlags],
  61: ['int', (r) => r.gridMajor],
};

const CHECKS: Record<string, Checks<never>> = {
  LAYER,
  LTYPE,
  STYLE,
  BLOCK_RECORD,
  APPID,
  UCS,
  VIEW,
  VPORT,
} as unknown as Record<string, Checks<never>>;

function same(kind: Kind, dxf: string, triya: unknown): boolean {
  switch (kind) {
    case 'num':
    case 'deg': {
      const want = Number.parseFloat(dxf) * (kind === 'deg' ? Math.PI / 180 : 1);
      return (
        typeof triya === 'number' && Math.abs(triya - want) <= 1e-9 * Math.max(1, Math.abs(want))
      );
    }
    case 'int':
      return triya === Number.parseInt(dxf, 10);
    case 'bool':
      return triya === (Number.parseInt(dxf, 10) !== 0);
    case 'str':
      return triya === dxf;
    case 'name':
      // A reference by name; AutoCAD symbol names are case-insensitive.
      return typeof triya === 'string' && triya.toUpperCase() === dxf.toUpperCase();
    case 'handle': {
      const h = dxf
        .trim()
        .replace(/^0+(?=.)/, '')
        .toUpperCase();
      return h === '0' ? triya === undefined : triya === h;
    }
  }
}

/**
 * Where acad-ts itself does not keep what the file states, so no mapping can: each kind is a
 * read defect or gap in acad-ts, tracked by roadmap task M1-32. The test fails when a kind
 * appears that is not listed (a new loss) and when a listed kind no longer appears (fixed:
 * remove it here).
 */
const ACAD_TS_GAPS: Record<string, string> = {
  'LAYER 347': 'CadLayerTemplate looks up the layer material but never assigns it',
  'BLOCK_RECORD 70':
    'the common table-entry reader takes BLOCK_RECORD 70 (insert units) as standard flags',
  'STYLE 2': 'nameless shape-file STYLE records are renamed unnamedN by the table collection',
  ...Object.fromEntries(
    [
      '$ATTDIA',
      '$ATTREQ',
      '$CMATERIAL',
      '$COORDS',
      '$DELOBJ',
      '$DRAGMODE',
      '$HANDLING',
      '$HIDETEXT',
      '$INTERFEREOBJVS',
      '$INTERFEREVPVS',
      '$INTERSECTIONCOLOR',
      '$INTERSECTIONDISPLAY',
      '$LINMAX',
      '$LINMIN',
      '$OBSCOLOR',
      '$OBSLTYPE',
      '$PUCSORG',
      '$PUCSORTHOREF',
      '$PUCSORTHOVIEW',
      '$PUCSXDIR',
      '$PICKSTYLE',
      '$PUCSYDIR',
      '$REALWORLDSCALE',
      '$SAVEIMAGES',
      '$SKPOLY',
      '$SURFTAB1',
      '$SURFTAB2',
      '$SURFU',
      '$SURFV',
      '$TILEMODELIGHTSYNCH',
      '$UCSORTHOREF',
      '$UCSORTHOVIEW',
    ].map((v) => [v, 'not in the acad-ts header metadata, so DXF read drops it']),
  ),
};

interface Mismatch {
  /** `LAYER 62`, `$LTSCALE`, …: what ACAD_TS_GAPS is keyed on. */
  readonly kind: string;
  readonly text: string;
}

function findRecord(r: DxfRecord, t: MappedTables, table: TableName) {
  const h = recordHandle(r);
  // R12 files have no handles; acad-ts assigns them, so match those records by name.
  if (h === undefined) {
    const name = first(r.groups, 2)?.toUpperCase();
    return t[table].find((x) => x.name.toUpperCase() === name);
  }
  return t[table].find((x) => x.handle === h);
}

function compareRecord(r: DxfRecord, t: MappedTables, out: Mismatch[], where: string): void {
  const table = TABLE_OF[r.type];
  if (!table) return;
  const rec = findRecord(r, t, table);
  const label = `${where} ${r.type} ${recordHandle(r) ?? '-'} (${first(r.groups, 2)})`;
  if (!rec) {
    // A nameless R12 shape-file style has neither handle nor name to find it by.
    const kind = r.type === 'STYLE' && !first(r.groups, 2) ? 'STYLE 2' : `${r.type} mapped`;
    out.push({ kind, text: `${label}: not mapped` });
    return;
  }
  const checks: Checks<never> = { ...CHECKS[r.type] };
  const report = (code: number, file: string, got: unknown): void => {
    out.push({
      kind: `${r.type} ${code}`,
      text: `${label} ${code}: file ${file} → ${String(got)}`,
    });
  };
  if (r.type === 'LAYER') {
    const tc = first(r.groups, 420);
    if (tc !== undefined) {
      // A true-colour layer's 62 is only the nearest ACI; 420 is the colour.
      delete checks[62];
      const c = (rec as TableRecords['layers']).color;
      const rgb = c.kind === 'rgb' ? (c.r << 16) | (c.g << 8) | c.b : undefined;
      if (rgb !== (Number.parseInt(tc, 10) & 0xffffff)) report(420, tc, JSON.stringify(c));
    }
  }
  if (r.type === 'LTYPE') {
    // acad-ts derives the pattern length from the elements rather than keeping DXF 40, as
    // AutoCAD does when it regenerates; compare with the elements the file states.
    delete checks[40];
    const lengths = all(r.groups, 49).map(Number);
    const rec2 = rec as TableRecords['linetypes'];
    const total = lengths.reduce((a, l) => a + Math.abs(l), 0);
    if (Math.abs(total - rec2.patternLength) > 1e-9 * Math.max(1, total))
      report(40, String(total), rec2.patternLength);
    const got = rec2.elements.map((e) => e.length);
    if (lengths.length !== got.length || lengths.some((l, k) => Math.abs(l - got[k]!) > 1e-9))
      report(49, lengths.join(','), got.join(','));
  }
  for (const [code, [kind, get]] of Object.entries(checks)) {
    const values = all(r.groups, Number(code));
    if (values.length === 0) continue;
    const got = get(rec as never, t);
    if (!same(kind, values[0]!, got)) report(Number(code), values[0]!, got);
  }
}

function compareHeader(
  name: string,
  groups: readonly Group[],
  header: ReadonlyMap<string, HeaderValue>,
  out: Mismatch[],
  where: string,
): void {
  const v = header.get(name);
  const report = (file: string): void => {
    out.push({ kind: name, text: `${where} ${name}: file ${file} → ${JSON.stringify(v)}` });
  };
  if (v === undefined) return report('(set) → not mapped');
  if (groups.length > 1 && groups.every(([c]) => c >= 10 && c < 40)) {
    const p = v as Vec3;
    const parts = [p.x, p.y, 'z' in p ? p.z : 0];
    const bad = groups.some(([, s], k) => {
      const want = Number.parseFloat(s);
      return Math.abs(want - (parts[k] as number)) > 1e-9 * Math.max(1, Math.abs(want));
    });
    if (bad) report(groups.map(([, x]) => x).join(','));
    return;
  }
  const s = groups[0]![1];
  if (name === '$HANDSEED') {
    // acad-ts gives handles to the objects it creates on read (R12 files, default entries)
    // above the seed and raises it, as TESTING.md §3 allows (`$HANDSEED` ≥).
    if (BigInt(`0x${String(v)}`) < BigInt(`0x${s.trim()}`)) report(s);
    return;
  }
  const ok =
    typeof v === 'number'
      ? Math.abs(v - Number.parseFloat(s)) <= 1e-9 * Math.max(1, Math.abs(v))
      : typeof v === 'boolean'
        ? v === (Number.parseInt(s, 10) !== 0)
        : // Names ($CLAYER, $DIMSTYLE) are matched as AutoCAD matches them, ignoring case.
          String(v).trim().toUpperCase() === s.trim().toUpperCase();
  if (!ok) report(s);
}

function load(path: string): Uint8Array {
  return new Uint8Array(readFileSync(`${corpusDir}${path}`));
}

describe('AcadToTriya tables and header on the public corpus (M1-03)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('maps every table record and header variable an ASCII DXF states, unchanged', () => {
    const mismatches: Mismatch[] = [];
    let files = 0;
    for (const f of readable) {
      if (f.format !== 'dxf-ascii') continue;
      const bytes = load(f.path);
      let doc;
      try {
        doc = readCadDocument(bytes);
      } catch {
        continue; // acad-ts read failures are the round-trip suite's concern (read-error)
      }
      files++;
      const oracle = readDxfOracle(bytes);
      const tables = mapTables(doc);
      const { header } = mapHeader(doc);
      for (const r of oracle.records) compareRecord(r, tables, mismatches, f.path);
      for (const [name, groups] of oracle.header)
        compareHeader(name, groups, header, mismatches, f.path);
    }
    expect(files).toBeGreaterThan(50);
    expect(mismatches.filter((m) => !(m.kind in ACAD_TS_GAPS)).map((m) => m.text)).toEqual([]);
    expect([...new Set(mismatches.map((m) => m.kind))].sort()).toEqual(
      Object.keys(ACAD_TS_GAPS).sort(),
    );
  }, 300_000);

  it('maps every acad-ts table entry of every readable file, with references that resolve', () => {
    const problems: string[] = [];
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(load(f.path));
      } catch {
        continue;
      }
      const t = mapTables(doc);
      const sources: [TableName, Iterable<{ handle: number }> | null | undefined][] = [
        ['layers', doc.layers],
        ['linetypes', doc.lineTypes],
        ['textStyles', doc.textStyles],
        ['dimStyles', doc.dimensionStyles],
        ['appIds', doc.appIds],
        ['views', doc.views],
        ['ucs', doc.uCSs],
        ['vports', doc.vPorts],
        ['blockRecords', doc.blockRecords],
        ['mleaderStyles', doc.mLeaderStyles],
        ['tableStyles', doc.tableStyles],
      ];
      for (const [name, src] of sources) {
        const want = [...(src ?? [])].map((e) => e.handle.toString(16).toUpperCase()).sort();
        const got = t[name].map((r) => r.handle).sort();
        if (JSON.stringify(want) !== JSON.stringify(got))
          problems.push(`${f.path} ${name}: ${want.length} → ${got.length}`);
      }
      const linetypes = new Set(t.linetypes.map((r) => r.handle));
      for (const l of t.layers)
        if (!linetypes.has(l.linetype))
          problems.push(`${f.path} layer ${l.name}: linetype ${l.linetype}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
