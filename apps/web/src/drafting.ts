// The status bar's drafting aids (M2-04): OSNAP (F3), ORTHO (F8), SNAP (F9) and POLAR (F10),
// with the running object snap modes (OSMODE). AutoCAD keeps OSMODE and the polar settings
// per user (registry) and ORTHOMODE and SNAPMODE in each drawing; Triya keeps them all per
// session for now, starting from AutoCAD's initial values (OSNAP on with Endpoint, Center,
// Intersection and Extension, POLAR on at 90°, ORTHO and SNAP off). Keeping them between
// sessions is M2-20's settings work; the snap spacing is each drawing's own (its *Active
// VPORT's SNAPUNIT), read by the canvas.
import { OSMODE_DEFAULT, OSNAP, OSNAP_OFF, type OsnapMode } from '@triya/engine';

export interface DraftingState {
  /** OSMODE: the running object snap modes, with OSNAP_OFF set while F3 has them off. */
  readonly osmode: number;
  readonly ortho: boolean;
  readonly polar: boolean;
  /** POLARANG, degrees. */
  readonly polarAngle: number;
  readonly snap: boolean;
}

export type DraftingToggle = 'osnap' | 'ortho' | 'polar' | 'snap';

/** The function keys AutoCAD gives the toggles. */
export const DRAFTING_KEYS: Readonly<Record<string, DraftingToggle>> = {
  F3: 'osnap',
  F8: 'ortho',
  F9: 'snap',
  F10: 'polar',
};

/** The toggles in the Ctrl+K palette, as its actions (`drafting:<toggle>`). */
export const DRAFTING_ITEMS = [
  { id: 'drafting:osnap', label: 'Object Snap on/off', keys: 'F3' },
  { id: 'drafting:ortho', label: 'Ortho Mode on/off', keys: 'F8' },
  { id: 'drafting:snap', label: 'Snap Mode on/off', keys: 'F9' },
  { id: 'drafting:polar', label: 'Polar Tracking on/off', keys: 'F10' },
].map((i) => ({ ...i, kind: 'action' as const, aliases: [] as string[] }));

export const INITIAL_DRAFTING: DraftingState = {
  osmode: OSMODE_DEFAULT,
  ortho: false,
  polar: true,
  polarAngle: 90,
  snap: false,
};

/** Whether a toggle is on: OSNAP is on while OSMODE has modes and no OSNAP_OFF. */
export function isOn(s: DraftingState, t: DraftingToggle): boolean {
  if (t === 'osnap') return (s.osmode & OSNAP_OFF) === 0 && s.osmode !== 0;
  return s[t];
}

export class Drafting {
  #state: DraftingState;
  readonly #listeners = new Set<() => void>();

  constructor(initial: DraftingState = INITIAL_DRAFTING) {
    this.#state = initial;
  }

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): DraftingState => this.#state;

  isOn(t: DraftingToggle): boolean {
    return isOn(this.#state, t);
  }

  toggle(t: DraftingToggle): void {
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
      case 'snap':
        return this.#set({ ...s, snap: !s.snap });
    }
  }

  /** Turns one running object snap mode on or off (the OSNAP button's menu). */
  setMode(mode: OsnapMode, on: boolean): void {
    const s = this.#state;
    const bit = OSNAP[mode];
    const modes = on ? (s.osmode | bit) & ~OSNAP_OFF : s.osmode & ~bit;
    this.#set({ ...s, osmode: modes });
  }

  #set(next: DraftingState): void {
    this.#state = next;
    for (const l of this.#listeners) l();
  }
}

export const drafting = new Drafting();
