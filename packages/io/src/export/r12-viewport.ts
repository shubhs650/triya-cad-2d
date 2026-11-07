// An R12 viewport (M1-86). DXF R12 states only a viewport's frame, status and ID as groups (10,
// 40, 41, 68, 69); its view, snap, grid and frozen layers are the ACAD xdata after the string
// MVIEW (DXF R12 reference, VIEWPORT). acad-ts reads that xdata into the viewport (patches 0119
// and 0135, M1-90) and writes it back as read, so a save that changes the view or the frozen
// layers rewrites it here, after the viewport writer has set the acad-ts properties. Everything the MVIEW states but Triya does
// not map (its version, circle zoom, snap and grid settings) is written from the properties
// acad-ts read it into, so it comes back as it was.

import {
  AppId,
  ExtendedDataControlString,
  ExtendedDataCoordinate,
  ExtendedDataInteger16,
  ExtendedDataLayer,
  ExtendedDataReal,
  ExtendedDataString,
  ViewportStatusFlags as F,
  XYZ,
  type CadDocument,
  type ExtendedDataRecord,
  type Viewport,
} from '@node-projects/acad-ts';
import type { ViewportGeometry } from '@triya/engine';
import { same } from './entities';

/** The fields R12 states in the MVIEW xdata, which `writeR12View` writes. */
export const R12_MVIEW_FIELDS = [
  'viewCenter',
  'viewHeight',
  'viewDirection',
  'viewTarget',
  'twist',
  'lensLength',
  'frontClip',
  'backClip',
  'flags',
  'frozenLayers',
] as const;

/** VIEWMODE: perspective, front and back clipping, UCS follow, front clip not at the eye. */
const VIEW_MODE = 0x1f;

/** The status flags an R12 viewport can state: VIEWMODE, the MVIEW 1070s and status 68 = 0. */
const R12_FLAGS =
  VIEW_MODE |
  F.UcsIconVisibility |
  F.UcsIconAtOrigin |
  F.FastZoom |
  F.SnapMode |
  F.GridMode |
  F.IsometricSnapStyle |
  F.HidePlotMode |
  F.IsoPairTop |
  F.IsoPairRight |
  F.ViewportOff;

/** The R2000 settings R12 has no place for, by the name a refusal gives them. */
const R2000_FIELDS = [
  ['plotStyleSheet', 'plot style table'],
  ['renderMode', 'render mode'],
  ['visualStyle', 'visual style'],
] as const;

/** What a new viewport is compared with: the settings R12 cannot state, unset. */
const EMPTY: Partial<ViewportGeometry> = { plotStyleSheet: '', renderMode: 0 };

/** The MVIEW group of an R12 viewport's ACAD xdata: its records and where its braces are. */
function mview(v: Viewport): { records: ExtendedDataRecord[]; open: number; close: number } | null {
  for (const [app, data] of v.extendedData) {
    if (app.name.toUpperCase() !== 'ACAD') continue;
    const records = data.records;
    const at = records.findIndex(
      (r) => r instanceof ExtendedDataString && r.value.toUpperCase() === 'MVIEW',
    );
    const open = at + 1;
    const first = records[open];
    if (at < 0 || !(first instanceof ExtendedDataControlString) || first.isClosing) return null;
    let depth = 0;
    for (let i = open; i < records.length; i++) {
      const r = records[i];
      if (r instanceof ExtendedDataControlString) depth += r.isClosing ? -1 : 1;
      if (depth === 0) return { records, open, close: i };
    }
    return null;
  }
  return null;
}

/**
 * Why the change from `before` to `after` of an R12 viewport (`v`, as read) cannot be saved;
 * `before` undefined is a new viewport, which goes into paper space by its 67 = 1 (acad-ts
 * patch 0134, M1-89) with the MVIEW xdata `addR12View` gives it.
 */
export function r12ViewportProblems(
  v: Viewport | undefined,
  before: ViewportGeometry | undefined,
  after: ViewportGeometry,
): string[] {
  const out: string[] = [];
  // A new viewport is held to an empty one: it may set nothing R12 has no place for.
  const d = (k: keyof ViewportGeometry): boolean => !same((before ?? EMPTY)[k], after[k]);
  if (!before && after.clipBoundary !== undefined) out.push('R12 has no viewport clip boundary');
  for (const [k, name] of R2000_FIELDS) if (d(k)) out.push(`R12 has no ${name}`);
  if (d('flags')) {
    const lost = after.flags & ~R12_FLAGS;
    if (lost) out.push(`R12 has no place for viewport flags 0x${lost.toString(16)}`);
    if (after.flags & F.IsoPairTop && after.flags & F.IsoPairRight) {
      out.push('both isometric planes at once');
    }
  }
  // R12 has no 90 flags: status (68) 0 is how it says a viewport is off, and acad-ts reads it so.
  if (
    (d('flags') || d('status')) &&
    (after.status === 0) !== Boolean(after.flags & F.ViewportOff)
  ) {
    out.push('R12 says a viewport is off only by status 0, and status 0 is always off');
  }
  // A new viewport gets its MVIEW xdata from `addR12View`.
  if (before && v && R12_MVIEW_FIELDS.some(d) && !mview(v)) {
    out.push('no MVIEW xdata to hold its view and frozen layers');
  }
  return out;
}

/** Whether the change from `before` to `after` is one `writeR12View` writes. */
export function r12ViewChanges(before: ViewportGeometry, after: ViewportGeometry): boolean {
  return R12_MVIEW_FIELDS.some((k) => !same(before[k], after[k]));
}

/**
 * Rewrites the MVIEW xdata of an R12 viewport from its acad-ts properties, the inverse of
 * patch 0119's reader: version, target, direction, twist, view height, view centre X and Y,
 * lens length, front and back clip; VIEWMODE, circle zoom, fast zoom, UCSICON, snap, grid,
 * snap style and isopair; snap angle, snap base X/Y, snap spacing X/Y, grid spacing X/Y; and
 * hidden in plot; then the nested group of frozen layers, a 1003 name each (the DXF writer
 * writes an `ExtendedDataLayer` by its layer's name).
 */
export function writeR12View(v: Viewport): void {
  const g = mview(v)!;
  const inside = g.records.slice(g.open + 1, g.close);
  const version = inside.find((r) => r instanceof ExtendedDataInteger16)?.value as number;
  const s = v.status;
  const on = (flag: F): number => (s & flag ? 1 : 0);
  const point = (p: XYZ): ExtendedDataCoordinate =>
    new ExtendedDataCoordinate(new XYZ(p.x, p.y, p.z));
  const real = (x: number): ExtendedDataReal => new ExtendedDataReal(x);
  const int = (x: number): ExtendedDataInteger16 => new ExtendedDataInteger16(x);
  const view: ExtendedDataRecord[] = [
    int(version ?? 16),
    point(v.viewTarget),
    point(v.viewDirection),
    // xdata reals are stored as they are in memory, so the angles are in radians.
    ...[v.twistAngle, v.viewHeight, v.viewCenter.x, v.viewCenter.y].map(real),
    ...[v.lensLength, v.frontClipPlane, v.backClipPlane].map(real),
    int(s & VIEW_MODE),
    int(v.circleZoomPercent),
    int(on(F.FastZoom)),
    // UCSICON: bit 1 on, bit 2 at the origin.
    int(on(F.UcsIconVisibility) | (on(F.UcsIconAtOrigin) << 1)),
    int(on(F.SnapMode)),
    int(on(F.GridMode)),
    int(on(F.IsometricSnapStyle)),
    // SNAPISOPAIR: 0 left, 1 top, 2 right.
    int(s & F.IsoPairRight ? 2 : on(F.IsoPairTop)),
    real(v.snapAngle),
    ...[v.snapBase, v.snapSpacing, v.gridSpacing].flatMap((p) => [real(p.x), real(p.y)]),
    int(on(F.HidePlotMode)),
  ];
  const frozen: ExtendedDataRecord[] = [
    new ExtendedDataControlString(false),
    ...v.frozenLayers.map((l) => new ExtendedDataLayer(l.handle)),
    new ExtendedDataControlString(true),
  ];
  g.records.splice(g.open + 1, g.close - g.open - 1, ...view, ...frozen);
}

/**
 * Gives a new R12 viewport the ACAD MVIEW xdata that holds its view and frozen layers (version
 * 16, as AutoCAD R12 writes it), then writes them into it.
 */
export function addR12View(doc: CadDocument, v: Viewport): void {
  let app = doc.appIds?.tryGetValue('ACAD') ?? null;
  if (!app) {
    app = new AppId('ACAD');
    doc.appIds!.add(app);
  }
  v.extendedData.addWithRecords(app, [
    new ExtendedDataString('MVIEW'),
    new ExtendedDataControlString(false),
    new ExtendedDataInteger16(16),
    new ExtendedDataControlString(false),
    new ExtendedDataControlString(true),
    new ExtendedDataControlString(true),
  ]);
  writeR12View(v);
}
