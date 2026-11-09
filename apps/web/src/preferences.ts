// The user's settings (M2-20, UI_SPEC.md §6): the chrome theme, the canvas colours, how the
// status bar shows coordinates, Dynamic Input (DYNMODE) and the object snap settings. AutoCAD
// keeps these per user (its registry profile), not in a drawing, so Triya keeps them on the
// device, in IndexedDB (`triya-settings`, ARCHITECTURE.md §13), until "Clear all local data".
// ORTHO, SNAP, GRID, LWT and TPY are each drawing's own in AutoCAD (ORTHOMODE, SNAPMODE,
// GRIDMODE, LWDISPLAY, TRANSPARENCYDISPLAY) and stay per session, as M2-04 built them.
import { OSMODE_DEFAULT, OSNAP_OFF } from '@triya/engine';
import type { Drafting, DraftingState } from './drafting';
import type { DynMode } from './dynamic-input';
import { closeOnDelete } from './local-data';

/** The chrome's colours: the system's light or dark setting, or one of them always. */
export type Theme = 'system' | 'light' | 'dark';

/**
 * The status bar's coordinates: in the drawing's units (LUNITS and LUPREC, as AutoCAD shows
 * them) or always decimal at LUPREC places.
 */
export type CoordinateDisplay = 'drawing' | 'decimal';

/** The canvas colours (UI_SPEC.md §6), `#rrggbb`. */
export interface CanvasColours {
  /** Model space's background. */
  readonly model: string;
  /** A layout's sheet of paper. */
  readonly paper: string;
  /** Around a layout's sheet. */
  readonly surround: string;
  /** The grid's major lines (F7); undefined mixes it from the background and ACI 7. */
  readonly grid: string | undefined;
  /** The selection highlight and grips' outline. */
  readonly selection: string;
}

/** The drafting settings AutoCAD keeps per user. */
export type DraftingPreferences = Pick<
  DraftingState,
  'osmode' | 'polar' | 'polarAngle' | 'otrack' | 'markerSize' | 'aperture' | 'pdfOsnap'
>;

export interface Preferences {
  readonly theme: Theme;
  readonly canvas: CanvasColours;
  readonly coordinates: CoordinateDisplay;
  /** DYNMODE on (F12). */
  readonly dynMode: boolean;
  readonly drafting: DraftingPreferences;
}

/** POLARANG's choices in AutoCAD's Drafting Settings, degrees. */
export const POLAR_ANGLES = [90, 45, 30, 22.5, 18, 15, 10, 5] as const;
/** AUTOSNAPSIZE's and APERTURE's ranges, pixels (AutoCAD 2024 system variable reference). */
export const MARKER_SIZES = { min: 1, max: 20 } as const;
export const APERTURES = { min: 1, max: 50 } as const;

export const DEFAULT_CANVAS: CanvasColours = {
  model: '#212830',
  paper: '#ffffff',
  surround: '#8a8f98',
  grid: undefined,
  selection: '#4da3ff',
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  canvas: DEFAULT_CANVAS,
  coordinates: 'drawing',
  dynMode: true,
  drafting: {
    osmode: OSMODE_DEFAULT,
    polar: true,
    polarAngle: 90,
    otrack: true,
    markerSize: 5,
    aperture: 10,
    pdfOsnap: true,
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hex = (v: unknown): string | undefined =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function int(v: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(v)));
}

/** A stored record as preferences: whatever is missing or not valid takes its default. */
export function normalizePreferences(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES;
  if (!isRecord(raw)) return d;
  const c = isRecord(raw['canvas']) ? raw['canvas'] : {};
  const k = isRecord(raw['drafting']) ? raw['drafting'] : {};
  const theme = raw['theme'];
  const coordinates = raw['coordinates'];
  const osmode = k['osmode'];
  const polarAngle = k['polarAngle'];
  return {
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : d.theme,
    canvas: {
      model: hex(c['model']) ?? d.canvas.model,
      paper: hex(c['paper']) ?? d.canvas.paper,
      surround: hex(c['surround']) ?? d.canvas.surround,
      grid: hex(c['grid']),
      selection: hex(c['selection']) ?? d.canvas.selection,
    },
    coordinates: coordinates === 'decimal' ? 'decimal' : 'drawing',
    dynMode: bool(raw['dynMode'], d.dynMode),
    drafting: {
      // OSMODE's 14 mode bits and OSNAP_OFF.
      osmode:
        typeof osmode === 'number' && Number.isInteger(osmode) && osmode >= 0
          ? osmode & (0x3fff | OSNAP_OFF)
          : d.drafting.osmode,
      polar: bool(k['polar'], d.drafting.polar),
      polarAngle: (POLAR_ANGLES as readonly unknown[]).includes(polarAngle)
        ? (polarAngle as number)
        : d.drafting.polarAngle,
      otrack: bool(k['otrack'], d.drafting.otrack),
      markerSize: int(k['markerSize'], MARKER_SIZES, d.drafting.markerSize),
      aperture: int(k['aperture'], APERTURES, d.drafting.aperture),
      pdfOsnap: bool(k['pdfOsnap'], d.drafting.pdfOsnap),
    },
  };
}

export interface PreferencesPersistence {
  load(): Promise<unknown>;
  save(p: Preferences): Promise<void>;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class PreferencesStore {
  readonly #persistence: PreferencesPersistence;
  #state: Preferences = DEFAULT_PREFERENCES;
  /** The keys changed this session before the stored record arrived: they win over it. */
  readonly #touched = new Set<keyof Preferences>();
  #loaded = false;
  readonly #listeners = new Set<() => void>();

  constructor(persistence: PreferencesPersistence) {
    this.#persistence = persistence;
  }

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  get = (): Preferences => this.#state;

  async load(): Promise<void> {
    const raw = await this.#persistence.load().catch(() => undefined);
    const stored = normalizePreferences(raw);
    const next = { ...stored };
    for (const key of this.#touched) Object.assign(next, { [key]: this.#state[key] });
    this.#loaded = true;
    this.#set(next);
  }

  /** Changes some settings and saves them; a change that changes nothing is no change. */
  update(patch: Partial<Preferences>): void {
    const next = normalizePreferences({ ...this.#state, ...patch });
    if (same(next, this.#state)) return;
    if (!this.#loaded)
      for (const k of Object.keys(patch)) this.#touched.add(k as keyof Preferences);
    this.#set(next);
    // A store that cannot be written keeps the settings for this session only.
    void this.#persistence.save(next).catch(() => undefined);
  }

  #set(next: Preferences): void {
    this.#state = next;
    for (const l of this.#listeners) l();
  }
}

/** The persisted part of the status bar's drafting state. */
export function draftingPreferences(s: DraftingState): DraftingPreferences {
  return {
    osmode: s.osmode,
    polar: s.polar,
    polarAngle: s.polarAngle,
    otrack: s.otrack,
    markerSize: s.markerSize,
    aperture: s.aperture,
    pdfOsnap: s.pdfOsnap,
  };
}

/**
 * Keeps Dynamic Input and the drafting aids in step with the stored settings: the stored ones
 * apply when they arrive and whenever Settings changes them, and F12, F3 and the status bar's
 * buttons are remembered.
 */
export function bindPreferences(store: PreferencesStore, drafting: Drafting, dyn: DynMode): void {
  const apply = () => {
    const p = store.get();
    dyn.set(p.dynMode);
    const now = draftingPreferences(drafting.get());
    if (!same(now, p.drafting)) drafting.configure(p.drafting);
  };
  store.subscribe(apply);
  dyn.subscribe(() => store.update({ dynMode: dyn.get() }));
  drafting.subscribe(() => store.update({ drafting: draftingPreferences(drafting.get()) }));
}

/** The settings in this browser's IndexedDB (database `triya-settings`, one row). */
export function indexedDbPreferences(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): PreferencesPersistence {
  const DB = 'triya-settings';
  const STORE = 'settings';
  const KEY = 'preferences';
  let db: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('IndexedDB is unavailable'));
    db ??= new Promise((resolve, reject) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(closeOnDelete(r.result, () => (db = undefined)));
      r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    });
    return db;
  };
  const request = <T>(r: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
    });
  return {
    load: async () =>
      request((await open()).transaction(STORE, 'readonly').objectStore(STORE).get(KEY)),
    save: async (p) => {
      await request((await open()).transaction(STORE, 'readwrite').objectStore(STORE).put(p, KEY));
    },
  };
}
