// M1-03 acceptance: the tables and header vars AcadToTriya produces for every public-corpus
// ASCII DXF equal what the file itself states, read by an independent group-code reader
// (dxf-oracle.ts). DWG and binary DXF files are checked for completeness (every acad-ts table
// entry is mapped, every reference resolves) because there is no text to compare against.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Color, HeaderValue, TableName, TableRecords, Vec2, Vec3 } from '@triya/engine';
import type { CadDocument } from '@node-projects/acad-ts';
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
  MLEADERSTYLE: 'mleaderStyles',
  TABLESTYLE: 'tableStyles',
};

type Getter<R> = (r: R, t: MappedTables) => unknown;
type Kind = 'num' | 'deg' | 'int' | 'str' | 'name' | 'bool' | 'handle' | 'cmcolor' | 'aci' | 'lw';
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

/**
 * DIMSTYLE groups by the AutoCAD DXF reference, written out here rather than taken from
 * `@triya/io` so that the test stays independent of the table it checks. 70 (flags and
 * DIMTFILLCLR), 278 (DIMDSEP) and the R12 names 5/6/7 are compared in compareRecord.
 */
const DIMSTYLE_GROUPS: Record<number, [string, Kind]> = {
  3: ['DIMPOST', 'str'],
  4: ['DIMAPOST', 'str'],
  40: ['DIMSCALE', 'num'],
  41: ['DIMASZ', 'num'],
  42: ['DIMEXO', 'num'],
  43: ['DIMDLI', 'num'],
  44: ['DIMEXE', 'num'],
  45: ['DIMRND', 'num'],
  46: ['DIMDLE', 'num'],
  47: ['DIMTP', 'num'],
  48: ['DIMTM', 'num'],
  49: ['DIMFXL', 'num'],
  50: ['DIMJOGANG', 'deg'],
  69: ['DIMTFILL', 'int'],
  71: ['DIMTOL', 'bool'],
  72: ['DIMLIM', 'bool'],
  73: ['DIMTIH', 'bool'],
  74: ['DIMTOH', 'bool'],
  75: ['DIMSE1', 'bool'],
  76: ['DIMSE2', 'bool'],
  77: ['DIMTAD', 'int'],
  78: ['DIMZIN', 'int'],
  79: ['DIMAZIN', 'int'],
  90: ['DIMARCSYM', 'int'],
  140: ['DIMTXT', 'num'],
  141: ['DIMCEN', 'num'],
  142: ['DIMTSZ', 'num'],
  143: ['DIMALTF', 'num'],
  144: ['DIMLFAC', 'num'],
  145: ['DIMTVP', 'num'],
  146: ['DIMTFAC', 'num'],
  147: ['DIMGAP', 'num'],
  148: ['DIMALTRND', 'num'],
  170: ['DIMALT', 'bool'],
  171: ['DIMALTD', 'int'],
  172: ['DIMTOFL', 'bool'],
  173: ['DIMSAH', 'bool'],
  174: ['DIMTIX', 'bool'],
  175: ['DIMSOXD', 'bool'],
  176: ['DIMCLRD', 'int'],
  177: ['DIMCLRE', 'int'],
  178: ['DIMCLRT', 'int'],
  179: ['DIMADEC', 'int'],
  270: ['DIMUNIT', 'int'],
  271: ['DIMDEC', 'int'],
  272: ['DIMTDEC', 'int'],
  273: ['DIMALTU', 'int'],
  274: ['DIMALTTD', 'int'],
  275: ['DIMAUNIT', 'int'],
  276: ['DIMFRAC', 'int'],
  277: ['DIMLUNIT', 'int'],
  279: ['DIMTMOVE', 'int'],
  280: ['DIMJUST', 'int'],
  281: ['DIMSD1', 'bool'],
  282: ['DIMSD2', 'bool'],
  283: ['DIMTOLJ', 'int'],
  284: ['DIMTZIN', 'int'],
  285: ['DIMALTZ', 'int'],
  286: ['DIMALTTZ', 'int'],
  287: ['DIMFIT', 'int'],
  288: ['DIMUPT', 'bool'],
  289: ['DIMATFIT', 'int'],
  290: ['DIMFXLON', 'bool'],
  294: ['DIMTXTDIRECTION', 'int'],
  340: ['DIMTXSTY', 'handle'],
  341: ['DIMLDRBLK', 'handle'],
  342: ['DIMBLK', 'handle'],
  343: ['DIMBLK1', 'handle'],
  344: ['DIMBLK2', 'handle'],
  345: ['DIMLTYPE', 'handle'],
  346: ['DIMLTEX1', 'handle'],
  347: ['DIMLTEX2', 'handle'],
  371: ['DIMLWD', 'int'],
  372: ['DIMLWE', 'int'],
};

const DIMSTYLE: Checks<TableRecords['dimStyles']> = {
  2: ['str', (r) => r.name],
  ...Object.fromEntries(
    Object.entries(DIMSTYLE_GROUPS).map(([code, [name, kind]]) => [
      code,
      [kind, (r: TableRecords['dimStyles']) => r.vars[name]],
    ]),
  ),
};

const MLEADERSTYLE: Checks<TableRecords['mleaderStyles']> = {
  3: ['str', (r) => r.description],
  170: ['int', (r) => r.contentType],
  171: ['int', (r) => r.mleaderDrawOrder],
  172: ['int', (r) => r.leaderDrawOrder],
  90: ['int', (r) => r.maxLeaderPoints],
  40: ['num', (r) => r.firstSegmentAngle],
  41: ['num', (r) => r.secondSegmentAngle],
  173: ['int', (r) => r.pathType],
  91: ['cmcolor', (r) => r.lineColor],
  340: ['handle', (r) => r.linetype],
  92: ['lw', (r) => r.lineweight],
  290: ['bool', (r) => r.landing],
  42: ['num', (r) => r.landingGap],
  291: ['bool', (r) => r.dogleg],
  43: ['num', (r) => r.doglegLength],
  341: ['handle', (r) => r.arrowhead],
  44: ['num', (r) => r.arrowheadSize],
  300: ['str', (r) => r.defaultText],
  342: ['handle', (r) => r.textStyle],
  174: ['int', (r) => r.textLeftAttachment],
  178: ['int', (r) => r.textRightAttachment],
  273: ['int', (r) => r.textTopAttachment],
  272: ['int', (r) => r.textBottomAttachment],
  271: ['int', (r) => r.textAttachmentDirection],
  175: ['int', (r) => r.textAngleType],
  176: ['int', (r) => r.textAlignment],
  93: ['cmcolor', (r) => r.textColor],
  45: ['num', (r) => r.textHeight],
  292: ['bool', (r) => r.textFrame],
  297: ['bool', (r) => r.textAlignAlwaysLeft],
  46: ['num', (r) => r.alignSpace],
  343: ['handle', (r) => r.block],
  94: ['cmcolor', (r) => r.blockColor],
  47: ['num', (r) => r.blockScale.x],
  49: ['num', (r) => r.blockScale.y],
  140: ['num', (r) => r.blockScale.z],
  293: ['bool', (r) => r.blockScaleOn],
  141: ['deg', (r) => r.blockRotation],
  294: ['bool', (r) => r.blockRotationOn],
  177: ['int', (r) => r.blockConnection],
  142: ['num', (r) => r.scale],
  295: ['bool', (r) => r.overwriteProperties],
  296: ['bool', (r) => r.annotative],
  143: ['num', (r) => r.breakGap],
};

const TABLESTYLE: Checks<TableRecords['tableStyles']> = {
  3: ['str', (r) => r.description],
  70: ['int', (r) => r.flowDirection],
  71: ['int', (r) => r.styleFlags],
  40: ['num', (r) => r.horizontalMargin],
  41: ['num', (r) => r.verticalMargin],
  280: ['bool', (r) => r.suppressTitle],
  281: ['bool', (r) => r.suppressHeader],
};

/** TABLESTYLE cell-style groups, which repeat for each cell style starting at its 7. */
const CELL_STYLE: Checks<TableRecords['tableStyles']['cellStyles'][number]> = {
  140: ['num', (c) => c.textHeight],
  170: ['int', (c) => c.alignment],
  62: ['aci', (c) => c.textColor],
  63: ['aci', (c) => c.fillColor],
  283: ['bool', (c) => c.fillOn],
  90: ['int', (c) => c.dataType],
  91: ['int', (c) => c.unitType],
  ...Object.fromEntries(
    [0, 1, 2, 3, 4, 5].flatMap((k) => [
      [
        274 + k,
        ['lw', (c: TableRecords['tableStyles']['cellStyles'][number]) => c.borders[k]?.lineweight],
      ],
      // AutoCAD's DXF reference: 284–289 are 1 when the border is visible.
      [
        284 + k,
        ['bool', (c: TableRecords['tableStyles']['cellStyles'][number]) => c.borders[k]?.visible],
      ],
      [
        64 + k,
        ['aci', (c: TableRecords['tableStyles']['cellStyles'][number]) => c.borders[k]?.color],
      ],
    ]),
  ),
};

const CHECKS: Record<string, Checks<never>> = {
  MLEADERSTYLE,
  TABLESTYLE,
  DIMSTYLE,
  LAYER,
  LTYPE,
  STYLE,
  BLOCK_RECORD,
  APPID,
  UCS,
  VIEW,
  VPORT,
} as unknown as Record<string, Checks<never>>;

/** A DXF colour number (62): 0 ByBlock, 256 ByLayer, else ACI. */
function aciColor(n: number): Color {
  return n === 0
    ? { kind: 'byBlock' }
    : n === 256
      ? { kind: 'byLayer' }
      : { kind: 'aci', index: n };
}
/**
 * An AcCmEntityColor as MLEADERSTYLE writes it (91/93/94): the high byte is the method
 * (0xC0 ByLayer, 0xC1 ByBlock, 0xC2 RGB, 0xC3 ACI) and the low bytes the colour.
 */
function cmColor(v: number): Color | undefined {
  const method = (v >>> 24) & 0xff;
  if (method === 0xc0) return { kind: 'byLayer' };
  if (method === 0xc1) return { kind: 'byBlock' };
  if (method === 0xc2) return { kind: 'rgb', r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  if (method === 0xc3) return aciColor(v & 0xff);
  return undefined;
}
const sameColor = (a: unknown, b: Color | undefined): boolean =>
  b !== undefined && JSON.stringify(a) === JSON.stringify(b);

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
    case 'lw':
      return (
        (typeof triya === 'string' ? LW[triya as keyof typeof LW] : triya) ===
        Number.parseInt(dxf, 10)
      );
    case 'aci':
      return sameColor(triya, aciColor(Number.parseInt(dxf, 10)));
    case 'cmcolor':
      return sameColor(triya, cmColor(Number.parseInt(dxf, 10)));
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
    [284, 285, 286, 287, 288, 289].map((c) => [
      `TABLESTYLE ${c}`,
      'acad-ts reads the TABLESTYLE border visibility flags (1 = visible) as isInvisible',
    ]),
  ),
  'DIMSTYLE 5':
    'an R12 DIMBLK names a built-in arrowhead without its underscore (BOXBLANK for the _BOXBLANK block); acad-ts leaves it unresolved',
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
  if (r.type === 'TABLESTYLE') {
    // Split the record at each 7 (a cell style's text style); before the first are the
    // style's own groups.
    const starts = r.groups.flatMap(([c], k) => (c === 7 ? [k] : []));
    const cells = (rec as TableRecords['tableStyles']).cellStyles;
    if (cells.length !== starts.length) report(7, `${starts.length} cell styles`, cells.length);
    starts.forEach((start, n) => {
      const groups = r.groups.slice(start, starts[n + 1] ?? r.groups.length);
      const cell = cells[n];
      if (!cell) return;
      const name = groups[0]![1].trim().toUpperCase();
      if (nameOf(t, 'textStyles', cell.textStyle)?.toUpperCase() !== name)
        report(7, name, nameOf(t, 'textStyles', cell.textStyle));
      for (const [code, [kind, get]] of Object.entries(CELL_STYLE)) {
        const v = first(groups, Number(code));
        if (v !== undefined && !same(kind, v, get(cell, t)))
          report(Number(code), v, JSON.stringify(get(cell, t)));
      }
    });
    // The style's own groups are those before the first cell style.
    r = { type: r.type, groups: r.groups.slice(0, starts[0] ?? r.groups.length) };
  }
  if (r.type === 'DIMSTYLE') {
    const d = rec as TableRecords['dimStyles'];
    // 70 is the flags and, after DIMTFILL (69), DIMTFILLCLR.
    const seventies = all(r.groups, 70);
    if (!same('int', seventies[0]!, d.flags ?? 0)) report(70, seventies[0]!, d.flags);
    if (seventies[1] !== undefined && !same('int', seventies[1], d.vars['DIMTFILLCLR']))
      report(70, seventies[1], d.vars['DIMTFILLCLR']);
    const dsep = first(r.groups, 278);
    if (dsep !== undefined && d.vars['DIMDSEP'] !== String.fromCharCode(Number.parseInt(dsep, 10)))
      report(278, dsep, d.vars['DIMDSEP']);
    // Some writers (ezdxf's minimal files) put names where the reference wants handles.
    for (const [code, table] of [
      [340, 'textStyles'],
      [341, 'blockRecords'],
      [342, 'blockRecords'],
      [343, 'blockRecords'],
      [344, 'blockRecords'],
      [345, 'linetypes'],
      [346, 'linetypes'],
      [347, 'linetypes'],
    ] as const) {
      const want = first(r.groups, code);
      if (want === undefined || /^\s*[0-9A-Fa-f]+\s*$/.test(want)) continue;
      delete checks[code];
      const h = d.vars[DIMSTYLE_GROUPS[code]![0]] as string | undefined;
      const got = want.trim() === '' ? h : nameOf(t, table, h)?.toUpperCase();
      if (got !== (want.trim() === '' ? undefined : want.trim().toUpperCase()))
        report(code, want, got);
    }
    // R12 names the arrow blocks (5/6/7) where later versions give handles (342–344).
    for (const [code, name] of [
      [5, 'DIMBLK'],
      [6, 'DIMBLK1'],
      [7, 'DIMBLK2'],
    ] as const) {
      const want = first(r.groups, code);
      if (want === undefined) continue;
      const got = nameOf(t, 'blockRecords', d.vars[name] as string | undefined) ?? '';
      if (got.toUpperCase() !== want.trim().toUpperCase()) report(code, want, got);
    }
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

function dictionaryEntries(doc: CadDocument, key: string, type: string): { handle: number }[] {
  const dict = doc.rootDictionary?.get(key) as
    Iterable<{ handle: number; objectName: string }> | undefined;
  return [...(dict ?? [])].filter((o) => o.objectName === type);
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
      for (const r of [...oracle.records, ...oracle.objects])
        compareRecord(r, tables, mismatches, f.path);
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
        // Every style in the style dictionaries. R13/R14 files hold them as proxy objects,
        // which stay passthrough (FILE_FIDELITY: ACAD_PROXY_OBJECT).
        ['mleaderStyles', dictionaryEntries(doc, 'ACAD_MLEADERSTYLE', 'MLEADERSTYLE')],
        ['tableStyles', dictionaryEntries(doc, 'ACAD_TABLESTYLE', 'TABLESTYLE')],
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
      const textStyles = new Set(t.textStyles.map((r) => r.handle));
      const styleRefs = [
        ...t.mleaderStyles.map((m) => [`mleader style ${m.name}`, m.textStyle] as const),
        ...t.tableStyles.flatMap((ts) =>
          ts.cellStyles.map((c) => [`table style ${ts.name}`, c.textStyle] as const),
        ),
      ];
      for (const [what, h] of styleRefs)
        if (h !== undefined && !textStyles.has(h))
          problems.push(`${f.path} ${what}: text style ${h}`);
    }
    expect(problems).toEqual([]);
  }, 300_000);
});
