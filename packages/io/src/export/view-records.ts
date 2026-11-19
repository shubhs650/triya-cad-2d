// TriyaToAcad for APPID, UCS, VIEW and VPORT records (M1-75 part 10): writes an edited record's
// changed fields onto its acad-ts original, by handle, and adds the records the drawing gains
// under the engine's handles, the inverse of `ucs()`, `view()` and `vport()` in map/tables.ts.
// They are what the UCS and VIEW commands and VPORTS save (M1-22 VIEW save and restore, M3),
// and the *Active VPORT is where a save keeps the drawing's last view.
//
// What the format saved has no place for is refused before anything changes, so a save never
// drops it silently: an R12 UCS states only its origin and axes, R2000 brought a view's UCS and
// render mode and a VPORT's UCS, and R2007 its grid display flags and major lines (see
// `NOT_STORED`). The checks every table shares are in records.ts.

import {
  ACadVersion,
  AppId,
  CadDictionary,
  DictionaryCloningFlags,
  UCS,
  View,
  VPort,
  XRecord,
  XY,
  XYZ,
  type CadDocument,
  type CadObject,
  type TableEntry,
} from '@node-projects/acad-ts';
import {
  isLayerState,
  type DocumentInit,
  type DocumentModel,
  type Handle,
  type SymbolTableRecord,
  type UcsFrame,
  type UcsRecord,
  type Vec2,
  type Vec3,
  type ViewParams,
  type ViewRecord,
  type VportRecord,
} from '@triya/engine';
import { VIEW_CATEGORY_CODE, VIEW_INFO, VIEW_LAYER_STATE_CODE } from '../map/tables';
import type { Resolver } from './entities';
import { changes, planRecords, XREF_BITS, type RecordPlan } from './records';

type Planner = Resolver & { readonly created: Map<Handle, CadObject> };

/** DXF 71 view mode bits AutoCAD defines (perspective, front/back clip, follow UCS, front clip not at eye). */
const VIEW_MODE_BITS = 1 | 2 | 4 | 8 | 16;
/** DXF 74 UCSICON bits: on, at the origin. */
const UCS_ICON_BITS = 1 | 2;
/** DXF 60 grid display bits: beyond limits, adaptive, subdivide, follow dynamic UCS. */
const GRID_FLAG_BITS = 1 | 2 | 4 | 8;
/** DXF 281 render modes: 2D optimized to Gouraud shaded with edges. */
const MAX_RENDER_MODE = 6;
/** Orthographic types: none, then top, bottom, front, back, left, right. */
const MAX_ORTHOGRAPHIC = 6;
/** VIEWRES (VPORT DXF 72) takes 1–20000. */
const MAX_CIRCLE_ZOOM = 20000;

const finite = (...xs: number[]): boolean => xs.every(Number.isFinite);
const finite2 = (v: Vec2): boolean => finite(v.x, v.y);
const finite3 = (v: Vec3): boolean => finite(v.x, v.y, v.z);
const length3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const xyz = (v: Vec3): XYZ => new XYZ(v.x, v.y, v.z);
const xy = (v: Vec2): XY => new XY(v.x, v.y);

/**
 * The fields each record keeps only from a version on: what an earlier version's DXF groups or
 * DWG object have no place for (AutoCAD DXF reference; ODA spec §20.4.56–20.4.61). An R12 UCS
 * states its origin and axes only.
 */
const NOT_STORED: {
  readonly ucs: readonly [ACadVersion, readonly (keyof UcsRecord)[]][];
  readonly views: readonly [ACadVersion, readonly (keyof ViewRecord)[]][];
  readonly vports: readonly [ACadVersion, readonly (keyof VportRecord)[]][];
} = {
  ucs: [[ACadVersion.AC1015, ['elevation', 'orthographic']]],
  views: [
    // A table record has an extension dictionary from R13 (M2-70's category is kept in one).
    [ACadVersion.AC1012, ['category']],
    [ACadVersion.AC1015, ['ucs', 'renderMode']],
  ],
  vports: [
    [ACadVersion.AC1015, ['ucs', 'renderMode']],
    [ACadVersion.AC1021, ['gridFlags', 'gridMajor']],
  ],
};

function notStored<R>(
  rules: readonly [ACadVersion, readonly (keyof R)[]][],
  version: ACadVersion | undefined,
  changed: (...keys: (keyof R)[]) => boolean,
): string[] {
  if (version === undefined || version === ACadVersion.Unknown) return [];
  const name = ACadVersion[version] ?? String(version);
  const out: string[] = [];
  for (const [since, keys] of rules) {
    if (version >= since) continue;
    for (const k of keys) if (changed(k)) out.push(`${name} does not store its ${String(k)}`);
  }
  return out;
}

/** What AutoCAD's UCS command makes: unit axes at right angles. */
function frameProblems(f: UcsFrame, what = ''): string[] {
  const out: string[] = [];
  if (!finite3(f.origin) || !finite(f.elevation)) out.push(`the ${what}origin is not finite`);
  if (!finite3(f.xAxis) || !finite3(f.yAxis)) out.push(`the ${what}axes are not finite`);
  else {
    const dot = f.xAxis.x * f.yAxis.x + f.xAxis.y * f.yAxis.y + f.xAxis.z * f.yAxis.z;
    if (Math.abs(length3(f.xAxis) - 1) > 1e-9 || Math.abs(length3(f.yAxis) - 1) > 1e-9)
      out.push(`the ${what}axes are not unit vectors`);
    else if (Math.abs(dot) > 1e-9) out.push(`the ${what}axes are not at right angles`);
  }
  if (!Number.isInteger(f.orthographic) || f.orthographic < 0 || f.orthographic > MAX_ORTHOGRAPHIC)
    out.push(`${what}orthographic type ${f.orthographic} is not 0–6`);
  return out;
}

/** What a view needs to be shown: a size, a direction to look along and known modes. */
function viewProblems(
  p: ViewParams,
  changed: (...keys: (keyof ViewParams)[]) => boolean,
): string[] {
  const out: string[] = [];
  if (changed('height') && !(Number.isFinite(p.height) && p.height > 0))
    out.push(`height ${p.height} is not more than 0`);
  if (changed('center') && !finite2(p.center)) out.push('the centre is not finite');
  if (changed('target') && !finite3(p.target)) out.push('the target is not finite');
  if (changed('direction') && !(finite3(p.direction) && length3(p.direction) > 0))
    out.push('the view direction is not a direction');
  if (changed('lensLength') && !(Number.isFinite(p.lensLength) && p.lensLength > 0))
    out.push(`lens length ${p.lensLength} is not more than 0`);
  if (changed('frontClip', 'backClip', 'twist') && !finite(p.frontClip, p.backClip, p.twist))
    out.push('a clip distance or the twist is not finite');
  if (changed('viewMode') && (p.viewMode & ~VIEW_MODE_BITS) !== 0)
    out.push(`view mode ${p.viewMode} has bits AutoCAD does not define`);
  if (
    changed('renderMode') &&
    !(Number.isInteger(p.renderMode) && p.renderMode >= 0 && p.renderMode <= MAX_RENDER_MODE)
  )
    out.push(`render mode ${p.renderMode} is not 0–6`);
  return out;
}

/** The checks every one of these tables makes on its records' flags. */
function flagProblems(b: SymbolTableRecord | undefined, a: SymbolTableRecord): string[] {
  return (((b?.flags ?? 0) ^ (a.flags ?? 0)) & XREF_BITS) !== 0
    ? ['the xref-dependent flags belong to the xref']
    : [];
}

// ── APPID ─────────────────────────────────────────────────────────────────────────────────────

export type AppIdPlan = RecordPlan<AppId, SymbolTableRecord>;

export function planAppIds(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Planner,
): { plan: AppIdPlan; problems: string[] } {
  return planRecords(doc, base.tables?.appIds ?? [], model.tables.appIds, r, {
    what: 'application',
    removable: true,
    type: AppId,
    make: (a) => new AppId(a.name),
    // AutoCAD's own application name, which its xdata (TrueType faces, …) is registered under.
    fixedNames: [AppId.defaultName],
    problems: (b, a) => flagProblems(b, a),
  });
}

function writeAppId(s: AppId, b: SymbolTableRecord | undefined, a: SymbolTableRecord): void {
  const changed = changes(b, a);
  if (b && changed('name')) s.name = a.name;
  if (changed('flags')) s.flags = (a.flags ?? 0) as never;
}

// ── UCS ───────────────────────────────────────────────────────────────────────────────────────

export type UcsPlan = RecordPlan<UCS, UcsRecord>;

export function planUcs(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Planner,
): { plan: UcsPlan; problems: string[] } {
  const version = doc.header?.version;
  return planRecords(doc, base.tables?.ucs ?? [], model.tables.ucs, r, {
    what: 'UCS',
    removable: true,
    type: UCS,
    make: (a) => new UCS(a.name),
    fixedNames: [],
    problems: (b, a) => {
      const changed = changes(b, a);
      return [
        ...flagProblems(b, a),
        ...(changed('origin', 'xAxis', 'yAxis', 'elevation', 'orthographic')
          ? frameProblems(a)
          : []),
        ...notStored(NOT_STORED.ucs, version, changed),
      ];
    },
  });
}

function writeUcs(u: UCS, b: UcsRecord | undefined, a: UcsRecord): void {
  const changed = changes(b, a);
  if (b && changed('name')) u.name = a.name;
  if (changed('flags')) u.flags = (a.flags ?? 0) as never;
  if (changed('origin')) u.origin = xyz(a.origin);
  if (changed('xAxis')) u.xAxis = xyz(a.xAxis);
  if (changed('yAxis')) u.yAxis = xyz(a.yAxis);
  if (changed('elevation')) u.elevation = a.elevation;
  if (changed('orthographic')) u.orthographicType = a.orthographic as never;
}

// ── VIEW ──────────────────────────────────────────────────────────────────────────────────────

export type ViewPlan = RecordPlan<View, ViewRecord>;

export function planViews(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Planner,
): { plan: ViewPlan; problems: string[] } {
  const version = doc.header?.version;
  return planRecords(doc, base.tables?.views ?? [], model.tables.views, r, {
    what: 'view',
    removable: true,
    type: View,
    make: (a) => new View(a.name),
    fixedNames: [],
    problems: (b, a) => {
      const changed = changes(b, a);
      const out = [...flagProblems(b, a), ...viewProblems(a, changed)];
      if (changed('width') && !(Number.isFinite(a.width) && a.width > 0))
        out.push(`width ${a.width} is not more than 0`);
      if (changed('ucs') && a.ucs) out.push(...frameProblems(a.ucs, 'UCS '));
      if (changed('layerState') && a.layerState !== undefined) {
        // Restoring the view restores the state it names: one the drawing has (M5-07 part 7).
        const key = a.layerState.toUpperCase();
        const found = [...model.objects.values()].some(
          (o) => isLayerState(o) && o.name.toUpperCase() === key,
        );
        if (!found) out.push(`its layer snapshot "${a.layerState}" is not a layer state`);
      }
      out.push(...notStored(NOT_STORED.views, version, changed));
      return out;
    },
  });
}

function writeViewParams(
  v: {
    center: XY;
    direction: XYZ;
    target: XYZ;
    lensLength: number;
    viewMode: never;
    renderMode: never;
  },
  changed: (...keys: (keyof ViewParams)[]) => boolean,
  a: ViewParams,
): void {
  if (changed('center')) v.center = xy(a.center);
  if (changed('direction')) v.direction = xyz(a.direction);
  if (changed('target')) v.target = xyz(a.target);
  if (changed('lensLength')) v.lensLength = a.lensLength;
  if (changed('viewMode')) v.viewMode = a.viewMode as never;
  if (changed('renderMode')) v.renderMode = a.renderMode as never;
}

/** What AutoCAD writes as a category when a view has none. */
const NO_CATEGORY = '<None>';

/**
 * Writes a view's category (M2-70) and layer snapshot (M5-07 part 7) into DXF 300 and 302 of the
 * `ADSK_XREC_VTRVIEWINFO` XRECORD in its extension dictionary, the record AutoCAD keeps them in,
 * rewriting only the group that changed where the view has the record (the rest, 330 and 294,
 * stay as read). A view without one is given one holding the two, and its extension dictionary
 * if it has none, numbered above every handle the engine gave out: AutoCAD 2024's DXF reference
 * does not document the record, and its other groups belong to features Triya does not have. A
 * view taken back to no category keeps its record, saying `<None>` as AutoCAD's does; a view
 * whose layer snapshot goes loses its 302; a view with neither stays without.
 */
function writeViewInfo(
  v: View,
  a: ViewRecord,
  changed: { readonly category: boolean; readonly layerState: boolean },
  allocate: () => number,
): void {
  const xdict = v.xDictionary;
  const info = xdict?.getEntry(VIEW_INFO);
  if (info instanceof XRecord) {
    const groups = info.entries.map((e) => ({ code: e.code, value: e.value as unknown }));
    if (changed.category) {
      const value = a.category ?? NO_CATEGORY;
      const at = groups.findIndex((e) => e.code === VIEW_CATEGORY_CODE);
      if (at >= 0) groups[at] = { code: VIEW_CATEGORY_CODE, value };
      else groups.unshift({ code: VIEW_CATEGORY_CODE, value });
    }
    if (changed.layerState) {
      const at = groups.findIndex((e) => e.code === VIEW_LAYER_STATE_CODE);
      if (a.layerState === undefined) {
        if (at >= 0) groups.splice(at, 1);
      } else if (at >= 0) groups[at] = { code: VIEW_LAYER_STATE_CODE, value: a.layerState };
      else {
        // Where AutoCAD writes it: after the category.
        const after = groups.findIndex((e) => e.code === VIEW_CATEGORY_CODE) + 1;
        groups.splice(after, 0, { code: VIEW_LAYER_STATE_CODE, value: a.layerState });
      }
    }
    info.clear();
    for (const g of groups) info.createEntry(g.code, g.value);
    return;
  }
  if (a.category === undefined && a.layerState === undefined) return;
  let dict = xdict;
  if (!dict) {
    // As AutoCAD makes a record's extension dictionary: hard owner (280 = 1), keep existing (281 = 1).
    dict = new CadDictionary();
    dict.handle = allocate();
    dict.hardOwnerFlag = true;
    dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
  }
  const x = new XRecord();
  x.handle = allocate();
  x.cloningFlags = DictionaryCloningFlags.KeepExisting;
  // AutoCAD writes the category, `<None>` for none, before the layer snapshot.
  x.createEntry(VIEW_CATEGORY_CODE, a.category ?? NO_CATEGORY);
  if (a.layerState !== undefined) x.createEntry(VIEW_LAYER_STATE_CODE, a.layerState);
  dict.addByKey(VIEW_INFO, x);
  x.addReactor(dict);
  // Joining the view last registers the dictionary and what it holds with the drawing.
  if (!xdict) v.xDictionary = dict;
}

function writeView(
  v: View,
  b: ViewRecord | undefined,
  a: ViewRecord,
  allocate: () => number,
): void {
  const changed = changes(b, a);
  if (b && changed('name')) v.name = a.name;
  if (changed('flags')) v.flags = (a.flags ?? 0) as never;
  writeViewParams(v as never, changed, a);
  if (changed('height')) v.height = a.height;
  if (changed('width')) v.width = a.width;
  if (changed('frontClip')) v.frontClipping = a.frontClip;
  if (changed('backClip')) v.backClipping = a.backClip;
  if (changed('twist')) v.angle = a.twist;
  if (changed('ucs')) {
    v.isUcsAssociated = a.ucs !== undefined;
    if (a.ucs) {
      v.ucsOrigin = xyz(a.ucs.origin);
      v.ucsXAxis = xyz(a.ucs.xAxis);
      v.ucsYAxis = xyz(a.ucs.yAxis);
      v.ucsElevation = a.ucs.elevation;
      v.ucsOrthographicType = a.ucs.orthographic as never;
    }
  }
  const info = { category: changed('category'), layerState: changed('layerState') };
  if (info.category || info.layerState) writeViewInfo(v, a, info, allocate);
}

// ── VPORT ─────────────────────────────────────────────────────────────────────────────────────

export type VportPlan = RecordPlan<VPort, VportRecord>;

export function planVports(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Planner,
): { plan: VportPlan; problems: string[] } {
  const version = doc.header?.version;
  return planRecords(doc, base.tables?.vports ?? [], model.tables.vports, r, {
    what: 'viewport',
    type: VPort,
    make: (a) => new VPort(a.name),
    // AutoCAD's tiled viewports are all *Active, and a saved configuration's tiles share its name.
    namesRepeat: true,
    fixedNames: [VPort.defaultName],
    removable: true,
    problems: (b, a) => {
      const changed = changes(b, a);
      const out = [...flagProblems(b, a), ...viewProblems(a, changed)];
      if (changed('lowerLeft', 'upperRight')) {
        const { lowerLeft: ll, upperRight: ur } = a;
        const inside = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1;
        if (![ll.x, ll.y, ur.x, ur.y].every(inside) || !(ll.x < ur.x && ll.y < ur.y))
          out.push('its corners are not a rectangle within 0–1 of the screen');
      }
      if (changed('aspectRatio') && !(Number.isFinite(a.aspectRatio) && a.aspectRatio > 0))
        out.push(`aspect ratio ${a.aspectRatio} is not more than 0`);
      if (changed('snapBase', 'snapRotation') && !(finite2(a.snapBase) && finite(a.snapRotation)))
        out.push('the snap base or rotation is not finite');
      const spacing = (v: Vec2): boolean => finite2(v) && v.x >= 0 && v.y >= 0;
      if (changed('snapSpacing') && !spacing(a.snapSpacing)) out.push('snap spacing is negative');
      if (changed('gridSpacing') && !spacing(a.gridSpacing)) out.push('grid spacing is negative');
      if (changed('isometricPlane') && ![0, 1, 2].includes(a.isometricPlane))
        out.push(`isometric plane ${a.isometricPlane} is not 0–2`);
      if (changed('gridFlags') && (a.gridFlags & ~GRID_FLAG_BITS) !== 0)
        out.push(`grid flags ${a.gridFlags} have bits AutoCAD does not define`);
      if (
        changed('gridMajor') &&
        !(Number.isInteger(a.gridMajor) && a.gridMajor >= 1 && a.gridMajor <= 100)
      )
        out.push(`major grid line every ${a.gridMajor} is not 1–100`);
      if (
        changed('circleZoom') &&
        !(Number.isInteger(a.circleZoom) && a.circleZoom >= 1 && a.circleZoom <= MAX_CIRCLE_ZOOM)
      )
        out.push(`circle zoom ${a.circleZoom} is not 1–20000`);
      if (changed('ucsIcon') && (a.ucsIcon & ~UCS_ICON_BITS) !== 0)
        out.push(`UCS icon flags ${a.ucsIcon} are not on (1) and at origin (2)`);
      if (changed('ucs')) out.push(...frameProblems(a.ucs, 'UCS '));
      out.push(...notStored(NOT_STORED.vports, version, changed));
      return out;
    },
  });
}

function writeVport(p: VPort, b: VportRecord | undefined, a: VportRecord): void {
  const changed = changes(b, a);
  if (b && changed('name')) p.name = a.name;
  if (changed('flags')) p.flags = (a.flags ?? 0) as never;
  writeViewParams(p as never, changed, a);
  if (changed('height')) p.viewHeight = a.height;
  if (changed('frontClip')) p.frontClippingPlane = a.frontClip;
  if (changed('backClip')) p.backClippingPlane = a.backClip;
  if (changed('twist')) p.twistAngle = a.twist;
  if (changed('lowerLeft')) p.bottomLeft = xy(a.lowerLeft);
  if (changed('upperRight')) p.topRight = xy(a.upperRight);
  if (changed('aspectRatio')) p.aspectRatio = a.aspectRatio;
  if (changed('snapBase')) p.snapBasePoint = xy(a.snapBase);
  if (changed('snapSpacing')) p.snapSpacing = xy(a.snapSpacing);
  if (changed('snapRotation')) p.snapRotation = a.snapRotation;
  if (changed('snapOn')) p.snapOn = a.snapOn;
  if (changed('isometricSnap')) p.isometricSnap = a.isometricSnap;
  if (changed('isometricPlane')) p.snapIsoPair = a.isometricPlane;
  if (changed('gridSpacing')) p.gridSpacing = xy(a.gridSpacing);
  if (changed('gridOn')) p.showGrid = a.gridOn;
  if (changed('gridFlags')) p.gridFlags = a.gridFlags as never;
  if (changed('gridMajor')) p.minorGridLinesPerMajorGridLine = a.gridMajor;
  if (changed('circleZoom')) p.circleZoomPercent = a.circleZoom;
  if (changed('ucsIcon')) p.ucsIconDisplay = a.ucsIcon as never;
  if (changed('ucs')) {
    p.origin = xyz(a.ucs.origin);
    p.xAxis = xyz(a.ucs.xAxis);
    p.yAxis = xyz(a.ucs.yAxis);
    p.elevation = a.ucs.elevation;
    p.orthographicType = a.ucs.orthographic as never;
  }
}

// ── Writing ───────────────────────────────────────────────────────────────────────────────────

export interface ViewRecordPlans {
  readonly appIds: AppIdPlan;
  readonly ucs: UcsPlan;
  readonly views: ViewPlan;
  readonly vports: VportPlan;
}

function apply<A extends TableEntry, R>(
  table: { add(a: A): void } | null | undefined,
  plan: RecordPlan<A, R & SymbolTableRecord>,
  write: (a: A, b: R | undefined, after: R) => void,
): void {
  for (const { acad, after } of plan.added) {
    // acad-ts keeps a non-zero handle it has not seen, so the record keeps Triya's handle.
    table!.add(acad);
    write(acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) write(acad, before, after);
}

/**
 * Writes the planned APPID, UCS, VIEW and VPORT changes onto `doc`; `allocate` numbers the objects
 * a view's category needs (M2-70).
 */
export function writeViewRecords(
  doc: CadDocument,
  plans: ViewRecordPlans,
  allocate: () => number,
): void {
  apply(doc.appIds, plans.appIds, writeAppId);
  apply(doc.uCSs, plans.ucs, writeUcs);
  apply(doc.views, plans.views, (v, b, a) => writeView(v, b, a, allocate));
  apply(doc.vPorts, plans.vports, writeVport);
}
