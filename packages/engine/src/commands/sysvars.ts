// System variables (M2-42): what SETVAR, and a variable's name typed at `Command:`, read and
// set (AutoCAD 2024 Help, "SETVAR (Command)", "System Variables"). Triya keeps them in three
// places:
//
// - the drawing's header (`$LTSCALE`, the DIMVARs, `$CLAYER`, …): every variable the file's
//   HEADER section holds, as io maps it, and the AcDbVariableDictionary ones it carries under
//   their bare names (`CETRANSPARENCY`). Setting one is an edit, one undo step, saved with the
//   drawing as AutoCAD saves it;
// - an object: WIPEOUTFRAME, kept in the drawing's WIPEOUTVARIABLES (`wipeout.ts`), and
//   IMAGEFRAME, in its RASTERVARIABLES (`image.ts`, M5-04 part 4);
// - the app (`APP_VARIABLES`): the drafting aids of the status bar (ORTHOMODE, OSMODE, …) and
//   the per-user settings AutoCAD keeps in the registry (APERTURE, REVCLOUDGRIPS, …). The
//   command asks the app for them through the view host (`sysvar` requests): commands never
//   read UI state themselves.
//
// AutoCAD also works some variables out (M2-59): the date (DATE, CDATE, from the bus's clock)
// and the view shown (VIEWSIZE, VIEWCTR, asked of the canvas), read only, and the tab shown
// (CTAB, TILEMODE; set, the app shows another tab), are `COMPUTED_VARIABLES`; the drawing's file (DWGNAME, DWGPREFIX, DWGTITLED) and whether it has
// unsaved changes (DBMOD) are the app's to tell, `DRAWING_VARIABLES`.
//
// AutoCAD's refusals are not all documented word for word: "Unknown variable name.  Type SETVAR
// ? for a list of variables." and "Requires an integer value." are AutoCAD's own; the range
// messages ("Value must be between 0 and 1.") follow its wording for the variables it bounds,
// and a name that names no record ("No layer named …") is Triya's.
import {
  drawingUnits,
  formatAngle,
  formatDistance,
  formatNumber,
  type DrawingUnits,
} from './units';
import { parseAngleValue, parseDistance } from './parse';
import type { DocumentModel } from '../model/document';
import type { HeaderValue } from '../model/types';
import { OSNAP_OFF } from '../input/osnap';
import { CETRANSPARENCY } from '../properties/current';
import { FIELDEVAL, FIELDEVAL_INITIAL } from '../edit/field-eval';
import { CENTER_VARIABLES, isCenterLength } from '../edit/center-settings';

export type VariableKind =
  /** A whole number, `min`–`max` when bounded. */
  | 'integer'
  /** A number. */
  | 'real'
  /** A length, shown and typed in the drawing's units (LUNITS, LUPREC; M2-35 part 23). */
  | 'distance'
  /** An angle the header holds in radians, shown and typed in degrees. */
  | 'angle'
  /** 0 or 1, which the header may hold as false or true. */
  | 'switch'
  /** Text. */
  | 'text'
  /** A point. */
  | 'point'
  /** The name of a record of `table` (CLAYER names a layer). */
  | 'name'
  /** CECOLOR: BYLAYER, BYBLOCK or an ACI (the DXF header has no true colour). */
  | 'color'
  /** A lineweight: −3 Default, −2 ByBlock, −1 ByLayer or AutoCAD's hundredths of a millimetre. */
  | 'lineweight'
  /** CETRANSPARENCY: ByLayer, ByBlock or 0–90 percent. */
  | 'transparency';

/** The records a name variable can name. */
export type NameTable =
  | 'layers'
  | 'linetypes'
  | 'textStyles'
  | 'dimStyles'
  | 'blockRecords'
  | 'mlineStyles'
  | 'mleaderStyles'
  | 'tableStyles'
  /** Not a table: the drawing's scale list (`meta.annotationScales`). */
  | 'annotationScales'
  /** Not a table: the drawing's layouts, Model among them (CTAB). */
  | 'layouts';

export interface SystemVariable {
  /** AutoCAD's name, upper case, without the header's `$`. */
  readonly name: string;
  readonly store: 'header' | 'wipeout' | 'raster' | 'app' | 'computed' | 'vport';
  /** The header entry (`$LTSCALE`, `CETRANSPARENCY`) of a header variable. */
  readonly key?: string;
  readonly kind: VariableKind;
  readonly readOnly?: boolean;
  readonly min?: number;
  readonly max?: number;
  /** The only values it takes (POLARANG). */
  readonly choices?: readonly number[];
  /** Greater than zero (LTSCALE: "Value must be positive and nonzero."). */
  readonly positive?: boolean;
  /** Zero or more (DIMSCALE). */
  readonly nonNegative?: boolean;
  readonly table?: NameTable;
  /** A name variable may name nothing (DIMBLK: the closed filled arrowhead). */
  readonly empty?: boolean;
  /** Decimal places a real always shows, whatever LUPREC is (DATE's day fraction). */
  readonly places?: number;
  /**
   * A number the drawing keeps as text: a DICTIONARYVAR (MSLTSCALE's "1"), shown and typed as a
   * number and written back as AutoCAD writes it.
   */
  readonly text?: true;
  /** A point in pixels, not drawing units (SCREENSIZE): shown as plain numbers. */
  readonly pixels?: true;
  /** Text that is a length or a factor followed by `x` (CENTERCROSSSIZE's "0.1x"). */
  readonly relative?: true;
  /** Text for which "." is a value of its own (CENTERLAYER: the current layer). */
  readonly dot?: true;
  /**
   * What a DICTIONARYVAR the drawing does not have holds (FIELDEVAL's "31"): AutoCAD's initial
   * value, which SETVAR shows and sets for the session (M4-10 part 3).
   */
  readonly initial?: HeaderValue;
}

/**
 * The variables the app keeps (AutoCAD 2024's system variable reference for each range): the
 * status bar's drafting aids and the per-user settings. The app answers `sysvar` requests for
 * each of them by name (apps/web `system-variables.ts`).
 */
/** PICKFIRST: objects picked at `Command:` are what the next command takes (noun-verb). */
export const PICKFIRST = 'PICKFIRST';

/** AutoCAD's lineweights, hundredths of a millimetre. */
export const LINEWEIGHT_VALUES: readonly number[] = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];

export const APP_VARIABLES: readonly SystemVariable[] = [
  { name: 'ORTHOMODE', store: 'app', kind: 'switch' },
  { name: 'SNAPMODE', store: 'app', kind: 'switch' },
  { name: 'GRIDMODE', store: 'app', kind: 'switch' },
  // OSMODE's 14 mode bits, and 16384 for "running snaps off" (F3).
  { name: 'OSMODE', store: 'app', kind: 'integer', min: 0, max: 0x3fff | OSNAP_OFF },
  { name: 'POLARANG', store: 'app', kind: 'real', choices: [90, 45, 30, 22.5, 18, 15, 10, 5] },
  { name: 'APERTURE', store: 'app', kind: 'integer', min: 1, max: 50 },
  { name: 'LWDISPLAY', store: 'app', kind: 'switch' },
  // M5-08 part 3 (AutoCAD 2024 Help, "LWDEFAULT", "LWUNITS"; both "Saved in: Registry"): what
  // Default draws as, one of the lineweights (hundredths of a millimetre, initially 25), and
  // whether lineweights are listed in millimetres (1, initially) or inches (0).
  { name: 'LWDEFAULT', store: 'app', kind: 'integer', choices: LINEWEIGHT_VALUES },
  { name: 'LWUNITS', store: 'app', kind: 'switch' },
  { name: 'TRANSPARENCYDISPLAY', store: 'app', kind: 'switch' },
  { name: 'PDFOSNAP', store: 'app', kind: 'switch' },
  // 1 (AutoCAD 2021+): a revision cloud shows its corners; 0: a grip at every arc's end.
  { name: 'REVCLOUDGRIPS', store: 'app', kind: 'switch' },
  // Quick Properties (M2-35 part 16): QPMODE 0 off, 1 for all objects, 2 only for objects with
  // quick properties of their own, a negative value off keeping what it turns back on to;
  // QPLOCATION 0 by the cursor, 1 static.
  { name: 'QPMODE', store: 'app', kind: 'integer', min: -2, max: 2 },
  { name: 'QPLOCATION', store: 'app', kind: 'integer', min: 0, max: 1 },
  // ROLLOVERTIPS (M2-35 part 21; AutoCAD 2024 Help): rollover tooltips on (1, initially) or off.
  { name: 'ROLLOVERTIPS', store: 'app', kind: 'integer', min: 0, max: 1 },
  // M2-59 (AutoCAD 2024 Help, each variable's page): AUTOSNAP's bits are 1 the marker, 2 the
  // SnapTip, 4 the magnet, 8 polar tracking (POLAR), 16 object snap tracking (OTRACK) and 32
  // their tooltips; AUTOSNAPSIZE the marker's size in pixels; DYNMODE −3 to 3, a negative value
  // off keeping what F12 turns back on; PICKFIRST noun-verb selection, which each drawing's
  // command line is told (the session's `sysvar` edit).
  { name: 'AUTOSNAP', store: 'app', kind: 'integer', min: 0, max: 63 },
  { name: 'AUTOSNAPSIZE', store: 'app', kind: 'integer', min: 1, max: 20 },
  { name: 'DYNMODE', store: 'app', kind: 'integer', min: -3, max: 3 },
  { name: PICKFIRST, store: 'app', kind: 'switch' },
  // GRIPSIZE (M2-59 part 3): the grip box's size in pixels, 1 to 255, initially 5 (AutoCAD 2024
  // Help); Settings' grip size, which the canvas draws and picks grips at.
  { name: 'GRIPSIZE', store: 'app', kind: 'integer', min: 1, max: 255 },
  // M3-05 part 5 (AutoCAD 2024 Help, each "Saved in: Registry"): the grips' colours, ACI 1 to 255:
  // GRIPCOLOR unselected grips (initially 150), GRIPHOVER the grip the cursor pauses on (11),
  // GRIPHOT selected grips (12) and GRIPCONTOUR their contour (251); Settings' Grip Colors.
  { name: 'GRIPCOLOR', store: 'app', kind: 'integer', min: 1, max: 255 },
  { name: 'GRIPHOVER', store: 'app', kind: 'integer', min: 1, max: 255 },
  { name: 'GRIPHOT', store: 'app', kind: 'integer', min: 1, max: 255 },
  { name: 'GRIPCONTOUR', store: 'app', kind: 'integer', min: 1, max: 255 },
  // ARRAYASSOCIATIVITY (M3-11; AutoCAD 2024 Help): new arrays are associative (1, initially) or
  // separate objects (0); ARRAY's ASsociative option sets it.
  { name: 'ARRAYASSOCIATIVITY', store: 'app', kind: 'switch' },
  // FIELDDISPLAY (M4-10 part 3; AutoCAD 2024 Help, "Saved in: Registry"): fields shown on a grey
  // background (1, initially), which is not plotted; 0 shows them as the rest of their text.
  { name: 'FIELDDISPLAY', store: 'app', kind: 'switch' },
  // LAYLOCKFADECTL (M5-06; AutoCAD 2024 Help, "Saved in: Registry"): objects on locked layers
  // drawn faded by this percentage, −90 to 90, initially 50; a negative value turns fading off
  // keeping the amount. LAYISO's Lock and fade sets it.
  { name: 'LAYLOCKFADECTL', store: 'app', kind: 'integer', min: -90, max: 90 },
  // XFADECTL (M5-02 part 5; AutoCAD 2024 Help, "Saved in: Registry"): while a reference is edited
  // in place, objects not in the working set drawn faded by this percentage, 0 to 90, initially 50.
  { name: 'XFADECTL', store: 'app', kind: 'integer', min: 0, max: 90 },
  // BINDTYPE (M5-04 part 2; AutoCAD 2024 Help, "Saved in: Not-saved"): how -XREF Bind binds an
  // xref, 0 (initially) as Bind (`xref$0$name`), 1 as Insert (the names without the xref's).
  { name: 'BINDTYPE', store: 'app', kind: 'integer', min: 0, max: 1 },
  // M3-06 part 1 (AutoCAD 2024 Help): POLARMODE's bits are 1 polar angles relative to the last
  // segment, 2 object snap tracking along the polar angles, 4 the additional angles, 8 Shift to
  // acquire tracking points (initially 0); POLARADDANG up to 10 additional angles separated by
  // semicolons (initially ""), which the app reads and may refuse.
  { name: 'POLARMODE', store: 'app', kind: 'integer', min: 0, max: 15 },
  { name: 'POLARADDANG', store: 'app', kind: 'text' },
  // M3-06 part 3 (AutoCAD 2024 Help, both "Saved in: Registry"): SNAPTYPE 0 grid snap, 1
  // PolarSnap (initially 0); POLARDIST the PolarSnap increment (initially 0: the snap X spacing).
  { name: 'SNAPTYPE', store: 'app', kind: 'integer', min: 0, max: 1 },
  { name: 'POLARDIST', store: 'app', kind: 'real', nonNegative: true },
  // M3-06 part 6 (AutoCAD 2024 Help, "GRIDSTYLE"): a dotted grid in 2D model space (1), the block
  // editor (2) and on layouts (4); initially 0, lines. DXF has no place for it: per user.
  { name: 'GRIDSTYLE', store: 'app', kind: 'integer', min: 0, max: 7 },
  // M3-06 part 5 (AutoCAD 2024 Help, "Saved in: Registry"): TEMPOVERRIDES 1 the temporary override
  // keys act (initially), 0 not.
  { name: 'TEMPOVERRIDES', store: 'app', kind: 'switch' },
  // M3-06 part 4 (AutoCAD 2024 Help, all "Saved in: Registry"): the Dynamic Input tab's DYNPROMPT
  // 1 the prompt at the cursor (initially), 0 not; DYNPICOORDS pointer input's next points 0
  // relative (initially), 1 absolute; DYNPIFORMAT their format 0 polar (initially), 1 Cartesian.
  { name: 'DYNPROMPT', store: 'app', kind: 'switch' },
  { name: 'DYNPICOORDS', store: 'app', kind: 'integer', min: 0, max: 1 },
  { name: 'DYNPIFORMAT', store: 'app', kind: 'integer', min: 0, max: 1 },
  // M3-06 part 8 (AutoCAD 2024 Help, all "Saved in: Registry"): DYNPIVIS pointer input shows 0
  // once typed in, 1 at a prompt for a point (initially), 2 always; DYNDIVIS dimension input
  // while a grip is stretched shows 0 one field, 1 two (initially), 2 those DYNDIGRIP's bits say
  // (1 resulting dimension, 2 length change, 4 absolute angle, 8 angle change, 16 arc radius;
  // initially 31); DYNINFOTIPS 1 the tips for Shift and Ctrl (initially), 0 not.
  { name: 'DYNPIVIS', store: 'app', kind: 'integer', min: 0, max: 2 },
  { name: 'DYNDIVIS', store: 'app', kind: 'integer', min: 0, max: 2 },
  { name: 'DYNDIGRIP', store: 'app', kind: 'integer', min: 0, max: 31 },
  { name: 'DYNINFOTIPS', store: 'app', kind: 'switch' },
  // M3-04 part 3 (AutoCAD 2024 Help): SELECTSIMILARMODE's bits are the properties SELECTSIMILAR
  // matches (1 Color, 2 Layer, 4 Linetype, 8 Linetype scale, 16 Lineweight, 32 Plot style, 64
  // Object style, 128 Name; initially 130); SELECTIONCYCLING 0 off, 1 the overlap badge, 2 the
  // badge and the Selection list, a negative value off keeping what Ctrl+W turns back on.
  { name: 'SELECTSIMILARMODE', store: 'app', kind: 'integer', min: 0, max: 255 },
  { name: 'SELECTIONCYCLING', store: 'app', kind: 'integer', min: -2, max: 2 },
  // M3-08 (AutoCAD 2024 Help): PICKSTYLE 0 neither, 1 group selection, 2 associative hatch
  // selection, 3 both; kept per user (Saved in: Registry), initially 1, so the drawing's
  // $PICKSTYLE stays as read. Ctrl+Shift+A turns group selection on and off.
  { name: 'PICKSTYLE', store: 'app', kind: 'integer', min: 0, max: 3 },
  // M3-13 (AutoCAD 2024 Help, "GROUPDISPLAYMODE", Saved in: Registry): a group selected whole
  // shows 0 every member's grips, 1 one grip at its centre, 2 that grip and its bounding box
  // (initially 2). The Group Bounding Box toggle switches 1 and 2.
  { name: 'GROUPDISPLAYMODE', store: 'app', kind: 'integer', min: 0, max: 2 },
  // M3-04 part 4 (AutoCAD 2024 Help): PICKBOX the pickbox's half size in pixels (0 to 50,
  // initially 3); PICKADD 0 to 3 whether a step adds to the set or replaces it (initially 2);
  // PICKAUTO's bits 1 a window where a pick finds nothing, 2 a window dragged from an object at
  // `Command:`, 4 a lasso where a drag starts on nothing (initially 5).
  { name: 'PICKBOX', store: 'app', kind: 'integer', min: 0, max: 50 },
  { name: 'PICKADD', store: 'app', kind: 'integer', min: 0, max: 3 },
  { name: 'PICKAUTO', store: 'app', kind: 'integer', min: 0, max: 7 },
  // M3-04 part 5 (AutoCAD 2024 Help, both "Saved in: Registry", initially 3): SELECTIONPREVIEW's
  // bits 1 the preview at `Command:`, 2 at a command's object selection; PREVIEWFILTER's bits
  // leave out objects on locked layers (1), in xrefs (2), tables (4), MTEXT (8), hatches (16) and
  // objects in groups (32).
  { name: 'SELECTIONPREVIEW', store: 'app', kind: 'integer', min: 0, max: 3 },
  { name: 'PREVIEWFILTER', store: 'app', kind: 'integer', min: 0, max: 63 },
  // M3-04 part 6 (AutoCAD 2024 Help, "Saved in: Registry", initially 20000): a selection window
  // or lasso taking more objects than this previews none. An Integer variable is 16-bit.
  { name: 'SELECTIONPREVIEWLIMIT', store: 'app', kind: 'integer', min: 0, max: 32767 },
  // M3-12 part 6 (AutoCAD 2024 Help, "Saved in: Registry", initially 1): 1 previews what TRIM,
  // EXTEND, FILLET, CHAMFER, LENGTHEN, BREAK and OFFSET would do at the cursor.
  { name: 'COMMANDPREVIEW', store: 'app', kind: 'integer', min: 0, max: 1 },
  // M3-12 (AutoCAD 2024 Help): the modify commands' options. OFFSETDIST the offset distance, a
  // negative value Through (initially −1), and CHAMMODE CHAMFER's method, 0 two distances or 1
  // a length and an angle (initially 0), are AutoCAD's unsaved variables: the app keeps them
  // while it runs. OFFSETERASE (0), OFFSETGAPTYPE 0 extended, 1 filleted, 2 chamfered gaps (0),
  // TRIMEXTENDMODE 1 Quick or 0 Standard (1), EDGEMODE 1 implied edges (0), PROJMODE 0 None,
  // 1 UCS, 2 View (1), TRIMMODE (1) and PEDITACCEPT 1 PEDIT turns what it picks into a polyline
  // without asking (0) are kept per user (Saved in: Registry). Each command reads them as it
  // starts and sets them when its option changes.
  { name: 'OFFSETDIST', store: 'app', kind: 'distance' },
  { name: 'OFFSETERASE', store: 'app', kind: 'switch' },
  { name: 'OFFSETGAPTYPE', store: 'app', kind: 'integer', min: 0, max: 2 },
  { name: 'TRIMEXTENDMODE', store: 'app', kind: 'switch' },
  { name: 'EDGEMODE', store: 'app', kind: 'switch' },
  { name: 'PROJMODE', store: 'app', kind: 'integer', min: 0, max: 2 },
  { name: 'TRIMMODE', store: 'app', kind: 'switch' },
  { name: 'CHAMMODE', store: 'app', kind: 'switch' },
  { name: 'PEDITACCEPT', store: 'app', kind: 'switch' },
  // M4-09 part 3 (AutoCAD 2024 Help, both "Saved in: Registry"): TEXTALIGN's options.
  // TEXTALIGNMODE the point it aligns by, 0–8 TL to BR, 9 Left, 10 Center, 11 Right (9), and
  // TEXTALIGNSPACING 0 Distribute, 1 Set spacing, 2 Current vertical, 3 Current horizontal (2).
  { name: 'TEXTALIGNMODE', store: 'app', kind: 'integer', min: 0, max: 11 },
  { name: 'TEXTALIGNSPACING', store: 'app', kind: 'integer', min: 0, max: 3 },
  // M4-07 part 5 (AutoCAD 2024 Help, "HPDLGMODE", Saved in: Registry): whether HATCH, GRADIENT
  // and HATCHEDIT open the Hatch and Gradient and Hatch Edit dialogs: 0 not (HATCH's seTtings
  // still does), 1 always, 2 when the ribbon is closed (2; Triya has no ribbon until M7-01).
  { name: 'HPDLGMODE', store: 'app', kind: 'integer', min: 0, max: 2 },
];

/**
 * The variables of the drawing the app tells (AutoCAD 2024 Help, "System Variables"), read only:
 * DWGNAME the drawing's file name, DWGPREFIX its folder (a browser never reveals one: always
 * empty), DWGTITLED 1 once it has a name, DBMOD nonzero while it has changes no save holds.
 * Asked of the app through `sysvar` requests (apps/web `system-variables.ts`).
 */
export const DRAWING_VARIABLES: readonly SystemVariable[] = [
  { name: 'DBMOD', store: 'app', kind: 'integer', readOnly: true },
  { name: 'DWGNAME', store: 'app', kind: 'text', readOnly: true },
  { name: 'DWGPREFIX', store: 'app', kind: 'text', readOnly: true },
  { name: 'DWGTITLED', store: 'app', kind: 'integer', readOnly: true },
];

/**
 * The variables the engine works out when read (setvar.ts): DATE and CDATE from the bus's clock,
 * shown to the hundredth of a second as AutoCAD shows them; CTAB the tab of the space commands
 * draw in and TILEMODE whether it is the Model tab (1) or a layout's (0), which set show another
 * tab (M2-59 part 5); VIEWSIZE and VIEWCTR the view the canvas shows (its height in drawing
 * units, and its centre); SCREENSIZE the canvas's size in (CSS) pixels; AREA, PERIMETER and
 * DISTANCE the last results of AREA, DIST and MEASUREGEOM in this session (M3-07; AutoCAD keeps
 * them unsaved, as Triya does); BLOCKEDITOR whether the Block Editor is open (M5-02); REFEDITNAME the
 * block a reference edit in place is editing, "" when none is (M5-02 part 3).
 */
export const COMPUTED_VARIABLES: readonly SystemVariable[] = [
  { name: 'AREA', store: 'computed', kind: 'real', readOnly: true },
  { name: 'BLOCKEDITOR', store: 'computed', kind: 'integer', readOnly: true },
  { name: 'CDATE', store: 'computed', kind: 'real', readOnly: true, places: 8 },
  { name: 'CTAB', store: 'computed', kind: 'name', table: 'layouts' },
  { name: 'DATE', store: 'computed', kind: 'real', readOnly: true, places: 8 },
  { name: 'DISTANCE', store: 'computed', kind: 'distance', readOnly: true },
  { name: 'PERIMETER', store: 'computed', kind: 'distance', readOnly: true },
  { name: 'REFEDITNAME', store: 'computed', kind: 'text', readOnly: true },
  { name: 'SCREENSIZE', store: 'computed', kind: 'point', readOnly: true, pixels: true },
  // The file's own $TILEMODE stays as it was read: Triya's tabs never write it.
  { name: 'TILEMODE', store: 'computed', kind: 'switch' },
  { name: 'VIEWCTR', store: 'computed', kind: 'point', readOnly: true },
  { name: 'VIEWSIZE', store: 'computed', kind: 'distance', readOnly: true },
];

/**
 * The variables kept in the current viewport, the model-space `*Active` VPORT (M3-06 part 6;
 * AutoCAD 2024 Help, each variable: saved in the drawing, the current viewport's): the snap
 * spacing (positive), the grid spacing (0 follows the snap spacing), GRIDMAJOR, GRIDDISPLAY's bits
 * and the snap base. They come before the header's copies, which only pre-2000 files carry and
 * which AutoCAD itself no longer reads; those stay as read.
 */
export const VPORT_VARIABLES: readonly SystemVariable[] = [
  { name: 'GRIDDISPLAY', store: 'vport', kind: 'integer', min: 0, max: 15 },
  { name: 'GRIDMAJOR', store: 'vport', kind: 'integer', min: 1, max: 100 },
  { name: 'GRIDUNIT', store: 'vport', kind: 'point' },
  { name: 'SNAPBASE', store: 'vport', kind: 'point' },
  { name: 'SNAPUNIT', store: 'vport', kind: 'point' },
  // M3-06 part 7: the snap and grid angle (DXF 50, relative to the UCS) and the UCS icon's bits
  // (DXF 74: 1 on, 2 at the origin; AutoCAD 2024 Help, "SNAPANG", "UCSICON").
  { name: 'SNAPANG', store: 'vport', kind: 'angle' },
  { name: 'UCSICON', store: 'vport', kind: 'integer', min: 0, max: 3 },
];

/**
 * AutoCAD's Julian date of a local date and time: the Julian day number of the date (1 January
 * 2020 is 2458850) and the fraction of the day since midnight (AutoCAD 2024 Help, "DATE"; the
 * same reckoning acad-ts gives TDUPDATE, CadUtils.toJulianCalendar).
 */
export function julianDate(d: Date): number {
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  if (month < 3) {
    year -= 1;
    month += 12;
  }
  const century = Math.floor(year / 100);
  const gregorian = 2 - century + Math.floor(century / 4);
  const days =
    gregorian +
    Math.floor(365.25 * year) +
    Math.floor(30.6001 * (month + 1)) +
    1720995 +
    d.getDate();
  const seconds =
    d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  return days + seconds / 86400;
}

/**
 * CDATE: a local date and time as the real YYYYMMDD.HHMMSS and hundredths of a second (AutoCAD
 * 2024 Help, "CDATE"); a real holds no more places beside an eight-digit date.
 */
export function calendarDate(d: Date): number {
  const date = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const centiseconds = Math.floor(d.getMilliseconds() / 10);
  const time = d.getHours() * 1e6 + d.getMinutes() * 1e4 + d.getSeconds() * 100 + centiseconds;
  return date + time / 1e8;
}

const WIPEOUTFRAME: SystemVariable = {
  name: 'WIPEOUTFRAME',
  store: 'wipeout',
  kind: 'integer',
  min: 0,
  max: 2,
};

/** IMAGEFRAME (AutoCAD 2024 Help, "IMAGEFRAME (System Variable)"): 0, 1 or 2. */
const IMAGEFRAME: SystemVariable = {
  name: 'IMAGEFRAME',
  store: 'raster',
  kind: 'integer',
  min: 0,
  max: 2,
};

/**
 * The header variables DXF writes with an integer group code (62, 70, 280, 370, 380), as
 * acad-ts's header map has them; io's `sysvar-kinds.test.ts` keeps this list true. A number
 * the header holds for any other variable is a real.
 */
// prettier-ignore
export const INTEGER_HEADER_VARIABLES: ReadonlySet<string> = new Set([
  'ACADMAINTVER', 'ANGDIR', 'ATTDIA', 'ATTMODE', 'ATTREQ', 'AUNITS', 'AUPREC', 'BLIPMODE',
  'CECOLOR', 'CELWEIGHT', 'CEPSNTYPE', 'CMLJUST', 'COORDS', 'CSHADOW', 'DELOBJ', 'DGNFRAME',
  'DIMADEC', 'DIMALT', 'DIMALTD', 'DIMALTTD', 'DIMALTTZ', 'DIMALTU', 'DIMALTZ', 'DIMARCSYM',
  'DIMASO', 'DIMASSOC', 'DIMATFIT', 'DIMAUNIT', 'DIMAZIN', 'DIMCLRD', 'DIMCLRE', 'DIMCLRT',
  'DIMDEC', 'DIMDSEP', 'DIMFIT', 'DIMFRAC', 'DIMFXLON', 'DIMJUST', 'DIMLIM', 'DIMLUNIT', 'DIMLWD',
  'DIMLWE', 'DIMSAH', 'DIMSD1', 'DIMSD2', 'DIMSE1', 'DIMSE2', 'DIMSHO', 'DIMSOXD', 'DIMTAD',
  'DIMTDEC', 'DIMTFILL', 'DIMTFILLCLR', 'DIMTIH', 'DIMTIX', 'DIMTMOVE', 'DIMTOFL', 'DIMTOH',
  'DIMTOL', 'DIMTOLJ', 'DIMTXTDIRECTION', 'DIMTZIN', 'DIMUNIT', 'DIMUPT', 'DIMZIN', 'DISPSILH',
  'DRAGMODE', 'DWFFRAME', 'ENDCAPS', 'FILLMODE', 'HALOGAP', 'HANDLING', 'HIDETEXT', 'INDEXCTL',
  'INSUNITS', 'INTERFERECOLOR', 'INTERSECTIONCOLOR', 'INTERSECTIONDISPLAY', 'JOINSTYLE',
  'LIGHTGLYPHDISPLAY', 'LIMCHECK', 'LOFTNORMALS', 'LOFTPARAM', 'LUNITS', 'LUPREC', 'MAXACTVP',
  'MEASUREMENT', 'MIRRTEXT', 'OBSCOLOR', 'OBSLTYPE', 'ORTHOMODE', 'OSMODE', 'PDMODE', 'PELLIPSE',
  'PICKSTYLE', 'PLIMCHECK', 'PLINEGEN', 'PROXYGRAPHICS', 'PSLTSCALE', 'PUCSORTHOVIEW', 'QTEXTMODE',
  'REGENMODE', 'REQUIREDVERSIONS', 'SAVEIMAGES', 'SHADEDGE', 'SHADEDIF', 'SHOWHIST', 'SKPOLY',
  'SOLIDHIST', 'SORTENTS', 'SPLFRAME', 'SPLINESEGS', 'SPLINETYPE', 'SURFTAB1', 'SURFTAB2',
  'SURFTYPE', 'SURFU', 'SURFV', 'TILEMODE', 'TILEMODELIGHTSYNCH', 'TIMEZONE', 'TREEDEPTH',
  'UCSORTHOVIEW', 'UNITMODE', 'USERI1', 'USERI2', 'USERI3', 'USERI4', 'USERI5', 'USRTIMER',
  'VISRETAIN', 'WORLDVIEW', 'XCLIPFRAME',
]);

/**
 * Header variables SETVAR shows but does not set: those AutoCAD keeps read-only (the dates,
 * the extents, ACADVER, DWGCODEPAGE), those a save sets itself, HANDSEED (handles are never
 * renumbered), the UCS (UCS commands own it, M3-06; renaming its record is not a variable's
 * job) and the handle-valued ones. TILEMODE is the tab shown (`COMPUTED_VARIABLES`).
 */
// prettier-ignore
const READ_ONLY_HEADER = new Set([
  'ACADVER', 'ACADMAINTVER', 'DWGCODEPAGE', 'HANDSEED', 'HANDLING', 'LASTSAVEDBY',
  'REQUIREDVERSIONS', 'TDCREATE', 'TDUCREATE', 'TDUPDATE', 'TDUUPDATE', 'TDINDWG', 'TDUSRTIMER',
  'VERSIONGUID', 'FINGERPRINTGUID', 'EXTMIN', 'EXTMAX', 'PEXTMIN', 'PEXTMAX', 'CMATERIAL',
  'INTERFEREOBJVS', 'INTERFEREVPVS', 'CANNOSCALEVALUE',
]);
const READ_ONLY_PATTERN =
  /^P?UCS(NAME|BASE|ORTHOREF|ORG|ORGBACK|ORGBOTTOM|ORGFRONT|ORGLEFT|ORGRIGHT|ORGTOP|XDIR|YDIR|ORTHOVIEW)$/;

/** The header's name variables and the records each names. */
const NAME_VARIABLES: Readonly<Record<string, { table: NameTable; empty?: true }>> = {
  CLAYER: { table: 'layers' },
  CELTYPE: { table: 'linetypes' },
  TEXTSTYLE: { table: 'textStyles' },
  DIMTXSTY: { table: 'textStyles' },
  DIMSTYLE: { table: 'dimStyles' },
  CMLSTYLE: { table: 'mlineStyles' },
  DIMBLK: { table: 'blockRecords', empty: true },
  DIMBLK1: { table: 'blockRecords', empty: true },
  DIMBLK2: { table: 'blockRecords', empty: true },
  DIMLDRBLK: { table: 'blockRecords', empty: true },
  DIMLTYPE: { table: 'linetypes', empty: true },
  DIMLTEX1: { table: 'linetypes', empty: true },
  DIMLTEX2: { table: 'linetypes', empty: true },
};

/**
 * The AcDbVariableDictionary variables SETVAR sets (M2-59 part 4), by AutoCAD 2024's system
 * variable reference. Each DICTIONARYVAR holds text: those naming a style or scale take a name
 * the drawing has, which the save checks again; the numeric ones are kept as AutoCAD writes them
 * ("1", "3.500000"). CETRANSPARENCY and HPTRANSPARENCY are ByLayer, ByBlock or a percentage.
 * Others (CVIEWDETAILSTYLE, CVIEWSECTIONSTYLE, HPCOLOR, CENTERLTYPEFILE, …) name what Triya does
 * not keep, so they stay read only.
 */
const DICTIONARY_VARIABLES: Readonly<
  Record<
    string,
    Pick<
      SystemVariable,
      'kind' | 'table' | 'min' | 'max' | 'nonNegative' | 'positive' | 'relative' | 'dot'
    >
  >
> = {
  CMLEADERSTYLE: { kind: 'name', table: 'mleaderStyles' },
  CTABLESTYLE: { kind: 'name', table: 'tableStyles' },
  CANNOSCALE: { kind: 'name', table: 'annotationScales' },
  [CETRANSPARENCY]: { kind: 'transparency' },
  HPTRANSPARENCY: { kind: 'transparency' },
  MSLTSCALE: { kind: 'switch' },
  HIDETEXT: { kind: 'switch' },
  DIMASSOC: { kind: 'integer', min: 0, max: 2 },
  LAYEREVAL: { kind: 'integer', min: 0, max: 2 },
  LAYERNOTIFY: { kind: 'integer', min: 0, max: 15 },
  LIGHTINGUNITS: { kind: 'integer', min: 0, max: 2 },
  XCLIPFRAME: { kind: 'integer', min: 0, max: 2 },
  INDEXCTL: { kind: 'integer', min: 0, max: 3 },
  SORTENTS: { kind: 'integer', min: 0, max: 127 },
  // M4-08 part 3 (AutoCAD 2024 Help, "CENTERCROSSSIZE", "CENTERCROSSGAP", "CENTEREXE",
  // "CENTERMARKEXE", "CENTERLTYPE", "CENTERLTSCALE", "CENTERLAYER"; each "Saved in: Drawing"):
  // what new center marks and centerlines take (edit/center-marks.ts `centerSettings`).
  CENTERCROSSSIZE: { kind: 'text', relative: true },
  CENTERCROSSGAP: { kind: 'text', relative: true },
  CENTEREXE: { kind: 'distance', nonNegative: true },
  CENTERMARKEXE: { kind: 'switch' },
  CENTERLTYPE: { kind: 'text', dot: true },
  CENTERLTSCALE: { kind: 'real', positive: true },
  CENTERLAYER: { kind: 'text', dot: true },
  // M4-10 part 3 (AutoCAD 2024 Help, "FIELDEVAL"): when fields update, bits 1 open, 2 save,
  // 4 plot, 8 eTransmit, 16 regeneration; "Saved in: Drawing", initially 31 (edit/field-eval.ts).
  [FIELDEVAL]: { kind: 'integer', min: 0, max: 31 },
};

/**
 * DICTIONARYVARs SETVAR knows in a drawing without them, with AutoCAD's initial value, which a
 * save writes only into a DICTIONARYVAR the drawing has (io's session-only variables).
 */
const DICTIONARY_INITIAL: Readonly<Record<string, string | ((m: VariableSource) => string)>> = {
  [FIELDEVAL]: String(FIELDEVAL_INITIAL),
  ...CENTER_VARIABLES,
};

/** Bounds AutoCAD 2024's system variable reference gives (those a wrong value would break). */
const RANGES: Readonly<Record<string, readonly [number, number]>> = {
  LUNITS: [1, 5],
  LUPREC: [0, 8],
  AUNITS: [0, 4],
  AUPREC: [0, 8],
  ANGDIR: [0, 1],
  // Degrees: the Modify Dimension Style dialog's Jog angle takes 5 to 90.
  DIMJOGANG: [5, 90],
  ATTMODE: [0, 2],
  ATTREQ: [0, 1],
  ATTDIA: [0, 1],
  FILLMODE: [0, 1],
  MIRRTEXT: [0, 1],
  QTEXTMODE: [0, 1],
  PSLTSCALE: [0, 1],
  PLINEGEN: [0, 1],
  INSUNITS: [0, 24],
  MEASUREMENT: [0, 1],
  DIMDEC: [0, 8],
  DIMADEC: [-1, 8],
  DIMTDEC: [0, 8],
  DIMALTD: [0, 8],
  DIMALTTD: [0, 8],
  DIMASSOC: [0, 2],
  DIMCLRD: [0, 256],
  DIMCLRE: [0, 256],
  DIMCLRT: [0, 256],
  DIMTFILL: [0, 2],
  DIMTFILLCLR: [0, 256],
  DIMTAD: [0, 4],
  DIMJUST: [0, 4],
  DIMATFIT: [0, 3],
  DIMTMOVE: [0, 2],
  DIMLUNIT: [1, 6],
  DIMAUNIT: [0, 4],
  DIMFRAC: [0, 2],
  DIMTOLJ: [0, 2],
  DIMARCSYM: [0, 2],
  STEPSPERSEC: [1, 30],
};

/** Reals AutoCAD takes only above zero, and those it takes from zero up. */
const POSITIVE = new Set(['LTSCALE', 'CELTSCALE', 'TEXTSIZE', 'DIMTXT']);
const NON_NEGATIVE = new Set(['DIMSCALE', 'DIMASZ', 'DIMEXO', 'DIMEXE', 'DIMDLI', 'DIMTSZ']);

const LINEWEIGHT_VARIABLES = new Set(['CELWEIGHT', 'DIMLWD', 'DIMLWE']);

/**
 * The header's lengths (AutoCAD 2024 Help, each variable's page: a "Real" that is a distance in
 * drawing units), which SETVAR shows and reads in the drawing's units as AutoCAD's prompts for
 * them do (M2-35 part 23). Factors (LTSCALE, DIMSCALE, DIMLFAC, CMLSCALE), PDSIZE (negative is a
 * percentage of the screen) and the alternate units' DIMALTRND (in alternate units) stay plain
 * reals. DIMCEN and DIMGAP keep their sign (negative: centre lines, a box around the text).
 */
// prettier-ignore
const DISTANCE_VARIABLES = new Set([
  'TEXTSIZE', 'TRACEWID', 'PLINEWID', 'FILLETRAD', 'CHAMFERA', 'CHAMFERB', 'CHAMFERC',
  'ELEVATION', 'PELEVATION', 'THICKNESS', 'SKETCHINC', 'DIMTXT', 'DIMASZ', 'DIMEXO', 'DIMEXE',
  'DIMDLI', 'DIMDLE', 'DIMTSZ', 'DIMCEN', 'DIMGAP', 'DIMRND', 'DIMTP', 'DIMTM', 'DIMFXL',
]);

/**
 * The header's angles (M2-35 part 24), kept in radians as AutoCAD keeps them, which SETVAR shows
 * and takes in the drawing's angular units (ANGTOS, `formatAngle`; typed as at any angle prompt,
 * `parseAngleValue`): ANGBASE, the chamfer angle, the snap angle and the jogged radius
 * dimension's jog angle. A typed angle is the variable's value, counter-clockwise from world +X:
 * ANGBASE and ANGDIR turn angles typed at a command's prompts, not the variables' own values
 * (AutoCAD 2024 Help is silent on SETVAR ANGBASE under ANGDIR 1; ANGBASE 90 meaning north
 * whatever ANGDIR says is what the UNITS dialog's Direction shows).
 */
const ANGLE_VARIABLES = new Set(['ANGBASE', 'CHAMFERD', 'SNAPANG', 'DIMJOGANG']);

/** The variable a header entry is, from the value the drawing holds. */
function headerVariable(key: string, value: HeaderValue): SystemVariable {
  const name = key.startsWith('$') ? key.slice(1) : key;
  const base = { name, store: 'header' as const, key };
  if (READ_ONLY_HEADER.has(name) || READ_ONLY_PATTERN.test(name)) {
    return { ...base, kind: kindOf(name, value), readOnly: true };
  }
  if (!key.startsWith('$')) {
    // AcDbVariableDictionary entries hold text; Triya sets those it understands.
    const known = DICTIONARY_VARIABLES[name];
    if (!known) return { ...base, kind: 'text', readOnly: true };
    const numeric =
      known.kind === 'integer' ||
      known.kind === 'switch' ||
      known.kind === 'real' ||
      known.kind === 'distance';
    return { ...base, ...known, ...(numeric && { text: true as const }) };
  }
  const named = NAME_VARIABLES[name];
  if (named) {
    return { ...base, kind: 'name', table: named.table, ...(named.empty && { empty: true }) };
  }
  const kind = kindOf(name, value);
  const range = RANGES[name];
  return {
    ...base,
    kind,
    ...(range && { min: range[0], max: range[1] }),
    ...(POSITIVE.has(name) && { positive: true }),
    ...(NON_NEGATIVE.has(name) && { nonNegative: true }),
  };
}

function kindOf(name: string, value: HeaderValue): VariableKind {
  if (name === 'CECOLOR') return 'color';
  if (LINEWEIGHT_VARIABLES.has(name)) return 'lineweight';
  if (ANGLE_VARIABLES.has(name) && typeof value === 'number') return 'angle';
  if (typeof value === 'boolean') return 'switch';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'object') return 'point';
  if (INTEGER_HEADER_VARIABLES.has(name)) return 'integer';
  return DISTANCE_VARIABLES.has(name) ? 'distance' : 'real';
}

/**
 * The DICTIONARYVAR a HEADER variable has beside it, which SETVAR sets with it (M2-59 part 4):
 * AutoCAD's files state HIDETEXT, XCLIPFRAME, DIMASSOC, INDEXCTL and SORTENTS in both places.
 */
export function dictionaryTwin(
  model: DocumentModel,
  v: SystemVariable,
): SystemVariable | undefined {
  if (v.store !== 'header' || !v.key?.startsWith('$') || !model.header.has(v.name))
    return undefined;
  const twin = headerVariable(v.name, model.header.get(v.name)!);
  return twin.readOnly ? undefined : twin;
}

/**
 * What finding a variable needs of a drawing: its header. The app passes the header its change
 * sets left (the command line's autocomplete, M2-59 part 5), the engine its model.
 */
export interface VariableSource {
  readonly header: ReadonlyMap<string, HeaderValue>;
  /** How the drawing was opened (CENTEREXE starts at 3.5 in a metric one). */
  readonly meta?: { readonly measurement?: 'imperial' | 'metric' };
}

/** The header entry a variable's name is kept under, if the drawing has one. */
function headerKey(model: VariableSource, name: string): string | undefined {
  if (model.header.has(`$${name}`)) return `$${name}`;
  // A bare name is an AcDbVariableDictionary entry; `$` names are not variables of their own.
  return !name.startsWith('$') && model.header.has(name) ? name : undefined;
}

/**
 * The system variable `name` names (any case), or undefined when Triya keeps none of that name:
 * the app's first, then WIPEOUTFRAME and IMAGEFRAME, then the drawing's header.
 */
export function systemVariable(model: VariableSource, name: string): SystemVariable | undefined {
  const n = name.trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(n)) return undefined;
  const app = APP_VARIABLES.find((v) => v.name === n);
  if (app) return app;
  if (n === WIPEOUTFRAME.name) return WIPEOUTFRAME;
  if (n === IMAGEFRAME.name) return IMAGEFRAME;
  const vport = VPORT_VARIABLES.find((v) => v.name === n);
  if (vport) return vport;
  const known = COMPUTED_VARIABLES.find((v) => v.name === n);
  if (known) return known;
  const drawing = DRAWING_VARIABLES.find((v) => v.name === n);
  if (drawing) return drawing;
  const key = headerKey(model, n);
  if (key === undefined && n in DICTIONARY_INITIAL) {
    const start = DICTIONARY_INITIAL[n]!;
    const initial = typeof start === 'string' ? start : start(model);
    return { ...headerVariable(n, initial), initial };
  }
  return key === undefined ? undefined : headerVariable(key, model.header.get(key)!);
}

/** Every variable Triya keeps for this drawing, by name. */
export function systemVariables(model: VariableSource): SystemVariable[] {
  const out = new Map<string, SystemVariable>();
  for (const key of model.header.keys()) {
    const v = systemVariable(model, key.replace(/^\$/, ''));
    if (v) out.set(v.name, v);
  }
  out.set(WIPEOUTFRAME.name, WIPEOUTFRAME);
  out.set(IMAGEFRAME.name, IMAGEFRAME);
  for (const name of Object.keys(DICTIONARY_INITIAL)) {
    const v = systemVariable(model, name);
    if (v) out.set(v.name, v);
  }
  for (const v of [
    ...APP_VARIABLES,
    ...VPORT_VARIABLES,
    ...COMPUTED_VARIABLES,
    ...DRAWING_VARIABLES,
  ]) {
    out.set(v.name, v);
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A variable's value as SETVAR shows and keeps it: numbers, text or a point. */
export type VariableValue =
  number | string | { readonly x: number; readonly y: number; readonly z?: number };

/** The value a header variable holds, as SETVAR shows it (a switch as 0 or 1, an angle in degrees). */
export function headerValue(v: SystemVariable, value: HeaderValue): VariableValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  // A DICTIONARYVAR's number; text that is none is shown as it is.
  if (v.text && typeof value === 'string' && NUMBER.test(value.trim())) return Number(value);
  if (v.kind === 'angle' && typeof value === 'number') return (value * 180) / Math.PI;
  return value;
}

/** The header value SETVAR's `value` is kept as: the type the drawing holds it in. */
export function headerEntry(
  v: SystemVariable,
  value: VariableValue,
  was: HeaderValue | undefined,
): HeaderValue {
  if (typeof was === 'boolean') return value === 1;
  // AutoCAD writes a DICTIONARYVAR's real with six places (CENTEREXE "3.500000").
  if (v.text && typeof value === 'number') {
    return v.kind === 'real' || v.kind === 'distance' ? value.toFixed(6) : String(value);
  }
  if (v.kind === 'angle' && typeof value === 'number') return (value * Math.PI) / 180;
  if (typeof value === 'object' && was && typeof was === 'object' && 'z' in was) {
    return { x: value.x, y: value.y, z: value.z ?? 0 };
  }
  if (typeof value === 'object') return { x: value.x, y: value.y };
  return value;
}

const COLOR_NAMES = ['RED', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'MAGENTA', 'WHITE'];

/**
 * A value as the command line shows it: `0`, `1.0000`, `"Standard"`, a length and a point's
 * coordinates in the drawing's units (`0.0000,0.0000`, `0'-0 3/16"`); a real with LUPREC places,
 * an angle with AUPREC.
 */
export function formatValue(v: SystemVariable, value: VariableValue, u: DrawingUnits): string {
  if (typeof value === 'object') {
    const xs = [value.x, value.y, ...(value.z === undefined ? [] : [value.z])];
    return xs.map((x) => (v.pixels ? formatNumber(x, u.luprec) : formatDistance(x, u))).join(',');
  }
  if (typeof value === 'string') return `"${value}"`;
  switch (v.kind) {
    case 'color':
      return `"${value === 256 ? 'BYLAYER' : value === 0 ? 'BYBLOCK' : value}"`;
    case 'angle':
      // Held in degrees here (`headerValue`); ANGTOS takes it into one turn (-90 shows 270).
      return formatAngle((value * Math.PI) / 180, u);
    case 'real':
      return formatNumber(value, v.places ?? u.luprec);
    case 'distance':
      return formatDistance(value, u);
    default:
      return formatNumber(value, 0);
  }
}

/** What typed text sets a variable to, or why it cannot. */
export type ParsedValue = { readonly value: VariableValue } | { readonly problem: string };

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

const between = (v: SystemVariable): string => `Value must be between ${v.min} and ${v.max}.`;

/** A record's name as its table spells it, or undefined when it has none of that name. */
function recordName(model: DocumentModel, table: NameTable, typed: string): string | undefined {
  const key = typed.toUpperCase();
  const records =
    table === 'annotationScales'
      ? (model.meta.annotationScales ?? [])
      : table === 'layouts'
        ? model.layouts
        : model.tables[table].values();
  for (const r of records) {
    if (r.name.toUpperCase() === key) return r.name;
  }
  return undefined;
}

const TABLE_WORDS: Readonly<Record<NameTable, string>> = {
  layers: 'layer',
  linetypes: 'linetype',
  textStyles: 'text style',
  dimStyles: 'dimension style',
  blockRecords: 'block',
  mlineStyles: 'multiline style',
  mleaderStyles: 'multileader style',
  tableStyles: 'table style',
  annotationScales: 'annotation scale',
  layouts: 'layout',
};

/** CANNOSCALEVALUE for a CANNOSCALE of `name`: the scale's value, when the drawing has it. */
export function annotationScaleValue(model: DocumentModel, name: string): number | undefined {
  return model.meta.annotationScales?.find((s) => s.name === name)?.value;
}

/** Typed text as a value of `v` (not a point: a point prompt parses those). */
export function parseValue(model: DocumentModel, v: SystemVariable, text: string): ParsedValue {
  const t = text.trim();
  switch (v.kind) {
    case 'text':
      if (v.relative && !isCenterLength(t)) {
        return { problem: 'Requires a length, or a factor of the diameter followed by x.' };
      }
      if (v.relative || v.dot) return { value: t };
      // "." sets text to nothing, as AutoCAD takes it (DIMPOST, DIMAPOST).
      return { value: t === '.' ? '' : text };
    case 'name': {
      if (t === '.' || t === '') {
        return v.empty ? { value: '' } : { problem: `${v.name} cannot name nothing.` };
      }
      const name = recordName(model, v.table!, t);
      if (name === undefined) return { problem: `No ${TABLE_WORDS[v.table!]} named "${t}".` };
      if (v.table === 'layers') {
        const layer = [...model.tables.layers.values()].find((l) => l.name === name);
        if (layer?.frozen) return { problem: 'Cannot set a frozen layer current.' };
      }
      return { value: name };
    }
    case 'color': {
      const u = t.toUpperCase();
      if (u === 'BYLAYER') return { value: 256 };
      if (u === 'BYBLOCK') return { value: 0 };
      const named = COLOR_NAMES.indexOf(u);
      if (named >= 0) return { value: named + 1 };
      const n = Number(t);
      if (NUMBER.test(t) && Number.isInteger(n) && n >= 0 && n <= 256) return { value: n };
      return { problem: 'Invalid color.' };
    }
    case 'transparency': {
      const u = t.toUpperCase();
      if (u === 'BYLAYER') return { value: 'ByLayer' };
      if (u === 'BYBLOCK') return { value: 'ByBlock' };
      const n = Number(t);
      if (NUMBER.test(t) && Number.isInteger(n) && n >= 0 && n <= 90) return { value: String(n) };
      return { problem: 'Value must be ByLayer, ByBlock or between 0 and 90.' };
    }
    case 'distance': {
      // Typed as any length prompt takes one (`parseDistance`): feet and inches, fractions or
      // a sum. AutoCAD's own refusal at a distance prompt adds "or two points"; SETVAR takes
      // no picked points here.
      const n = parseDistance(t, drawingUnits(model.header).lunits);
      if (n === undefined) return { problem: 'Requires numeric distance.' };
      return bounded(v, n);
    }
    case 'angle': {
      // Typed as any angle prompt takes one: decimal degrees whatever AUNITS says, `45d30'`,
      // `0.5r`, `50g` or a bearing. AutoCAD's refusal at an angle prompt adds "or second point";
      // SETVAR takes no picked points here.
      const a = parseAngleValue(t);
      if (a === undefined) return { problem: 'Requires valid numeric angle.' };
      return bounded(v, (a * 180) / Math.PI);
    }
    default:
      break;
  }
  if (!NUMBER.test(t)) {
    return {
      problem:
        v.kind === 'integer' || v.kind === 'switch' || v.kind === 'lineweight'
          ? 'Requires an integer value.'
          : 'Requires numeric value.',
    };
  }
  const n = Number(t);
  switch (v.kind) {
    case 'switch':
      if (!Number.isInteger(n)) return { problem: 'Requires an integer value.' };
      return n === 0 || n === 1 ? { value: n } : { problem: 'Value must be between 0 and 1.' };
    case 'lineweight':
      if (!Number.isInteger(n)) return { problem: 'Requires an integer value.' };
      return n === -1 || n === -2 || n === -3 || LINEWEIGHT_VALUES.includes(n)
        ? { value: n }
        : { problem: 'Invalid lineweight.' };
    case 'integer':
      if (!Number.isInteger(n)) return { problem: 'Requires an integer value.' };
      // DXF keeps these in 16 bits (group codes 70, 280): what AutoCAD's integers hold.
      if (v.min === undefined && (n < -32768 || n > 32767)) {
        return { problem: 'Value must be between -32768 and 32767.' };
      }
      break;
    default:
      break;
  }
  return bounded(v, n);
}

/** A number `v` takes, or why not: its choices, range and sign. */
function bounded(v: SystemVariable, n: number): ParsedValue {
  if (v.choices && !v.choices.includes(n)) {
    return { problem: `Value must be one of ${v.choices.join(', ')}.` };
  }
  if (v.min !== undefined && v.max !== undefined && (n < v.min || n > v.max)) {
    return { problem: between(v) };
  }
  if (v.positive && !(n > 0)) return { problem: 'Value must be positive and nonzero.' };
  if (v.nonNegative && n < 0) return { problem: 'Value must be positive or zero.' };
  return { value: n };
}
