// The status bar's drafting aids (M2-04): OSNAP (F3), GRID (F7), ORTHO (F8), SNAP (F9), POLAR
// (F10) and OTRACK (F11), with the running object snap modes (OSMODE), and the display toggles
// LWT and TPY. AutoCAD keeps OSMODE, AUTOSNAP and the polar settings per user (registry) and
// ORTHOMODE, SNAPMODE, GRIDMODE and LWDISPLAY in each drawing. Triya starts from AutoCAD's
// initial values (OSNAP on with Endpoint, Center, Intersection and Extension, POLAR on at 90°,
// OTRACK and TPY on, ORTHO and SNAP off) and keeps the per-user ones between sessions (M2-20,
// preferences.ts), the others per session. GRID starts off, so a drawing opens looking as it
// was drawn; LWT shows each drawing's own LWDISPLAY until the drafter turns it, and is then the
// same for every drawing. Nothing is written back to the file. The snap and grid spacing are
// each drawing's own (its *Active VPORT's SNAPUNIT and GRIDUNIT), read by the canvas.
import { OSMODE_DEFAULT, OSNAP, OSNAP_OFF, type OsnapMode } from '@triya/engine';

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
   * QPMODE (M2-35 part 16): Quick Properties shows for a selection while it is above 0, for all
   * objects (1) or only those with quick properties of their own (2). AutoCAD keeps it per user,
   * initially −1: a negative value is off and keeps the mode the QP button turns back on.
   */
  readonly qpmode: number;
  /** QPLOCATION: Quick Properties by the cursor (0) or where it was dragged (1). */
  readonly qpLocation: 0 | 1;
}

export type DraftingToggle =
  'osnap' | 'ortho' | 'polar' | 'snap' | 'otrack' | 'grid' | 'lwt' | 'tpy' | 'qp';

/** The function keys AutoCAD gives the toggles. */
export const DRAFTING_KEYS: Readonly<Record<string, DraftingToggle>> = {
  F3: 'osnap',
  F7: 'grid',
  F8: 'ortho',
  F9: 'snap',
  F10: 'polar',
  F11: 'otrack',
};

/** The toggles in the Ctrl+K palette, as its actions (`drafting:<toggle>`). */
export const DRAFTING_ITEMS = [
  { id: 'drafting:osnap', label: 'Object Snap on/off', keys: 'F3' },
  { id: 'drafting:grid', label: 'Grid Display on/off', keys: 'F7' },
  { id: 'drafting:ortho', label: 'Ortho Mode on/off', keys: 'F8' },
  { id: 'drafting:snap', label: 'Snap Mode on/off', keys: 'F9' },
  { id: 'drafting:polar', label: 'Polar Tracking on/off', keys: 'F10' },
  { id: 'drafting:otrack', label: 'Object Snap Tracking on/off', keys: 'F11' },
  { id: 'drafting:lwt', label: 'Show/Hide Lineweight', keys: '' },
  { id: 'drafting:tpy', label: 'Show/Hide Transparency', keys: '' },
  { id: 'drafting:qp', label: 'Quick Properties on/off', keys: 'Ctrl+Shift+P' },
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
  markerSize: 5,
  aperture: 10,
  pdfOsnap: true,
  revcloudGrips: true,
  qpmode: -1,
  qpLocation: 0,
};

/**
 * Whether a toggle is on: OSNAP is on while OSMODE has modes and no OSNAP_OFF; LWT is the
 * drawing's LWDISPLAY (`lwdisplay`) until the drafter turns it.
 */
export function isOn(s: DraftingState, t: DraftingToggle, lwdisplay = false): boolean {
  if (t === 'osnap') return (s.osmode & OSNAP_OFF) === 0 && s.osmode !== 0;
  if (t === 'lwt') return s.lwt ?? lwdisplay;
  if (t === 'qp') return s.qpmode > 0;
  return s[t];
}

export class Drafting {
  #state: DraftingState;
  /** The LWDISPLAY of the drawing shown, which LWT shows until the drafter turns it. */
  #drawingLwt = false;
  readonly #listeners = new Set<() => void>();

  constructor(initial: DraftingState = INITIAL_DRAFTING) {
    this.#state = initial;
  }

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): DraftingState => this.#state;

  isOn(t: DraftingToggle, lwdisplay = this.#drawingLwt): boolean {
    return isOn(this.#state, t, lwdisplay);
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
      case 'snap':
      case 'otrack':
      case 'grid':
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
    const next = { ...this.#state, ...patch };
    // ORTHO and POLAR cannot both be on; the stored POLAR wins over this session's ORTHO.
    if (patch.polar && next.ortho) next.ortho = false;
    this.#set(next);
  }

  #set(next: DraftingState): void {
    this.#state = next;
    for (const l of this.#listeners) l();
  }
}

export const drafting = new Drafting();
