// TriyaToAcad for the HEADER section and the AcDbVariableDictionary (M1-75 part 6): writes each
// header variable whose value differs from the original's mapping, the inverse of
// `map/header.ts`. What a save cannot keep is refused before anything changes: variables the
// writer owns, values the variable cannot hold, records a name variable does not find, and
// variables the format being saved does not store (or acad-ts does not write to it yet).

import {
  ACadVersion,
  CadDictionary,
  CadHeader,
  DictionaryVariable,
  DxfHeaderSectionWriter,
  type Layer,
  type CadDocument,
  type CadSystemVariable,
} from '@node-projects/acad-ts';
import type { DocumentInit, DocumentModel, HeaderValue } from '@triya/engine';
import {
  annotationScaleValue,
  headerVariableValue,
  isHandleCode,
  namedDictionary,
} from '../map/header';
import type { CadFormat } from '../read';
import { same } from './entities';

/**
 * Header variables acad-ts makes up on every read when the file does not state them (the clock
 * and fresh GUIDs, CadHeader.ts), so the model, mapped from an earlier read, cannot match the
 * original here. Triya never writes them: the writer and AutoCAD own them.
 */
const VOLATILE_HEADER = new Set([
  '$TDCREATE',
  '$TDUCREATE',
  '$TDUPDATE',
  '$TDUUPDATE',
  '$VERSIONGUID',
  '$FINGERPRINTGUID',
]);

/**
 * Variables a save sets itself: the version and code page follow the format written, the seed
 * covers every handle (export.ts), and the rest describe the program and session that saved.
 */
const WRITER_OWNED = new Set([
  '$ACADVER',
  '$DWGCODEPAGE',
  '$HANDSEED',
  '$HANDLING',
  '$ACADMAINTVER',
  '$LASTSAVEDBY',
  '$REQUIREDVERSIONS',
  '$TDINDWG',
  '$TDUSRTIMER',
]);

/**
 * The UCS name variables are the name of the UCS object the header holds, which is the UCS
 * table's own record when one is current: setting one would rename that record.
 */
const UCS_NAMES = /^\$P?UCS(NAME|BASE|ORTHOREF)$/;

/** The records a name can name: the drawing's, and the layers the same save adds. */
type Records = (doc: CadDocument, added: readonly Layer[]) => Iterable<{ name: string }> | null;

const blocks: Records = (d) => d.blockRecords;
const linetypes: Records = (d) => d.lineTypes;

/**
 * Name variables and the records they name, which must exist (AutoCAD looks them up by name;
 * acad-ts throws on a missing one, or the DWG writer, which stores a handle, drops it). The
 * arrow-block and dimension-linetype names may be empty: the default arrowhead, ByBlock.
 */
const NAME_TABLES: Record<string, { readonly records: Records; readonly empty?: true }> = {
  $CLAYER: { records: (d, added) => [...(d.layers ?? []), ...added] },
  $CELTYPE: { records: linetypes },
  $TEXTSTYLE: { records: (d) => d.textStyles },
  $DIMTXSTY: { records: (d) => d.textStyles },
  $DIMSTYLE: { records: (d) => d.dimensionStyles },
  $CMLSTYLE: { records: (d) => [...(namedDictionary(d, CadDictionary.acadMLineStyle) ?? [])] },
  $DIMBLK: { records: blocks, empty: true },
  $DIMBLK1: { records: blocks, empty: true },
  $DIMBLK2: { records: blocks, empty: true },
  $DIMLDRBLK: { records: blocks, empty: true },
  $DIMLTYPE: { records: linetypes, empty: true },
  $DIMLTEX1: { records: linetypes, empty: true },
  $DIMLTEX2: { records: linetypes, empty: true },
};

/**
 * Variables AutoCAD bounds where acad-ts's setter does not, so a value outside the range would
 * be written and then dropped on reading (acad-ts's DWG reader keeps STEPSPERSEC only within
 * it). The ranges are those of the AutoCAD 2024 system variable reference (STEPSPERSEC: 1 to 30).
 */
const VALUE_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  $STEPSPERSEC: [1, 30],
};

/**
 * What a DWG header does not store, by version, as found by saving every variable of the
 * public corpus's DWG samples (export-header.corpus.test.ts keeps this list true). The
 * R13–R14-only variables (ATTDIA, OSMODE, …) moved to the registry in AutoCAD 2000; the
 * R2000+/R2004+/R2007+/R2010+ ones did not exist before (the header layouts of the ODA's Open
 * Design Specification for .dwg, §9). DIMFIT gave way to DIMATFIT and DIMTMOVE in R2000; R2010+
 * stores DIMMZF where acad-ts read DIMFIT until patch 0132. SAVEIMAGES is an R13 DXF variable no
 * DWG header has.
 */
const DWG_LOSSES: readonly {
  readonly from?: ACadVersion;
  readonly through?: ACadVersion;
  readonly names: readonly string[];
  readonly why: string;
}[] = [
  {
    through: ACadVersion.AC1014,
    why: 'R14 DWG does not store it',
    names: [
      '$CELWEIGHT',
      '$CEPSNTYPE',
      '$DIMALTRND',
      '$DIMATFIT',
      '$DIMAUNIT',
      '$DIMAZIN',
      '$DIMDSEP',
      '$DIMFRAC',
      '$DIMLDRBLK',
      '$DIMLUNIT',
      '$DIMLWD',
      '$DIMLWE',
      '$DIMTMOVE',
      '$ENDCAPS',
      '$EXTNAMES',
      '$INSUNITS',
      '$JOINSTYLE',
      '$LWDISPLAY',
      '$OLESTARTUP',
      '$PSTYLEMODE',
      '$PSVPSCALE',
      '$PUCSORGBACK',
      '$PUCSORGBOTTOM',
      '$PUCSORGFRONT',
      '$PUCSORGLEFT',
      '$PUCSORGRIGHT',
      '$PUCSORGTOP',
      '$PUCSORTHOVIEW',
      '$STYLESHEET',
      '$UCSORGBACK',
      '$UCSORGBOTTOM',
      '$UCSORGFRONT',
      '$UCSORGLEFT',
      '$UCSORGRIGHT',
      '$UCSORGTOP',
      '$UCSORTHOVIEW',
      '$XEDIT',
    ],
  },
  {
    through: ACadVersion.AC1015,
    why: 'DWG before R2004 does not store it',
    names: [
      '$DIMASSOC',
      '$HALOGAP',
      '$HIDETEXT',
      '$INDEXCTL',
      '$INTERSECTIONCOLOR',
      '$INTERSECTIONDISPLAY',
      '$MEASUREMENT',
      '$OBSCOLOR',
      '$OBSLTYPE',
      '$PROJECTNAME',
      '$SORTENTS',
      '$XCLIPFRAME',
    ],
  },
  {
    through: ACadVersion.AC1018,
    why: 'DWG before R2007 does not store it',
    names: [
      '$3DDWFPREC',
      '$CAMERADISPLAY',
      '$CAMERAHEIGHT',
      '$CSHADOW',
      '$DIMARCSYM',
      '$DIMFXL',
      '$DIMFXLON',
      '$DIMJOGANG',
      '$DIMLTEX1',
      '$DIMLTEX2',
      '$DIMLTYPE',
      '$DIMTFILL',
      '$DIMTFILLCLR',
      '$INTERFERECOLOR',
      '$LATITUDE',
      '$LENSLENGTH',
      '$LOFTANG1',
      '$LOFTANG2',
      '$LOFTMAG1',
      '$LOFTMAG2',
      '$LOFTPARAM',
      '$LONGITUDE',
      '$NORTHDIRECTION',
      '$PSOLHEIGHT',
      '$PSOLWIDTH',
      '$REALWORLDSCALE',
      '$SHADOWPLANELOCATION',
      '$SHOWHIST',
      '$SOLIDHIST',
      '$STEPSIZE',
      '$STEPSPERSEC',
      '$TILEMODELIGHTSYNCH',
      '$TIMEZONE',
    ],
  },
  {
    through: ACadVersion.AC1021,
    why: 'DWG before R2010 does not store it',
    names: ['$DIMALTMZF', '$DIMALTMZS', '$DIMMZF', '$DIMMZS', '$DIMTXTDIRECTION'],
  },
  {
    from: ACadVersion.AC1015,
    why: 'DWG from R2000 does not store it (DIMATFIT and DIMTMOVE replaced it)',
    names: ['$DIMFIT'],
  },
  {
    why: 'DWG does not store it',
    names: ['$SAVEIMAGES'],
  },
  {
    from: ACadVersion.AC1015,
    why: 'DWG from R2000 does not store it (AutoCAD keeps it in the registry)',
    names: [
      '$ATTDIA',
      '$ATTREQ',
      '$BLIPMODE',
      '$COORDS',
      '$DELOBJ',
      '$DIMUNIT',
      '$DRAGMODE',
      '$OSMODE',
      '$PICKSTYLE',
    ],
  },
];

/** The variables acad-ts's DXF writer writes for R12 and earlier (its own private list). */
const R12_VARIABLES: ReadonlySet<string> =
  (DxfHeaderSectionWriter as unknown as { r12Variables?: ReadonlySet<string> }).r12Variables ??
  new Set();

/** Why `format`/`version` cannot keep a change of `name` (empty: it can). */
function formatProblem(
  name: string,
  variable: CadSystemVariable,
  format: CadFormat | undefined,
  version: ACadVersion | undefined,
): string | undefined {
  if (format === 'dxf' && version !== undefined && version <= ACadVersion.AC1009) {
    return R12_VARIABLES.has(name) ? undefined : 'an R12 DXF does not store it';
  }
  // acad-ts marks the variables its DXF writer skips as Ignored (DxfReferenceType 16).
  if (format === 'dxf' && (variable.referenceType & 16) !== 0) {
    return 'acad-ts writes no DXF value for it';
  }
  if (format !== 'dwg' || version === undefined) return undefined;
  for (const l of DWG_LOSSES) {
    if (!l.names.includes(name)) continue;
    if (
      (l.from === undefined || version >= l.from) &&
      (l.through === undefined || version <= l.through)
    )
      return l.why;
  }
  return undefined;
}

/** The DXF values `setValue` takes for a Triya header value, as the DXF reader passes them. */
function dxfValues(variable: CadSystemVariable, value: HeaderValue): unknown[] {
  if (typeof value === 'object')
    return 'z' in value ? [value.x, value.y, value.z] : [value.x, value.y];
  if (
    variable.dxfCodes.length === 1 &&
    isHandleCode(variable.dxfCodes[0]!) &&
    typeof value === 'string'
  )
    return [Number.parseInt(value, 16)];
  return [value];
}

function variableDictionary(doc: CadDocument): Map<string, DictionaryVariable> {
  const out = new Map<string, DictionaryVariable>();
  for (const v of namedDictionary(doc, CadDictionary.variableDictionary) ?? [])
    if (v instanceof DictionaryVariable && v.name) out.set(v.name, v);
  return out;
}

export interface HeaderChange {
  readonly name: string;
  readonly value: HeaderValue;
}

/**
 * The header changes of `model` against `base` (the original's mapping), and why any cannot be
 * written to `doc` for `format`.
 */
export function planHeader(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  format: CadFormat | undefined,
  added: readonly Layer[],
): { changes: HeaderChange[]; problems: string[] } {
  const before = new Map(base.header ?? []);
  const names = new Set([...before.keys(), ...model.header.keys()]);
  const map = CadHeader.getHeaderMap();
  const dictionary = variableDictionary(doc);
  const version = doc.header?.version;
  const changes: HeaderChange[] = [];
  const problems: string[] = [];
  for (const name of names) {
    const value = model.header.get(name);
    if (VOLATILE_HEADER.has(name) || same(before.get(name), value)) continue;
    const problem = headerProblem(
      doc,
      added,
      name,
      value,
      map.get(name),
      dictionary,
      format,
      version,
    );
    if (problem) problems.push(`header variable ${name}: ${problem}`);
    else changes.push({ name, value: value! });
  }
  // CANNOSCALEVALUE is not stored: it is the CANNOSCALE scale's ratio, so it must follow it.
  const scale = model.header.get(DictionaryVariable.currentAnnotationScale);
  const ratio = model.header.get('CANNOSCALEVALUE');
  if (
    !same(before.get('CANNOSCALEVALUE'), ratio) &&
    !same(scale === undefined ? undefined : annotationScaleValue(doc, scale), ratio)
  ) {
    problems.push(`header variable CANNOSCALEVALUE: it is the ratio of the CANNOSCALE scale`);
  }
  return { changes: changes.filter((c) => c.name !== 'CANNOSCALEVALUE'), problems };
}

function headerProblem(
  doc: CadDocument,
  added: readonly Layer[],
  name: string,
  value: HeaderValue | undefined,
  variable: CadSystemVariable | undefined,
  dictionary: ReadonlyMap<string, DictionaryVariable>,
  format: CadFormat | undefined,
  version: ACadVersion | undefined,
): string | undefined {
  if (name === 'CANNOSCALEVALUE') return undefined;
  if (value === undefined) return 'removing a variable';
  if (!variable) {
    // A DICTIONARYVAR (bare name) holds text; a new one would be a new object (M1-75).
    if (name.startsWith('$')) return 'acad-ts has no such header variable';
    if (!dictionary.has(name)) return 'new DICTIONARYVAR objects';
    return typeof value === 'string' ? undefined : 'a DICTIONARYVAR holds text';
  }
  if (WRITER_OWNED.has(name)) return 'the save sets it';
  if (UCS_NAMES.test(name)) return 'it names the UCS record acad-ts holds (renaming it)';
  const table = NAME_TABLES[name];
  if (table) {
    if (typeof value !== 'string') return 'a name variable holds text';
    // Spelled as the record is: the header maps back with the record's own name.
    const found =
      (value === '' && table.empty) ||
      [...(table.records(doc, added) ?? [])].some((r) => r.name === value);
    if (!found) return `no record named ${JSON.stringify(value)}`;
  } else {
    // Dry run on a header of its own: the value must be one the variable holds as given.
    const scratch = new CadHeader();
    try {
      scratch.setValue(name, dxfValues(variable, value));
    } catch {
      return `it cannot hold ${JSON.stringify(value)}`;
    }
    if (!same(headerVariableValue(name, variable, scratch), value))
      return `it cannot hold ${JSON.stringify(value)}`;
    const range = VALUE_RANGES[name];
    if (range && (typeof value !== 'number' || value < range[0] || value > range[1]))
      return `it cannot hold ${JSON.stringify(value)} (AutoCAD takes ${range[0]}–${range[1]})`;
  }
  return formatProblem(name, variable, format, version);
}

/** Writes the planned header changes onto `doc` (after the table records they may name). */
export function writeHeader(doc: CadDocument, changes: readonly HeaderChange[]): void {
  const header = doc.header;
  if (!header) return;
  const map = CadHeader.getHeaderMap();
  const dictionary = variableDictionary(doc);
  for (const { name, value } of changes) {
    const variable = map.get(name);
    if (!variable) {
      dictionary.get(name)!.value = value as string;
      continue;
    }
    header.setValue(name, dxfValues(variable, value));
  }
}
