// Temporary override keys (M3-06 part 5; AutoCAD 2024 Help, "TEMPOVERRIDES (System Variable)"
// and "Override Object Snap Settings"): held at a prompt for a point, a key turns a drafting aid
// the other way (Shift alone ORTHO, Shift+X POLAR, Shift+Q OTRACK, Shift+A OSNAP), turns every
// snap and tracking off (Shift+D) or the running object snaps on (Shift+S), or snaps to one mode
// only (Shift+E Endpoint, Shift+M Midpoint, Shift+C Center), until it is let go. The status bar
// keeps showing the aids as set, as AutoCAD's does. The keys are the keyboard map's
// (`keymap.ts`, group Temporary Override); `shortcuts.ts` presses and lets go of them here and
// the canvas draws with `withOverrides`.
import { OSNAP, OSNAP_OFF, type Prompt } from '@triya/engine';
import type { DraftingState } from './drafting';

export type OverrideKind =
  'ortho' | 'polar' | 'otrack' | 'osnap' | 'disable' | 'enforce' | 'END' | 'MID' | 'CEN';

const KINDS: ReadonlySet<string> = new Set<OverrideKind>([
  'ortho',
  'polar',
  'otrack',
  'osnap',
  'disable',
  'enforce',
  'END',
  'MID',
  'CEN',
]);

/** The override a keyboard map action holds (`override:END` → END), or undefined. */
export function overrideOf(id: string): OverrideKind | undefined {
  const kind = id.startsWith('override:') ? id.slice('override:'.length) : '';
  return KINDS.has(kind) ? (kind as OverrideKind) : undefined;
}

/** The drafting aids with the overrides held applied. */
export function withOverrides(d: DraftingState, held: readonly OverrideKind[]): DraftingState {
  if (held.length === 0) return d;
  let s = d;
  for (const k of held) {
    switch (k) {
      // ORTHO and POLAR cannot both be on, as with F8 and F10.
      case 'ortho':
        s = { ...s, ortho: !s.ortho, polar: s.ortho ? s.polar : false };
        break;
      case 'polar':
        s = { ...s, polar: !s.polar, ortho: s.polar ? s.ortho : false };
        break;
      case 'otrack':
        s = { ...s, otrack: !s.otrack };
        break;
      case 'osnap':
        s = { ...s, osmode: s.osmode ^ OSNAP_OFF };
        break;
      // "Disable All Snapping and Tracking": object snaps, grid snap, polar and object snap
      // tracking; ORTHO is no snap and stays.
      case 'disable':
        s = { ...s, osmode: s.osmode | OSNAP_OFF, polar: false, otrack: false, snap: false };
        break;
      // "Object Snap Enforcement": the running object snaps, even with OSNAP off.
      case 'enforce':
        s = { ...s, osmode: s.osmode & ~OSNAP_OFF };
        break;
      default:
        s = { ...s, osmode: OSNAP[k] };
    }
  }
  return s;
}

/**
 * Whether a prompt takes the override keys: one the canvas snaps and tracks for (a point, a
 * distance or an angle), not an object pick or a selection window's corner.
 */
export function takesOverrides(p: Prompt | undefined): boolean {
  if (p?.kind === 'distance' || p?.kind === 'angle') return true;
  return p?.kind === 'point' && !p.pickbox && !p.rubberBand?.selection;
}

/** The key that holds Shift alone's override. */
const SHIFT = 'Shift';

/** The override keys held now, by key (`KeyE`, `Shift` for Shift alone). */
export class HeldOverrides {
  readonly #held = new Map<string, OverrideKind>();
  readonly #listeners = new Set<() => void>();

  press(key: string, kind: OverrideKind): void {
    if (this.#held.get(key) === kind) return;
    this.#held.set(key, kind);
    this.#tell();
  }

  release(key: string): void {
    if (this.#held.delete(key)) this.#tell();
  }

  clear(): void {
    if (this.#held.size === 0) return;
    this.#held.clear();
    this.#tell();
  }

  /** The overrides that act: Shift alone's stands aside while a Shift+key one is held. */
  active(): readonly OverrideKind[] {
    const others = [...this.#held].filter(([k]) => k !== SHIFT).map(([, v]) => v);
    if (others.length > 0) return others;
    const shift = this.#held.get(SHIFT);
    return shift ? [shift] : [];
  }

  subscribe(l: () => void): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  #tell(): void {
    for (const l of this.#listeners) l();
  }
}

/** The override keys held in this window. */
export const heldOverrides = new HeldOverrides();
