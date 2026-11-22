// The system variables the app keeps (M2-42, the engine's `APP_VARIABLES`): SETVAR, or a
// variable's name typed at `Command:`, asks for them through the view host. They are the status
// bar's drafting aids (ORTHOMODE, SNAPMODE, GRIDMODE, OSMODE, POLARANG, LWDISPLAY,
// TRANSPARENCYDISPLAY) and the per-user settings (APERTURE, PDFOSNAP and UOSNAP, REVCLOUDGRIPS,
// QPMODE, QPLOCATION), so a value
// set here is the one the status bar shows and Settings stores, as AutoCAD's F8 and ORTHOMODE
// are one setting. The engine has checked a value against the variable's range already.
// M2-59 adds the rest of AutoCAD's registry settings Triya has: AUTOSNAP (its POLAR and OTRACK
// bits are the status bar's buttons), AUTOSNAPSIZE (Settings' marker size), DYNMODE (F12),
// PICKFIRST and GRIPSIZE (Settings' grip size, part 3). M2-35 part 21 adds ROLLOVERTIPS.
// The app also tells the read-only variables of the drawing (M2-59, the engine's
// `DRAWING_VARIABLES`): its file name and whether it has unsaved changes.
import type { ViewReply } from '@triya/engine';
import {
  INITIAL_SESSION_OPTIONS,
  MAX_ADDITIONAL_ANGLES,
  MODIFY_OPTIONS,
  additionalAngles,
  angleText,
  AUTOSNAP_KEPT,
  AUTOSNAP_OTRACK,
  AUTOSNAP_POLAR,
  type Drafting,
  type DraftingState,
  type DraftingToggle,
} from './drafting';
import { dynMode, type DynMode } from './dynamic-input';

const bit = (on: boolean): number => (on ? 1 : 0);

/** The variables that are a status bar toggle. */
const TOGGLES: Readonly<Record<string, DraftingToggle>> = {
  ORTHOMODE: 'ortho',
  SNAPMODE: 'snap',
  GRIDMODE: 'grid',
  LWDISPLAY: 'lwt',
  TRANSPARENCYDISPLAY: 'tpy',
  // M6-03: the status bar's Annotation Visibility.
  ANNOALLVISIBLE: 'annoVisible',
};

/** A grip colour variable (M3-05 part 5): one of the drafting state's grip colours. */
function gripColor(key: keyof DraftingState['gripColors']) {
  return {
    get: (s: DraftingState) => s.gripColors[key],
    set: (v: number, s: DraftingState): Partial<DraftingState> => ({
      gripColors: { ...s.gripColors, [key]: v },
    }),
  };
}

/** The variables kept as one value of the drafting state. */
const VALUES: Readonly<
  Record<
    string,
    { get(s: DraftingState): number; set(v: number, s: DraftingState): Partial<DraftingState> }
  >
> = {
  OSMODE: { get: (s) => s.osmode, set: (osmode) => ({ osmode }) },
  POLARANG: { get: (s) => s.polarAngle, set: (polarAngle) => ({ polarAngle }) },
  APERTURE: { get: (s) => s.aperture, set: (aperture) => ({ aperture }) },
  PDFOSNAP: { get: (s) => bit(s.pdfOsnap), set: (v) => ({ pdfOsnap: v === 1 }) },
  // UOSNAP sets the snapping of every underlay kind; Triya's are PDF underlays only (M5-04 part 20).
  UOSNAP: { get: (s) => bit(s.pdfOsnap), set: (v) => ({ pdfOsnap: v === 1 }) },
  REVCLOUDGRIPS: { get: (s) => bit(s.revcloudGrips), set: (v) => ({ revcloudGrips: v === 1 }) },
  // M5-19 part 3: whether new layers are evaluated at all, each drawing's engine told it.
  LAYEREVALCTL: { get: (s) => bit(s.layerEvalCtl), set: (v) => ({ layerEvalCtl: v === 1 }) },
  QPMODE: { get: (s) => s.qpmode, set: (qpmode) => ({ qpmode }) },
  QPLOCATION: { get: (s) => s.qpLocation, set: (v) => ({ qpLocation: v === 1 ? 1 : 0 }) },
  AUTOSNAP: {
    get: (s) => s.autosnap | (s.polar ? AUTOSNAP_POLAR : 0) | (s.otrack ? AUTOSNAP_OTRACK : 0),
    // Polar tracking set on turns ORTHO off, as F10 does (`Drafting.configure`).
    set: (v) => ({
      autosnap: v & AUTOSNAP_KEPT,
      polar: (v & AUTOSNAP_POLAR) !== 0,
      otrack: (v & AUTOSNAP_OTRACK) !== 0,
    }),
  },
  AUTOSNAPSIZE: { get: (s) => s.markerSize, set: (markerSize) => ({ markerSize }) },
  PICKFIRST: { get: (s) => bit(s.pickfirst), set: (v) => ({ pickfirst: v === 1 }) },
  GRIPSIZE: { get: (s) => s.gripSize, set: (gripSize) => ({ gripSize }) },
  // M3-05 part 5: the grip colours, ACIs (the engine has checked 1–255).
  GRIPCOLOR: gripColor('unselected'),
  GRIPHOVER: gripColor('hover'),
  GRIPHOT: gripColor('selected'),
  GRIPCONTOUR: gripColor('contour'),
  ROLLOVERTIPS: { get: (s) => bit(s.rolloverTips), set: (v) => ({ rolloverTips: v === 1 }) },
  POLARMODE: { get: (s) => s.polarMode, set: (polarMode) => ({ polarMode }) },
  // M3-06 part 3: PolarSnap's switch and distance (the engine has checked 0–1 and 0 or more).
  SNAPTYPE: { get: (s) => s.snapType, set: (v) => ({ snapType: v === 1 ? 1 : 0 }) },
  POLARDIST: { get: (s) => s.polarDist, set: (polarDist) => ({ polarDist }) },
  // M3-06 part 6: the dotted grid's bits (the engine has checked 0–7).
  GRIDSTYLE: { get: (s) => s.gridStyle, set: (gridStyle) => ({ gridStyle }) },
  TEMPOVERRIDES: { get: (s) => bit(s.tempOverrides), set: (v) => ({ tempOverrides: v === 1 }) },
  DYNPROMPT: { get: (s) => bit(s.dynPrompt), set: (v) => ({ dynPrompt: v === 1 }) },
  DYNPICOORDS: { get: (s) => s.dynPiCoords, set: (v) => ({ dynPiCoords: v === 1 ? 1 : 0 }) },
  DYNPIFORMAT: { get: (s) => s.dynPiFormat, set: (v) => ({ dynPiFormat: v === 1 ? 1 : 0 }) },
  // M7-06 part 3: the status bar's coordinates (the engine has checked 0–2); Ctrl+I toggles it.
  COORDS: { get: (s) => s.coords, set: (v) => ({ coords: v as 0 | 1 | 2 }) },
  // M3-06 part 8 (the engine has checked the ranges).
  DYNPIVIS: { get: (s) => s.dynPiVis, set: (v) => ({ dynPiVis: v as 0 | 1 | 2 }) },
  DYNDIVIS: { get: (s) => s.dynDiVis, set: (v) => ({ dynDiVis: v as 0 | 1 | 2 }) },
  DYNDIGRIP: { get: (s) => s.dynDiGrip, set: (dynDiGrip) => ({ dynDiGrip }) },
  DYNINFOTIPS: { get: (s) => bit(s.dynInfoTips), set: (v) => ({ dynInfoTips: v === 1 }) },
  SELECTSIMILARMODE: {
    get: (s) => s.selectSimilarMode,
    set: (selectSimilarMode) => ({ selectSimilarMode }),
  },
  SELECTIONCYCLING: {
    get: (s) => s.selectionCycling,
    set: (selectionCycling) => ({ selectionCycling }),
  },
  PICKSTYLE: { get: (s) => s.pickStyle, set: (pickStyle) => ({ pickStyle }) },
  GROUPDISPLAYMODE: {
    get: (s) => s.groupDisplayMode,
    set: (groupDisplayMode) => ({ groupDisplayMode }),
  },
  PICKBOX: { get: (s) => s.pickbox, set: (pickbox) => ({ pickbox }) },
  PICKADD: { get: (s) => s.pickadd, set: (pickadd) => ({ pickadd }) },
  PICKAUTO: { get: (s) => s.pickauto, set: (pickauto) => ({ pickauto }) },
  SELECTIONPREVIEW: {
    get: (s) => s.selectionPreview,
    set: (selectionPreview) => ({ selectionPreview }),
  },
  PREVIEWFILTER: { get: (s) => s.previewFilter, set: (previewFilter) => ({ previewFilter }) },
  SELECTIONPREVIEWLIMIT: {
    get: (s) => s.selectionPreviewLimit,
    set: (selectionPreviewLimit) => ({ selectionPreviewLimit }),
  },
  COMMANDPREVIEW: {
    get: (s) => s.commandPreview,
    set: (v) => ({ commandPreview: v === 1 ? 1 : 0 }),
  },
  ARRAYASSOCIATIVITY: {
    get: (s) => bit(s.arrayAssociativity),
    set: (v) => ({ arrayAssociativity: v === 1 }),
  },
  // M4-10 part 3: fields on a grey background, the canvas's (`RenderStyle.showFields`).
  FIELDDISPLAY: { get: (s) => bit(s.fieldDisplay), set: (v) => ({ fieldDisplay: v === 1 }) },
  // M5-06: locked layers' fading, the canvas's (`RenderStyle.layLockFade`); LAYISO sets it.
  LAYLOCKFADECTL: { get: (s) => s.layLockFade, set: (layLockFade) => ({ layLockFade }) },
  // M5-02 part 5: the fading of what is not in REFEDIT's working set (`RenderStyle.xFade`).
  XFADECTL: { get: (s) => s.xFade, set: (xFade) => ({ xFade }) },
  // M6-03: AutoScale is ANNOAUTOSCALE's sign (the engine has checked −4 to 4 but 0).
  ANNOAUTOSCALE: { get: (s) => s.annoAutoScale, set: (annoAutoScale) => ({ annoAutoScale }) },
  // M6-04 part 2: every plot follows it (`setPlotTransparencyOverride`; the engine checked 0–2).
  PLOTTRANSPARENCYOVERRIDE: {
    get: (s) => s.plotTransparencyOverride,
    set: (v) => ({ plotTransparencyOverride: v as 0 | 1 | 2 }),
  },
  // M6-06: what a new layout gets the first time it is shown (the engine's layout-init.ts).
  LAYOUTCREATEVIEWPORT: {
    get: (s) => bit(s.layoutCreateViewport),
    set: (v) => ({ layoutCreateViewport: v === 1 }),
  },
  SHOWPAGESETUPFORNEWLAYOUTS: {
    get: (s) => bit(s.showPageSetupForNewLayouts),
    set: (v) => ({ showPageSetupForNewLayouts: v === 1 }),
  },
  // M5-08 part 3: what Default draws as (the canvas's `RenderStyle.lineweightDefault`) and the
  // units lineweights are listed in; Lineweight Settings sets both.
  LWDEFAULT: { get: (s) => s.lwDefault, set: (lwDefault) => ({ lwDefault }) },
  LWUNITS: { get: (s) => s.lwUnits, set: (v) => ({ lwUnits: v === 0 ? 0 : 1 }) },
  // M5-04 part 2: how -XREF Bind binds (0 Bind, 1 Insert), for this session only.
  BINDTYPE: { get: (s) => s.bindType, set: (v) => ({ bindType: v === 1 ? 1 : 0 }) },
};

/**
 * DYNMODE (AutoCAD 2024 Help): 1 pointer input, 2 dimensional input, 3 both, 0 neither, and a
 * negative value off (F12) keeping what turns back on. The bits are the Dynamic Input tab's
 * (M3-06 part 4, `DraftingState.dynBits`) and F12 turns them on and off (`DynMode`), so 0 turns
 * Dynamic Input off keeping the bits it had, as AutoCAD's F12 brings them back.
 */
function dynModeReply(drafting: Drafting, dyn: DynMode, value: number | undefined): ViewReply {
  if (value !== undefined) {
    if (value !== 0 && drafting.get().dynBits !== Math.abs(value))
      drafting.configure({ dynBits: Math.abs(value) });
    dyn.set(value > 0);
  }
  const bits = drafting.get().dynBits;
  return { ok: true, value: dyn.get() || bits === 0 ? bits : -bits };
}

/**
 * POLARADDANG (M3-06 part 1): the additional angles as text, refused unless it is a list of up to
 * ten decimal angles separated by semicolons.
 */
function polarAddAngReply(drafting: Drafting, value: string | undefined): ViewReply {
  if (value !== undefined) {
    const angles = additionalAngles(value);
    if (!angles) {
      return {
        ok: false,
        message: `Requires up to ${MAX_ADDITIONAL_ANGLES} angles in degrees separated by semicolons.`,
      };
    }
    drafting.configure({ polarAddAngles: angles.map(angleText).join(';') });
  }
  return { ok: true, value: drafting.get().polarAddAngles };
}

/**
 * The modify commands' options (M3-12): those AutoCAD keeps per user in `modifyOptions`, which
 * Settings stores, OFFSETDIST, CHAMMODE and AFLAGS in `sessionOptions`, kept while the app runs.
 */
function optionReply(drafting: Drafting, name: string, value: number | undefined): ViewReply {
  const key = name in MODIFY_OPTIONS ? 'modifyOptions' : 'sessionOptions';
  const now = drafting.get()[key];
  if (value !== undefined && now[name] !== value) {
    drafting.configure({ [key]: { ...now, [name]: value } });
  }
  return { ok: true, value: drafting.get()[key][name]! };
}

/** Reads, or sets and then reads, a variable the app keeps. */
export function systemVariableReply(
  drafting: Drafting,
  name: string,
  value?: number | string,
  dyn: DynMode = dynMode,
): ViewReply {
  if (name === 'POLARADDANG')
    return polarAddAngReply(drafting, value === undefined ? undefined : String(value));
  if (typeof value === 'string') return { ok: false, message: `${name} takes a number.` };
  if (name === 'DYNMODE') return dynModeReply(drafting, dyn, value);
  if (name in MODIFY_OPTIONS || name in INITIAL_SESSION_OPTIONS) {
    return optionReply(drafting, name, value);
  }
  const toggle = TOGGLES[name];
  if (toggle) {
    // A toggle turned as F8 turns it: ORTHOMODE 1 turns POLAR off, as in AutoCAD.
    if (value !== undefined && bit(drafting.isOn(toggle)) !== value) drafting.toggle(toggle);
    return { ok: true, value: bit(drafting.isOn(toggle)) };
  }
  const v = VALUES[name];
  if (!v) return { ok: false, message: `The app keeps no variable ${name}.` };
  if (value !== undefined && v.get(drafting.get()) !== value)
    drafting.configure(v.set(value, drafting.get()));
  return { ok: true, value: v.get(drafting.get()) };
}

/** What the drawing variables are worked out from: the open document (documents.ts). */
export interface DrawingFacts {
  /** The file it was opened from or last saved as. */
  readonly name: string;
  /** A new drawing from a template (M5-10): named Drawing<n>.dxf, untitled until it is saved. */
  readonly untitled?: boolean;
  readonly edits: number;
  readonly savedEdits: number;
}

/**
 * DWGNAME, DWGPREFIX, DWGTITLED or DBMOD of a drawing (AutoCAD 2024 Help, "System Variables");
 * undefined for any other name. DWGPREFIX is always empty: a browser gives a page a file's name
 * but never its folder. DBMOD is 1 while the drawing has changes no save holds, the dirty dot on
 * its tab, and 0 otherwise: AutoCAD's bits say what kind of change it was (objects 1, variables
 * 4, …), which Triya does not track, and a script only asks whether it is zero.
 */
export function drawingVariableReply(doc: DrawingFacts, name: string): ViewReply | undefined {
  switch (name) {
    case 'DWGNAME':
      return { ok: true, value: doc.name === '' ? 'Drawing1.dxf' : doc.name };
    case 'DWGPREFIX':
      return { ok: true, value: '' };
    case 'DWGTITLED':
      return { ok: true, value: doc.name === '' || doc.untitled === true ? 0 : 1 };
    case 'DBMOD':
      return { ok: true, value: doc.edits === doc.savedEdits ? 0 : 1 };
    default:
      return undefined;
  }
}
