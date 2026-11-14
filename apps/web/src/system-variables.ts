// The system variables the app keeps (M2-42, the engine's `APP_VARIABLES`): SETVAR, or a
// variable's name typed at `Command:`, asks for them through the view host. They are the status
// bar's drafting aids (ORTHOMODE, SNAPMODE, GRIDMODE, OSMODE, POLARANG, LWDISPLAY,
// TRANSPARENCYDISPLAY) and the per-user settings (APERTURE, PDFOSNAP, REVCLOUDGRIPS, QPMODE,
// QPLOCATION), so a value
// set here is the one the status bar shows and Settings stores, as AutoCAD's F8 and ORTHOMODE
// are one setting. The engine has checked a value against the variable's range already.
// M2-59 adds the rest of AutoCAD's registry settings Triya has: AUTOSNAP (its POLAR and OTRACK
// bits are the status bar's buttons), AUTOSNAPSIZE (Settings' marker size), DYNMODE (F12) and
// PICKFIRST.
// The app also tells the read-only variables of the drawing (M2-59, the engine's
// `DRAWING_VARIABLES`): its file name and whether it has unsaved changes.
import type { ViewReply } from '@triya/engine';
import {
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
};

/** The variables kept as one value of the drafting state. */
const VALUES: Readonly<
  Record<string, { get(s: DraftingState): number; set(v: number): Partial<DraftingState> }>
> = {
  OSMODE: { get: (s) => s.osmode, set: (osmode) => ({ osmode }) },
  POLARANG: { get: (s) => s.polarAngle, set: (polarAngle) => ({ polarAngle }) },
  APERTURE: { get: (s) => s.aperture, set: (aperture) => ({ aperture }) },
  PDFOSNAP: { get: (s) => bit(s.pdfOsnap), set: (v) => ({ pdfOsnap: v === 1 }) },
  REVCLOUDGRIPS: { get: (s) => bit(s.revcloudGrips), set: (v) => ({ revcloudGrips: v === 1 }) },
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
};

/**
 * DYNMODE (AutoCAD 2024 Help): 1 pointer input, 2 dimensional input, 3 both, 0 neither, and a
 * negative value off (F12) keeping what turns back on. Triya's Dynamic Input tooltip is pointer
 * and dimensional input at once, so it reads 3 while on and −3 while off, and any positive value
 * turns it on (the common drafter's use: DYNMODE 0 or 1 in a script to turn it off or on).
 */
function dynModeReply(dyn: DynMode, value: number | undefined): ViewReply {
  if (value !== undefined) dyn.set(value > 0);
  return { ok: true, value: dyn.get() ? 3 : -3 };
}

/** Reads, or sets and then reads, a variable the app keeps. */
export function systemVariableReply(
  drafting: Drafting,
  name: string,
  value?: number,
  dyn: DynMode = dynMode,
): ViewReply {
  if (name === 'DYNMODE') return dynModeReply(dyn, value);
  const toggle = TOGGLES[name];
  if (toggle) {
    // A toggle turned as F8 turns it: ORTHOMODE 1 turns POLAR off, as in AutoCAD.
    if (value !== undefined && bit(drafting.isOn(toggle)) !== value) drafting.toggle(toggle);
    return { ok: true, value: bit(drafting.isOn(toggle)) };
  }
  const v = VALUES[name];
  if (!v) return { ok: false, message: `The app keeps no variable ${name}.` };
  if (value !== undefined && v.get(drafting.get()) !== value) drafting.configure(v.set(value));
  return { ok: true, value: v.get(drafting.get()) };
}

/** What the drawing variables are worked out from: the open document (documents.ts). */
export interface DrawingFacts {
  /** The file it was opened from or last saved as. */
  readonly name: string;
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
      return { ok: true, value: doc.name === '' ? 0 : 1 };
    case 'DBMOD':
      return { ok: true, value: doc.edits === doc.savedEdits ? 0 : 1 };
    default:
      return undefined;
  }
}
