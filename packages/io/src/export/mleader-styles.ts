// TriyaToAcad for MLEADERSTYLE objects (M1-75 part 11): writes an edited multileader style's
// changed fields onto its acad-ts object, by handle, and adds the styles the drawing gains under
// the engine's handles (the MLEADERSTYLE manager, M4-04; MLEADER with a new current style,
// M2-09), the inverse of `mleaderStyle()` in map/styles.ts. Triya keeps the styles beside the
// symbol tables, but the file keeps them as objects named by their ACAD_MLEADERSTYLE dictionary
// entry, so a new one joins that dictionary. Its text style, leader linetype, arrowhead and
// content block may name a record the same save adds, except blocks, as block definitions are
// not written yet.
//
// A renamed style keeps its ACAD_MLEADERSTYLE entry where it stands under the new name (M1-95);
// the MULTILEADERs using it point at it by handle and follow, and CMLEADERSTYLE, which names
// it, must change with it (header.ts).
//
// Refused: a new style before R2007 (AutoCAD 2008 introduced multileaders); the text attachment direction and the top and
// bottom attachments in a DWG before R2010, whose MLEADERSTYLE has no place for them (the ODA's
// Open Design Specification for .dwg, MLEADERSTYLE: "R2010+"; acad-ts reads them back as 0);
// and values AutoCAD's dialog does not take.

import {
  ACadVersion,
  BlockRecord,
  CadDictionary,
  LineType,
  MultiLeaderStyle,
  TextStyle,
  XYZ,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type { Color, DocumentInit, DocumentModel, Handle, MLeaderStyleRecord } from '@triya/engine';
import type { CadFormat } from '../read';
import { acadColor, acadLineweight, resolve, type Resolver } from './entities';
import { entryRenameProblems, entryTakenProblems, renameEntries } from './dictionary-entries';
import { changes, planRecords, type RecordPlan } from './records';

export type MLeaderStylePlan = RecordPlan<MultiLeaderStyle, MLeaderStyleRecord>;

type Field = keyof MLeaderStyleRecord;

/** Fields the DWG MLEADERSTYLE holds from R2010 (its object version 2). */
const R2010_FIELDS: readonly Field[] = [
  'textAttachmentDirection',
  'textTopAttachment',
  'textBottomAttachment',
];

/** Whole-number fields (DWG BS and BL) and the values AutoCAD gives them. */
const WHOLE: Partial<Record<Field, readonly [number, number]>> = {
  // DXF 170: 0 none, 1 block, 2 mtext, 3 tolerance.
  contentType: [0, 3],
  // DXF 171 / 172: content or leader first; leader head or tail first.
  mleaderDrawOrder: [0, 1],
  leaderDrawOrder: [0, 1],
  // DXF 90: the leader's maximum points; AutoCAD's dialog takes 2 and up.
  maxLeaderPoints: [2, 0x7fffffff],
  // DXF 173: 0 invisible, 1 straight, 2 spline.
  pathType: [0, 2],
  // DXF 174 / 178: the nine horizontal attachments; 273 / 272: the vertical ones (9 centre,
  // 10 underline and centre … as MULTILEADER's), all within a BS.
  textLeftAttachment: [0, 0x7fff],
  textRightAttachment: [0, 0x7fff],
  textTopAttachment: [0, 0x7fff],
  textBottomAttachment: [0, 0x7fff],
  // DXF 271: 0 horizontal, 1 vertical.
  textAttachmentDirection: [0, 1],
  // DXF 175: 0 insert angle, 1 horizontal, 2 always right-reading.
  textAngleType: [0, 2],
  // DXF 176: 0 left, 1 centre, 2 right.
  textAlignment: [0, 2],
  // DXF 177: 0 block extents, 1 base point.
  blockConnection: [0, 1],
};

/**
 * Lengths that may be 0 but not negative; the scale is 0 when the style scales multileaders to
 * the layout (AutoCAD's "Scale multileaders to layout").
 */
const NOT_NEGATIVE: readonly Field[] = [
  'landingGap',
  'doglegLength',
  'arrowheadSize',
  'alignSpace',
  'scale',
  'breakGap',
];

const NUMBERS: readonly Field[] = [
  'firstSegmentAngle',
  'secondSegmentAngle',
  'textHeight',
  'blockRotation',
  ...NOT_NEGATIVE,
];

const BOOLEANS: readonly Field[] = [
  'landing',
  'dogleg',
  'textFrame',
  'textAlignAlwaysLeft',
  'blockScaleOn',
  'blockRotationOn',
  'overwriteProperties',
  'annotative',
];

/** The lineweights AutoCAD offers, in hundredths of a millimetre (DXF 370's values). */
const LINEWEIGHTS: readonly number[] = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];

const COLORS: readonly Field[] = ['lineColor', 'textColor', 'blockColor'];

/** Reference fields and what each names; the text style and linetype are never empty. */
const REFS: readonly (readonly [Field, abstract new (...args: never[]) => CadObject, boolean])[] = [
  ['textStyle', TextStyle, true],
  ['linetype', LineType, true],
  ['arrowhead', BlockRecord, false],
  ['block', BlockRecord, false],
];

/** The model's multileader style changes against the original's mapping, and why any cannot be written. */
export function planMLeaderStyles(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
  format: CadFormat | undefined,
): { plan: MLeaderStylePlan; problems: string[] } {
  const version = doc.header?.version;
  return planRecords(doc, base.tables?.mleaderStyles ?? [], model.tables.mleaderStyles, r, {
    what: 'multileader style',
    type: MultiLeaderStyle,
    make: (a) => new MultiLeaderStyle(a.name),
    fixedNames: [MultiLeaderStyle.defaultName],
    removable: true,
    problems: (b, a, acad) => [
      ...mleaderStyleProblems(r, version, format, b, a),
      ...(b && acad && b.name !== a.name
        ? entryRenameProblems(acad, a.name, (o) =>
            model.tables.mleaderStyles.has(o.handle.toString(16).toUpperCase()),
          )
        : []),
      ...(b
        ? []
        : entryTakenProblems(doc.rootDictionary?.get(CadDictionary.acadMLeaderStyle), a.name, (o) =>
            model.tables.mleaderStyles.has(o.handle.toString(16).toUpperCase()),
          )),
    ],
  });
}

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

function mleaderStyleProblems(
  r: Resolver,
  version: ACadVersion | undefined,
  format: CadFormat | undefined,
  b: MLeaderStyleRecord | undefined,
  a: MLeaderStyleRecord,
): string[] {
  const out: string[] = [];
  const changed = changes(b, a);
  // A MLEADERSTYLE is an object, not a table record: it has no DXF 70 flags.
  if (changed('flags') && a.flags !== undefined) out.push('a multileader style has no flags');
  if (!b && known(version) && version < ACadVersion.AC1021)
    out.push(`${ACadVersion[version]} has no multileader styles (R2007 introduced them)`);
  if (format === 'dwg' && known(version) && version < ACadVersion.AC1024) {
    for (const k of R2010_FIELDS.filter((k) => changed(k)))
      out.push(`${k}: a DWG MLEADERSTYLE before R2010 does not store it`);
  }
  for (const [k, [min, max]] of Object.entries(WHOLE) as [Field, [number, number]][]) {
    const v = a[k];
    if (changed(k) && !(typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max))
      out.push(`${k}: ${JSON.stringify(v)} is not a whole number from ${min} to ${max}`);
  }
  for (const k of NUMBERS.filter((k) => changed(k))) {
    const v = a[k];
    if (typeof v !== 'number' || !Number.isFinite(v))
      out.push(`${k}: ${JSON.stringify(v)} is not a number`);
    else if (NOT_NEGATIVE.includes(k) && v < 0) out.push(`${k}: ${v} is negative`);
  }
  if (changed('textHeight') && typeof a.textHeight === 'number' && !(a.textHeight > 0))
    out.push(`textHeight: ${a.textHeight} is not more than 0`);
  if (changed('blockScale')) {
    const s = a.blockScale;
    if (![s?.x, s?.y, s?.z].every((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0))
      out.push('blockScale: each factor is a number other than 0');
  }
  for (const k of BOOLEANS.filter((k) => changed(k)))
    if (typeof a[k] !== 'boolean') out.push(`${k}: ${JSON.stringify(a[k])} is not true or false`);
  for (const k of ['description', 'defaultText'] as const)
    if (changed(k) && typeof a[k] !== 'string')
      out.push(`${k}: ${JSON.stringify(a[k])} is not text`);
  for (const k of COLORS.filter((k) => changed(k))) {
    const c = a[k] as Color;
    if (c.kind === 'rgb' && c.bookName !== undefined) out.push(`${k}: colour-book colours`);
  }
  if (changed('lineweight')) {
    const w = a.lineweight;
    const named = w === 'ByLayer' || w === 'ByBlock' || w === 'Default';
    if (!named && !LINEWEIGHTS.includes(w as number))
      out.push(`lineweight: ${JSON.stringify(w)} is not a lineweight`);
  }
  for (const [k, type, required] of REFS) {
    if (!changed(k)) continue;
    const h = a[k] as Handle | undefined;
    if (h === undefined) {
      if (required) out.push(`${k}: a multileader style needs one`);
    } else if (!resolve(r, h, type)) out.push(`${k}: ${h} does not exist`);
  }
  return out;
}

/** Writes the fields of `a` that differ from `b` (every one when `b` is undefined). */
function writeMLeaderStyle(
  r: Resolver,
  s: MultiLeaderStyle,
  b: MLeaderStyleRecord | undefined,
  a: MLeaderStyleRecord,
): void {
  const changed = changes(b, a);
  const ref = <T>(h: Handle | undefined, type: abstract new (...args: never[]) => T): T | null =>
    h === undefined ? null : (resolve(r, h, type) ?? null);
  if (changed('description')) s.description = a.description;
  if (changed('contentType')) s.contentType = a.contentType as never;
  if (changed('mleaderDrawOrder')) s.multiLeaderDrawOrder = a.mleaderDrawOrder as never;
  if (changed('leaderDrawOrder')) s.leaderDrawOrder = a.leaderDrawOrder as never;
  if (changed('maxLeaderPoints')) s.maxLeaderSegmentsPoints = a.maxLeaderPoints;
  if (changed('firstSegmentAngle')) s.firstSegmentAngleConstraint = a.firstSegmentAngle;
  if (changed('secondSegmentAngle')) s.secondSegmentAngleConstraint = a.secondSegmentAngle;
  if (changed('pathType')) s.pathType = a.pathType;
  if (changed('lineColor')) s.lineColor = acadColor(a.lineColor);
  if (changed('linetype')) s.leaderLineType = ref(a.linetype, LineType)!;
  if (changed('lineweight')) s.leaderLineWeight = acadLineweight(a.lineweight);
  if (changed('landing')) s.enableLanding = a.landing;
  if (changed('landingGap')) s.landingGap = a.landingGap;
  if (changed('dogleg')) s.enableDogleg = a.dogleg;
  if (changed('doglegLength')) s.landingDistance = a.doglegLength;
  if (changed('arrowhead')) s.arrowhead = ref(a.arrowhead, BlockRecord);
  if (changed('arrowheadSize')) s.arrowheadSize = a.arrowheadSize;
  if (changed('defaultText')) s.defaultTextContents = a.defaultText;
  if (changed('textStyle')) s.textStyle = ref(a.textStyle, TextStyle)!;
  if (changed('textLeftAttachment')) s.textLeftAttachment = a.textLeftAttachment;
  if (changed('textRightAttachment')) s.textRightAttachment = a.textRightAttachment;
  if (changed('textTopAttachment')) s.textTopAttachment = a.textTopAttachment;
  if (changed('textBottomAttachment')) s.textBottomAttachment = a.textBottomAttachment;
  if (changed('textAttachmentDirection')) s.textAttachmentDirection = a.textAttachmentDirection;
  if (changed('textAngleType')) s.textAngle = a.textAngleType;
  if (changed('textAlignment')) s.textAlignment = a.textAlignment;
  if (changed('textColor')) s.textColor = acadColor(a.textColor);
  if (changed('textHeight')) s.textHeight = a.textHeight;
  if (changed('textFrame')) s.textFrame = a.textFrame;
  if (changed('textAlignAlwaysLeft')) s.textAlignAlwaysLeft = a.textAlignAlwaysLeft;
  if (changed('alignSpace')) s.alignSpace = a.alignSpace;
  if (changed('block')) s.blockContent = ref(a.block, BlockRecord);
  if (changed('blockColor')) s.blockContentColor = acadColor(a.blockColor);
  if (changed('blockScale'))
    s.blockContentScale = new XYZ(a.blockScale.x, a.blockScale.y, a.blockScale.z);
  if (changed('blockScaleOn')) s.enableBlockContentScale = a.blockScaleOn;
  if (changed('blockRotation')) s.blockContentRotation = a.blockRotation;
  if (changed('blockRotationOn')) s.enableBlockContentRotation = a.blockRotationOn;
  if (changed('blockConnection')) s.blockContentConnection = a.blockConnection;
  if (changed('scale')) s.scaleFactor = a.scale;
  if (changed('overwriteProperties')) s.overwritePropertyValue = a.overwriteProperties;
  if (changed('annotative')) s.isAnnotative = a.annotative;
  if (changed('breakGap')) s.breakGapSize = a.breakGap;
}

/**
 * Writes the planned multileader style changes onto `doc`: renamed styles first, as a new style
 * may take a name one gives up; then new styles join its ACAD_MLEADERSTYLE dictionary (made when
 * the drawing has none, as a new document's root holds one).
 */
export function writeMLeaderStyles(doc: CadDocument, r: Resolver, plan: MLeaderStylePlan): void {
  renameEntries(
    plan.updated
      .filter(({ before, after }) => before.name !== after.name)
      .map(({ acad, after }) => ({ acad, name: after.name })),
  );
  if (plan.added.length > 0) {
    const root = doc.rootDictionary!;
    let dict = root.get(CadDictionary.acadMLeaderStyle);
    if (!(dict instanceof CadDictionary)) {
      dict = new CadDictionary(CadDictionary.acadMLeaderStyle);
      dict.handle = r.allocate();
      root.add(dict as CadDictionary);
    }
    for (const { acad, after } of plan.added) {
      (dict as CadDictionary).add(acad);
      writeMLeaderStyle(r, acad, undefined, after);
    }
  }
  for (const { acad, before, after } of plan.updated) writeMLeaderStyle(r, acad, before, after);
}
