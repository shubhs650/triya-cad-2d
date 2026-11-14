// The system variables the app keeps (M2-42, the engine's `APP_VARIABLES`): SETVAR, or a
// variable's name typed at `Command:`, asks for them through the view host. They are the status
// bar's drafting aids (ORTHOMODE, SNAPMODE, GRIDMODE, OSMODE, POLARANG, LWDISPLAY,
// TRANSPARENCYDISPLAY) and the per-user settings (APERTURE, PDFOSNAP, REVCLOUDGRIPS, QPMODE,
// QPLOCATION), so a value
// set here is the one the status bar shows and Settings stores, as AutoCAD's F8 and ORTHOMODE
// are one setting. The engine has checked a value against the variable's range already.
import type { ViewReply } from '@triya/engine';
import type { Drafting, DraftingState, DraftingToggle } from './drafting';

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
};

/** Reads, or sets and then reads, a variable the app keeps. */
export function systemVariableReply(drafting: Drafting, name: string, value?: number): ViewReply {
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
