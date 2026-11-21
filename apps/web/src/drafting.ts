// The status bar's drafting aids (M2-04): OSNAP (F3), GRID (F7), ORTHO (F8), SNAP (F9), POLAR
// (F10) and OTRACK (F11), with the running object snap modes (OSMODE), and the display toggles
// LWT and TPY. AutoCAD keeps OSMODE, AUTOSNAP and the polar settings per user (registry) and
// ORTHOMODE, SNAPMODE, GRIDMODE and LWDISPLAY in each drawing. Triya starts from AutoCAD's
// initial values (OSNAP on with Endpoint, Center, Intersection and Extension, POLAR on at 90°,
// OTRACK and TPY on, ORTHO and SNAP off) and keeps the per-user ones between sessions (M2-20,
// preferences.ts), the others per session. GRID starts off for a drawing with no viewport to
// keep it in (see part 19 below); LWT shows each drawing's own LWDISPLAY until the drafter turns
// it, and is then the same for every drawing. Nothing is written back to the file. The snap and grid spacing are
// each drawing's own (its *Active VPORT's SNAPUNIT and GRIDUNIT), read by the canvas. SNAP and
// GRID are the viewport worked in's (M6-02 part 19; AutoCAD keeps SNAPMODE and GRIDMODE in each
// viewport): the shown canvas tells them (`setViewportModes`) and F9, F7, the buttons and the
// Drafting Settings turn them there, a drawing edit; a drawing with no viewport to keep them in
// has the session's own, as before.
import { GRIP_COLORS_DEFAULT, type GripColors } from '@triya/render';
import { DEFAULT_TOOLTIP, type TooltipAppearance } from './tooltip-appearance';
import {
  GRID_DISPLAY,
  OSMODE_DEFAULT,
  OSNAP,
  OSNAP_OFF,
  type Box,
  type OsnapMode,
} from '@triya/engine';

export interface DraftingState {
  /** OSMODE: the running object snap modes, with OSNAP_OFF set while F3 has them off. */
  readonly osmode: number;
  readonly ortho: boolean;
  readonly polar: boolean;
  /** POLARANG, degrees. */
  readonly polarAngle: number;
  readonly snap: boolean;
  /** Object snap tracking (AUTOSNAP bit 16). */
  readonly otrack: boolean;
  /** GRIDMODE. */
  readonly grid: boolean;
  /** LWDISPLAY as the drafter set it; undefined follows each drawing's own. */
  readonly lwt: boolean | undefined;
  /** TRANSPARENCYDISPLAY. */
  readonly tpy: boolean;
  /**
   * ANNOALLVISIBLE (M6-03): every annotative object shown (AutoCAD's initial 1), or on the Model
   * tab only those supporting the current annotation scale. AutoCAD saves it in the drawing, but
   * no DXF says where, so Triya keeps it per session; the status bar's Annotation Visibility.
   */
  readonly annoAllVisible: boolean;
  /**
   * ANNOAUTOSCALE (M6-03): −4 to 4 but 0, AutoCAD's initial −4; positive is on, the status bar's
   * AutoScale, turned by its sign. AutoCAD keeps it per user. While on, AutoCAD adds a new
   * annotation scale to annotative objects; Triya never does (DEC-013) and says so.
   */
  readonly annoAutoScale: number;
  /** AUTOSNAPSIZE: half the AutoSnap marker's size, CSS pixels (M2-20). */
  readonly markerSize: number;
  /** APERTURE: how near an object must be to the cursor to be snapped to, CSS pixels. */
  readonly aperture: number;
  /**
   * PDFOSNAP: running object snaps snap to PDF underlays' geometry (M2-22). AutoCAD keeps it
   * per user, initially on.
   */
  readonly pdfOsnap: boolean;
  /**
   * REVCLOUDGRIPS (M2-42): a revision cloud shows its corners as grips (AutoCAD 2021+'s initial
   * 1), or a grip at every arc's end (0). AutoCAD keeps it per user; each drawing's engine is
   * told it (a header entry never saved), as its grips are worked out there.
   */
  readonly revcloudGrips: boolean;
  /**
   * LAYEREVALCTL (M5-19 part 3): new layers are evaluated as each drawing's LAYEREVAL says (1,
   * AutoCAD's initial value), or not at all (0), and the Layer Properties Manager shows no
   * Unreconciled New Layers. AutoCAD keeps it per user; each drawing's engine is told it.
   */
  readonly layerEvalCtl: boolean;
  /**
   * QPMODE (M2-35 part 16): Quick Properties shows for a selection while it is above 0, for all
   * objects (1) or only those with quick properties of their own (2). AutoCAD keeps it per user,
   * initially −1: a negative value is off and keeps the mode the QP button turns back on.
   */
  readonly qpmode: number;
  /** QPLOCATION: Quick Properties by the cursor (0) or where it was dragged (1). */
  readonly qpLocation: 0 | 1;
  /**
   * AUTOSNAP's bits other than POLAR (8) and OTRACK (16), M2-59: `AUTOSNAP_MARKER`,
   * `AUTOSNAP_TIP`, `AUTOSNAP_MAGNET` and `AUTOSNAP_TRACK_TIP`, all on in AutoCAD's initial 63.
   */
  readonly autosnap: number;
  /**
   * PICKFIRST (M2-59): objects picked at `Command:` are what the next command takes. AutoCAD
   * keeps it per user, initially on; each drawing's command line is told it.
   */
  readonly pickfirst: boolean;
  /**
   * GRIPSIZE (M2-59 part 3): the grip box's size in AutoCAD's pixels, 1 to 255, initially 5.
   * AutoCAD keeps it per user; the canvas draws grips at it and picks them within it.
   */
  readonly gripSize: number;
  /**
   * GRIPCOLOR, GRIPHOVER, GRIPHOT and GRIPCONTOUR (M3-05 part 5): the grips' colours, ACIs 1 to
   * 255, initially 150, 11, 12 and 251. AutoCAD keeps them per user; Settings' Grip Colors.
   */
  readonly gripColors: GripColors;
  /**
   * ROLLOVERTIPS (M2-35 part 21): the object under a resting cursor shows a tooltip with its
   * properties. AutoCAD keeps it per user, initially on.
   */
  readonly rolloverTips: boolean;
  /**
   * ARRAYASSOCIATIVITY (M3-11): ARRAY makes associative arrays. AutoCAD keeps it per user,
   * initially on; ARRAY's ASsociative option sets it.
   */
  readonly arrayAssociativity: boolean;
  /**
   * FIELDDISPLAY (M4-10 part 3): fields shown on a grey background, which never plots. AutoCAD
   * keeps it per user, initially on.
   */
  readonly fieldDisplay: boolean;
  /**
   * LAYLOCKFADECTL (M5-06): objects on locked layers drawn faded by this percentage, −90 to 90
   * (negative: not faded). AutoCAD keeps it per user, initially 50; LAYISO sets it.
   */
  readonly layLockFade: number;
  /**
   * XFADECTL (M5-02 part 5): while a reference is edited in place, objects not in the working set
   * drawn faded by this percentage, 0 to 90 (0: not faded). AutoCAD keeps it per user, initially 50.
   */
  readonly xFade: number;
  /**
   * PLOTTRANSPARENCYOVERRIDE (M6-04 part 2): 0 plots no object transparency, 1 (initially) as the
   * page setup or the Plot dialog says, 2 always. AutoCAD keeps it per user.
   */
  readonly plotTransparencyOverride: 0 | 1 | 2;
  /**
   * LAYOUTCREATEVIEWPORT (M6-06): a new layout gets a viewport the first time it is shown
   * (initially). AutoCAD keeps it per user; Settings' "Create viewport in new layouts".
   */
  readonly layoutCreateViewport: boolean;
  /**
   * SHOWPAGESETUPFORNEWLAYOUTS (M6-06): the Page Setup Manager opens on a new layout first shown
   * (initially not). AutoCAD keeps it per user; the manager's "Display when creating a new layout".
   */
  readonly showPageSetupForNewLayouts: boolean;
  /**
   * LWDEFAULT (M5-08 part 3): what a Default lineweight draws as, hundredths of a millimetre, one
   * of AutoCAD's lineweights. AutoCAD keeps it per user, initially 25; Lineweight Settings sets it.
   */
  readonly lwDefault: number;
  /** LWUNITS: lineweights listed in millimetres (1, AutoCAD's initial value) or inches (0). */
  readonly lwUnits: 0 | 1;
  /**
   * Lineweight Settings' Adjust Display Scale (M5-08 part 3): the Model tab's lineweight widths
   * multiplied by it, `LWSCALE_RANGE`, initially 1. AutoCAD keeps its slider per user and names
   * no system variable for it.
   */
  readonly lwScale: number;
  /**
   * BINDTYPE (M5-04 part 2): how -XREF Bind binds, 0 Bind or 1 Insert. AutoCAD saves it nowhere
   * ("Not-saved"), initially 0, so neither do the preferences.
   */
  readonly bindType: 0 | 1;
  /**
   * POLARMODE (M3-06 part 1): bits 1 polar angles relative to the last segment, 2 object snap
   * tracking along the polar angles, 4 the additional angles, 8 Shift to acquire tracking
   * points. AutoCAD keeps it per user, initially 0. Bits 1 and 8 act since part 3.
   */
  readonly polarMode: number;
  /**
   * POLARADDANG: the additional polar tracking angles, degrees, as AutoCAD keeps them (up to
   * 10, separated by semicolons; initially ""). Tracked while POLARMODE has bit 4.
   */
  readonly polarAddAngles: string;
  /**
   * SNAPTYPE (M3-06 part 3): SNAP snaps to the grid (0) or along tracking paths by the PolarSnap
   * distance (1, PolarSnap). AutoCAD keeps it per user, initially 0.
   */
  readonly snapType: 0 | 1;
  /** POLARDIST: PolarSnap's distance, 0 for the snap X spacing. Per user, initially 0. */
  readonly polarDist: number;
  /**
   * GRIDSTYLE (M3-06 part 6): the grid is dotted in 2D model space (1), the block editor (2,
   * kept: Triya has none) and on layouts (4), else lines. Initially 0. DXF has no place for it,
   * so Triya keeps it per user.
   */
  readonly gridStyle: number;
  /**
   * TEMPOVERRIDES (M3-06 part 5): the temporary override keys (Shift for ORTHO, Shift+E for
   * Endpoint…, `temp-overrides.ts`) act. AutoCAD keeps it per user, initially on.
   */
  readonly tempOverrides: boolean;
  /**
   * The Drafting Settings dialog's Dynamic Input tab (M3-06 part 4), kept per user as AutoCAD
   * keeps them: DYNMODE's bits (1 pointer input, 2 dimension input; initially 3), which F12
   * turns on and off as a whole (`DynMode`); DYNPROMPT, the prompt at the cursor (initially on);
   * DYNPICOORDS, pointer input's next points relative (0, initially) or absolute (1); and
   * DYNPIFORMAT, their format polar (0, initially) or Cartesian (1).
   */
  readonly dynBits: number;
  readonly dynPrompt: boolean;
  readonly dynPiCoords: 0 | 1;
  readonly dynPiFormat: 0 | 1;
  /**
   * The rest of the Dynamic Input tab (M3-06 part 8), per user as AutoCAD keeps them: DYNPIVIS,
   * when pointer input shows (0 once typed in, 1 at a prompt for a point, initially, 2 always);
   * DYNDIVIS, how many dimension input fields grip stretching shows (0 one, 1 two, initially,
   * 2 those DYNDIGRIP's bits name, initially 31); DYNINFOTIPS, the tips for Shift and Ctrl
   * (initially on); and the Drafting Tooltip Appearance (`tooltip-appearance.ts`).
   */
  readonly dynPiVis: 0 | 1 | 2;
  readonly dynDiVis: 0 | 1 | 2;
  readonly dynDiGrip: number;
  readonly dynInfoTips: boolean;
  readonly tooltip: TooltipAppearance;
  /**
   * SELECTSIMILARMODE (M3-04 part 3): the properties SELECTSIMILAR matches, AutoCAD's bits (1
   * Color, 2 Layer, 4 Linetype, 8 Linetype scale, 16 Lineweight, 32 Plot style, 64 Object
   * style, 128 Name). AutoCAD keeps it per user, initially 130.
   */
  readonly selectSimilarMode: number;
  /**
   * SELECTIONCYCLING (M3-04 part 3): 0 off, 1 a badge, 2 the badge and the Selection list; a
   * negative value is off keeping what Ctrl+W turns back on. AutoCAD keeps it per user,
   * initially 0.
   */
  readonly selectionCycling: number;
  /**
   * PICKSTYLE (M3-08): bit 1 group selection, bit 2 associative hatch selection. AutoCAD keeps
   * it per user, initially 1; Ctrl+Shift+A turns group selection on and off.
   */
  readonly pickStyle: number;
  /**
   * GROUPDISPLAYMODE (M3-13): a group selected whole shows 0 its objects' grips, 1 one grip at
   * its centre, 2 that grip and its bounding box. AutoCAD keeps it per user, initially 2; the
   * Group Bounding Box toggle switches 2 and 1.
   */
  readonly groupDisplayMode: number;
  /**
   * M3-04 part 4 (AutoCAD 2024 Help), kept per user: PICKBOX the pickbox's half size in pixels
   * (0 to 50, initially 3); PICKADD whether a selection step adds to the set (1, 2) or replaces
   * it (0, 3; initially 2); PICKAUTO's bits 1 implied windowing at "Select objects", 2 a window
   * dragged from an object at `Command:` (not yet acted on), 4 a lasso (initially 5).
   */
  readonly pickbox: number;
  readonly pickadd: number;
  readonly pickauto: number;
  /**
   * M3-04 part 5 (AutoCAD 2024 Help), kept per user and initially 3: SELECTIONPREVIEW's bits 1
   * the hover highlight at `Command:`, 2 at a command's object selection; PREVIEWFILTER's bits
   * leave out of it objects on locked layers (1), in xrefs (2), tables (4), multiline text (8),
   * hatches (16) and objects in groups (32).
   */
  readonly selectionPreview: number;
  readonly previewFilter: number;
  /**
   * SELECTIONPREVIEWLIMIT (M3-04 part 6; AutoCAD 2024 Help, "Saved in: Registry", initially
   * 20000): a selection window or lasso being dragged that would take more objects than this
   * previews none.
   */
  readonly selectionPreviewLimit: number;
  /**
   * COMMANDPREVIEW (M3-12 part 6; AutoCAD 2024 Help, "Saved in: Registry", initially 1): 1 shows
   * what TRIM, EXTEND, FILLET, CHAMFER, LENGTHEN, BREAK and OFFSET would do before the pick.
   */
  readonly commandPreview: number;
  /**
   * The Drafting Settings dialog's Quick Properties tab (AutoCAD 2024 Help, "Quick Properties
   * Tab (Drafting Settings Dialog Box)"), kept per user: by the cursor, the quadrant and the
   * distance in pixels it goes at; whether it collapses, and to how many rows.
   */
  readonly qpQuadrant: QpQuadrant;
  readonly qpDistance: number;
  readonly qpCollapse: boolean;
  readonly qpRows: number;
  /**
   * The Drafting Settings dialog's Selection Cycling tab (M3-04 part 7; AutoCAD 2024 Help,
   * "Selection Cycling Tab (Drafting Settings Dialog Box)"), kept per user: where the Selection
   * list opens, by the cursor (0: its Quadrant, Distance in pixels away) or Static (1: where it
   * was dragged), and whether it shows its title bar.
   */
  readonly scLocation: 0 | 1;
  readonly scQuadrant: QpQuadrant;
  readonly scDistance: number;
  readonly scTitleBar: boolean;
  /**
   * The modify commands' options AutoCAD keeps per user (M3-12, `MODIFY_OPTIONS`): OFFSETERASE,
   * OFFSETGAPTYPE, TRIMEXTENDMODE, EDGEMODE, PROJMODE, TRIMMODE, PEDITACCEPT, TEXTALIGNMODE,
   * TEXTALIGNSPACING and HPDLGMODE, by name.
   */
  readonly modifyOptions: Readonly<Record<string, number>>;
  /** OFFSETDIST and CHAMMODE, AutoCAD's unsaved variables: kept while the app runs, never stored. */
  readonly sessionOptions: Readonly<Record<string, number>>;
}

/**
 * M3-12 (AutoCAD 2024 Help for each): the modify commands' options AutoCAD keeps per user (Saved
 * in: Registry), their initial values and highest values (each starts at 0). OFFSET, TRIM, EXTEND,
 * FILLET, CHAMFER and PEDIT read them as they start and set them when their options change.
 */
/** Adjust Display Scale's slider: Min to Max, in steps (M5-08 part 3). */
export const LWSCALE_RANGE = { min: 0.25, max: 3, step: 0.25 } as const;

export const MODIFY_OPTIONS: Readonly<Record<string, { initial: number; max: number }>> = {
  OFFSETERASE: { initial: 0, max: 1 },
  OFFSETGAPTYPE: { initial: 0, max: 2 },
  TRIMEXTENDMODE: { initial: 1, max: 1 },
  EDGEMODE: { initial: 0, max: 1 },
  PROJMODE: { initial: 1, max: 2 },
  TRIMMODE: { initial: 1, max: 1 },
  PEDITACCEPT: { initial: 0, max: 1 },
  // M4-09 part 3: TEXTALIGN's alignment point (Left) and spacing (Current vertical).
  TEXTALIGNMODE: { initial: 9, max: 11 },
  TEXTALIGNSPACING: { initial: 2, max: 3 },
  // M4-07 part 5: HPDLGMODE, the hatch dialogs shown when the ribbon is closed (Triya's always is).
  HPDLGMODE: { initial: 2, max: 2 },
};

/** The initial values of `MODIFY_OPTIONS`. */
export const INITIAL_MODIFY_OPTIONS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(MODIFY_OPTIONS).map(([name, o]) => [name, o.initial]),
);

/**
 * OFFSETDIST −1 (Through), CHAMMODE 0 (two distances) and AFLAGS 16 (ATTDEF's Lock position,
 * M5-03 part 3), AutoCAD's initial values.
 */
export const INITIAL_SESSION_OPTIONS: Readonly<Record<string, number>> = {
  OFFSETDIST: -1,
  CHAMMODE: 0,
  AFLAGS: 16,
};

/** Quick Properties' Quadrant, as the Drafting Settings dialog lists them. */
export type QpQuadrant = 'top-right' | 'top-left' | 'bottom-left' | 'bottom-right';
export const QP_QUADRANTS: readonly { value: QpQuadrant; label: string }[] = [
  { value: 'top-right', label: 'Top-right' },
  { value: 'top-left', label: 'Top-left' },
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
];
/** Distance in Pixels' and Minimum Number of Rows' ranges. */
export const QP_DISTANCES = { min: 0, max: 400 } as const;
export const QP_ROW_COUNTS = { min: 1, max: 30 } as const;

/** POLARMODE 1: polar angles count from the last segment drawn. */
export const POLARMODE_RELATIVE = 1;
/** POLARMODE 2: object snap tracking follows the polar angles, not only horizontal and vertical. */
export const POLARMODE_TRACK_POLAR = 2;
/** POLARMODE 4: the additional angles (POLARADDANG) are tracked too. */
export const POLARMODE_ADDITIONAL = 4;
/**
 * POLARMODE 8: points are acquired for object snap tracking only while Shift is held over them
 * (Options > Drafting's "Shift to acquire"); otherwise a pause acquires them and Shift held
 * keeps one from being acquired (AutoCAD 2024 Help, "About Tracking Points Automatically Using
 * Object Snaps": "press Shift to temporarily avoid acquiring a point").
 */
export const POLARMODE_SHIFT_ACQUIRE = 8;

/** POLARADDANG's limits (AutoCAD 2024 Help): up to 10 angles of up to 25 characters each. */
export const MAX_ADDITIONAL_ANGLES = 10;
const ANGLE_CHARS = 25;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * POLARADDANG's angles, degrees, in its order; undefined when the text is not a list of them.
 * AutoCAD shows them in AUNITS' format; Triya reads and writes decimal degrees, the format the
 * Drafting Settings dialog's New button takes (AutoCAD's Help does not say which formats the
 * variable itself accepts).
 */
export function additionalAngles(text: string): number[] | undefined {
  if (text.trim() === '') return [];
  const parts = text.split(';').map((t) => t.trim());
  if (parts.length > MAX_ADDITIONAL_ANGLES) return undefined;
  const out: number[] = [];
  for (const t of parts) {
    if (t.length === 0 || t.length > ANGLE_CHARS || !DECIMAL.test(t)) return undefined;
    out.push(Number(t));
  }
  return out;
}

/**
 * What the cursor tracks with (constrainCursor's `polar` and `trackPolar`): POLARANG's multiples
 * while POLAR is on, with POLARADDANG's angles while POLARMODE has bit 4, and object snap
 * tracking along all of them while it has bit 2 (AutoCAD 2024 Help, "Polar Tracking Tab
 * (Drafting Settings Dialog Box)": "Track Using All Polar Angle Settings"). With bit 1 and the
 * direction of the last segment drawn (`last`, the prompt's), the angles count from it.
 */
export function trackingSettings(
  s: DraftingState,
  last?: { readonly x: number; readonly y: number },
): {
  polar?: { increment: number; additional?: number[]; relative?: number };
  trackPolar?: true;
} {
  if (!s.polar) return {};
  const relative =
    (s.polarMode & POLARMODE_RELATIVE) !== 0 && last && (last.x !== 0 || last.y !== 0)
      ? Math.atan2(last.y, last.x)
      : undefined;
  const rad = Math.PI / 180;
  const extra =
    (s.polarMode & POLARMODE_ADDITIONAL) !== 0 ? (additionalAngles(s.polarAddAngles) ?? []) : [];
  return {
    polar: {
      increment: s.polarAngle * rad,
      ...(extra.length > 0 && { additional: extra.map((a) => a * rad) }),
      ...(relative !== undefined && { relative }),
    },
    ...((s.polarMode & POLARMODE_TRACK_POLAR) !== 0 && { trackPolar: true }),
  };
}

/**
 * The PolarSnap distance while SNAP is on with PolarSnap (SNAPTYPE 1): POLARDIST, or the snap X
 * spacing (`snapX`) while it is 0 (AutoCAD 2024 Help, "Snap and Grid Tab": "If this value is 0,
 * the PolarSnap distance assumes the value for Snap X Spacing"); undefined for grid snap.
 */
export function polarSnapDistance(s: DraftingState, snapX: number): number | undefined {
  if (!s.snap || s.snapType !== 1) return undefined;
  return s.polarDist > 0 ? s.polarDist : snapX;
}

/** GRIDSTYLE 1: the grid is dotted in 2D model space. */
export const GRIDSTYLE_MODEL = 1;
/** GRIDSTYLE 4: the grid is dotted on layouts (AutoCAD's "Sheet/layout"). */
export const GRIDSTYLE_LAYOUT = 4;

/**
 * How the canvas draws the grid (M3-06 part 6): adaptive, subdivided and within the limits by
 * the viewport's GRIDDISPLAY (`flags`; a layout or a drawing without one is adaptive and runs
 * beyond the limits, as before), dotted by GRIDSTYLE for the space shown.
 */
export function gridDisplayOf(o: {
  flags: number | undefined;
  limits: Box | undefined;
  layout: boolean;
  gridStyle: number;
}): { adaptive: boolean; subdivide: boolean; limits?: Box; dots: boolean } {
  const flags = o.flags ?? GRID_DISPLAY.adaptive | GRID_DISPLAY.beyondLimits;
  const adaptive = (flags & GRID_DISPLAY.adaptive) !== 0;
  const within = (flags & GRID_DISPLAY.beyondLimits) === 0 ? o.limits : undefined;
  return {
    adaptive,
    subdivide: adaptive && (flags & GRID_DISPLAY.subdivide) !== 0,
    ...(within && { limits: within }),
    dots: (o.gridStyle & (o.layout ? GRIDSTYLE_LAYOUT : GRIDSTYLE_MODEL)) !== 0,
  };
}

/** An angle as POLARADDANG lists it: decimal degrees, no trailing zeros. */
export function angleText(deg: number): string {
  return String(+deg.toFixed(6));
}

/** AUTOSNAP 1: AutoSnap's marker is drawn at the snap point. */
export const AUTOSNAP_MARKER = 1;
/** AUTOSNAP 2: the SnapTip names the object snap. */
export const AUTOSNAP_TIP = 2;
/** AUTOSNAP 4: the magnet locks the cursor (rubber band and coordinates) onto the snap point. */
export const AUTOSNAP_MAGNET = 4;
/** AUTOSNAP 8 and 16: POLAR and OTRACK, kept as the status bar's toggles. */
export const AUTOSNAP_POLAR = 8;
export const AUTOSNAP_OTRACK = 16;
/** AUTOSNAP 32: polar tracking's and object snap tracking's tooltips. */
export const AUTOSNAP_TRACK_TIP = 32;
/** The bits `DraftingState.autosnap` keeps. */
export const AUTOSNAP_KEPT = AUTOSNAP_MARKER | AUTOSNAP_TIP | AUTOSNAP_MAGNET | AUTOSNAP_TRACK_TIP;

export type DraftingToggle =
  | 'osnap'
  | 'ortho'
  | 'polar'
  | 'snap'
  | 'otrack'
  | 'grid'
  | 'lwt'
  | 'tpy'
  | 'annoVisible'
  | 'annoAutoScale'
  | 'qp'
  | 'sc'
  | 'groups'
  | 'groupBox'
  | 'underlaySnap';

/**
 * The toggles in the Ctrl+K palette, as its actions (`drafting:<toggle>`). Their keys (F3, F7–F11,
 * Ctrl+Shift+P, Ctrl+W, Ctrl+Shift+A, AutoCAD's) are the keyboard map's (keymap.ts, M3-10 part 2).
 */
export const DRAFTING_ITEMS = [
  { id: 'drafting:osnap', label: 'Object Snap on/off' },
  { id: 'drafting:grid', label: 'Grid Display on/off' },
  { id: 'drafting:ortho', label: 'Ortho Mode on/off' },
  { id: 'drafting:snap', label: 'Snap Mode on/off' },
  { id: 'drafting:polar', label: 'Polar Tracking on/off' },
  { id: 'drafting:otrack', label: 'Object Snap Tracking on/off' },
  { id: 'drafting:lwt', label: 'Show/Hide Lineweight' },
  { id: 'drafting:tpy', label: 'Show/Hide Transparency' },
  { id: 'drafting:annoVisible', label: 'Annotation Visibility on/off' },
  { id: 'drafting:annoAutoScale', label: 'Annotation AutoScale on/off' },
  { id: 'drafting:qp', label: 'Quick Properties on/off' },
  { id: 'drafting:sc', label: 'Selection Cycling on/off' },
  { id: 'drafting:groups', label: 'Group Selection on/off' },
  { id: 'drafting:groupBox', label: 'Group Bounding Box on/off' },
  { id: 'drafting:underlaySnap', label: 'Snap to Underlays on/off' },
].map((i) => ({ ...i, kind: 'action' as const, aliases: [] as string[] }));

export const INITIAL_DRAFTING: DraftingState = {
  osmode: OSMODE_DEFAULT,
  ortho: false,
  polar: true,
  polarAngle: 90,
  snap: false,
  otrack: true,
  grid: false,
  lwt: undefined,
  tpy: true,
  annoAllVisible: true,
  annoAutoScale: -4,
  markerSize: 5,
  aperture: 10,
  pdfOsnap: true,
  revcloudGrips: true,
  layerEvalCtl: true,
  qpmode: -1,
  qpLocation: 0,
  autosnap: AUTOSNAP_KEPT,
  pickfirst: true,
  gripSize: 5,
  gripColors: GRIP_COLORS_DEFAULT,
  rolloverTips: true,
  arrayAssociativity: true,
  fieldDisplay: true,
  layLockFade: 50,
  xFade: 50,
  plotTransparencyOverride: 1,
  layoutCreateViewport: true,
  showPageSetupForNewLayouts: false,
  lwDefault: 25,
  lwUnits: 1,
  lwScale: 1,
  bindType: 0,
  polarMode: 0,
  polarAddAngles: '',
  snapType: 0,
  polarDist: 0,
  gridStyle: 0,
  tempOverrides: true,
  dynBits: 3,
  dynPrompt: true,
  dynPiCoords: 0,
  dynPiFormat: 0,
  dynPiVis: 1,
  dynDiVis: 1,
  dynDiGrip: 31,
  dynInfoTips: true,
  tooltip: DEFAULT_TOOLTIP,
  selectSimilarMode: 130,
  selectionCycling: 0,
  pickStyle: 1,
  groupDisplayMode: 2,
  pickbox: 3,
  pickadd: 2,
  pickauto: 5,
  selectionPreview: 3,
  previewFilter: 3,
  selectionPreviewLimit: 20000,
  commandPreview: 1,
  qpQuadrant: 'top-right',
  qpDistance: 50,
  qpCollapse: true,
  qpRows: 3,
  // Help states no initial place for the Selection list: Triya takes top right, 25 pixels,
  // nearer than Quick Properties' 50 as the list is small and read at once.
  scLocation: 0,
  scQuadrant: 'top-right',
  scDistance: 25,
  scTitleBar: true,
  modifyOptions: INITIAL_MODIFY_OPTIONS,
  sessionOptions: INITIAL_SESSION_OPTIONS,
};

/**
 * Whether a toggle is on: OSNAP is on while OSMODE has modes and no OSNAP_OFF; LWT is the
 * drawing's LWDISPLAY (`lwdisplay`) until the drafter turns it.
 */
export function isOn(s: DraftingState, t: DraftingToggle, lwdisplay = false): boolean {
  if (t === 'osnap') return (s.osmode & OSNAP_OFF) === 0 && s.osmode !== 0;
  if (t === 'lwt') return s.lwt ?? lwdisplay;
  if (t === 'qp') return s.qpmode > 0;
  if (t === 'sc') return s.selectionCycling > 0;
  if (t === 'groups') return (s.pickStyle & 1) !== 0;
  if (t === 'groupBox') return s.groupDisplayMode === 2;
  if (t === 'underlaySnap') return s.pdfOsnap;
  if (t === 'annoVisible') return s.annoAllVisible;
  if (t === 'annoAutoScale') return s.annoAutoScale > 0;
  return s[t];
}

/** SNAP and GRID of the viewport worked in (M6-02 part 19), and how to turn them there. */
export interface ViewportModes {
  readonly snap: boolean;
  readonly grid: boolean;
  set(patch: { readonly snap?: boolean; readonly grid?: boolean }): void;
}

export class Drafting {
  #state: DraftingState;
  /** `#state` with the viewport worked in's SNAP and GRID, as `get` gives it. */
  #shown: DraftingState;
  #viewport: ViewportModes | undefined;
  /** The LWDISPLAY of the drawing shown, which LWT shows until the drafter turns it. */
  #drawingLwt = false;
  readonly #listeners = new Set<() => void>();

  constructor(initial: DraftingState = INITIAL_DRAFTING) {
    this.#state = initial;
    this.#shown = initial;
  }

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): DraftingState => this.#shown;

  isOn(t: DraftingToggle, lwdisplay = this.#drawingLwt): boolean {
    return isOn(this.#shown, t, lwdisplay);
  }

  /**
   * The canvas worked in changed, or its viewport's SNAP or GRID did (M6-02 part 19): undefined
   * when its drawing has no viewport to keep them in, and the session's own apply.
   */
  setViewportModes(m: ViewportModes | undefined): void {
    const was = this.#viewport;
    this.#viewport = m;
    if (was?.snap === m?.snap && was?.grid === m?.grid) return;
    this.#set(this.#state);
  }

  /** Turns SNAP or GRID in the viewport worked in; false when the session's own apply. */
  #turnViewport(patch: { snap?: boolean; grid?: boolean }): boolean {
    const v = this.#viewport;
    if (!v) return false;
    const changed = {
      ...(patch.snap !== undefined && patch.snap !== v.snap && { snap: patch.snap }),
      ...(patch.grid !== undefined && patch.grid !== v.grid && { grid: patch.grid }),
    };
    if (Object.keys(changed).length === 0) return true;
    // Shown at once; the canvas tells the drawing's again once the edit is made.
    this.#viewport = { ...v, ...changed };
    v.set(changed);
    this.#set(this.#state);
    return true;
  }

  /** The drawing shown changed: its LWDISPLAY is what LWT shows until turned. */
  setDrawingLineweights(on: boolean): void {
    if (on === this.#drawingLwt) return;
    this.#drawingLwt = on;
    this.#set({ ...this.#state });
  }

  get drawingLineweights(): boolean {
    return this.#drawingLwt;
  }

  /** Turns a toggle; `lwdisplay` is the shown drawing's LWDISPLAY, which LWT turns from. */
  toggle(t: DraftingToggle, lwdisplay = this.#drawingLwt): void {
    const s = this.#state;
    switch (t) {
      case 'osnap': {
        // F3 with no modes chosen turns on AutoCAD's initial set rather than nothing.
        const modes = s.osmode & ~OSNAP_OFF;
        const osmode = this.isOn('osnap') ? modes | OSNAP_OFF : modes || OSMODE_DEFAULT;
        return this.#set({ ...s, osmode });
      }
      // ORTHO and POLAR cannot both be on: turning one on turns the other off, as in AutoCAD.
      case 'ortho':
        return this.#set({ ...s, ortho: !s.ortho, polar: s.ortho ? s.polar : false });
      case 'polar':
        return this.#set({ ...s, polar: !s.polar, ortho: s.polar ? s.ortho : false });
      case 'lwt':
        return this.#set({ ...s, lwt: !(s.lwt ?? lwdisplay) });
      // QPMODE's sign: on keeps its mode (1 or 2) for when it is turned on again; 0 turns on 1.
      case 'qp':
        return this.#set({ ...s, qpmode: s.qpmode === 0 ? 1 : -s.qpmode });
      // SELECTIONCYCLING's sign likewise (M3-04 part 3); 0 turns on 2, the badge and the list,
      // as the Drafting Settings' "Display selection cycling list box" is checked at first.
      case 'sc':
        return this.#set({
          ...s,
          selectionCycling: s.selectionCycling === 0 ? 2 : -s.selectionCycling,
        });
      // Group selection is PICKSTYLE's bit 1 (M3-08); associative hatch selection keeps its bit.
      case 'groups':
        return this.#set({ ...s, pickStyle: s.pickStyle ^ 1 });
      // The Group Bounding Box toggle (M3-13; the Home tab's Groups panel in AutoCAD): the box
      // with the group's one grip (GROUPDISPLAYMODE 2), or the grip alone (1).
      case 'groupBox':
        return this.#set({ ...s, groupDisplayMode: s.groupDisplayMode === 2 ? 1 : 2 });
      // Snap to Underlays (M5-04 part 20; AutoCAD's Insert > Reference button, UOSNAP): object
      // snapping to underlays' geometry, PDFOSNAP since Triya's underlays are all PDF.
      case 'underlaySnap':
        return this.#set({ ...s, pdfOsnap: !s.pdfOsnap });
      // The status bar's Annotation Visibility and AutoScale (M6-03): ANNOALLVISIBLE, and
      // ANNOAUTOSCALE's sign, which keeps its value for when it is turned on again.
      case 'annoVisible':
        return this.#set({ ...s, annoAllVisible: !s.annoAllVisible });
      case 'annoAutoScale':
        return this.#set({ ...s, annoAutoScale: -s.annoAutoScale });
      case 'snap':
      case 'grid':
        if (this.#turnViewport({ [t]: !this.isOn(t) })) return;
        return this.#set({ ...s, [t]: !s[t] });
      case 'otrack':
      case 'tpy':
        return this.#set({ ...s, [t]: !s[t] });
    }
  }

  /** Turns one running object snap mode on or off (the OSNAP button's menu). */
  setMode(mode: OsnapMode, on: boolean): void {
    const s = this.#state;
    const bit = OSNAP[mode];
    const modes = on ? (s.osmode | bit) & ~OSNAP_OFF : s.osmode & ~bit;
    this.#set({ ...s, osmode: modes });
  }

  /** Settings (M2-20) changed some of the state: the stored settings or the dialog's. */
  configure(patch: Partial<DraftingState>): void {
    // The Drafting Settings' Snap On and Grid On, in the viewport worked in (M6-02 part 19).
    if (this.#viewport && (patch.snap !== undefined || patch.grid !== undefined)) {
      const { snap, grid, ...rest } = patch;
      this.#turnViewport({
        ...(snap !== undefined && { snap }),
        ...(grid !== undefined && { grid }),
      });
      patch = rest;
    }
    const next = { ...this.#state, ...patch };
    // ORTHO and POLAR cannot both be on; the stored POLAR wins over this session's ORTHO.
    if (patch.polar && next.ortho) next.ortho = false;
    this.#set(next);
  }

  #set(next: DraftingState): void {
    this.#state = next;
    const v = this.#viewport;
    this.#shown = v ? { ...next, snap: v.snap, grid: v.grid } : next;
    for (const l of this.#listeners) l();
  }
}

export const drafting = new Drafting();
