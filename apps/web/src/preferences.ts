// The user's settings (M2-20, UI_SPEC.md §6): the chrome theme, the canvas colours, how the
// status bar shows coordinates, Dynamic Input (DYNMODE) and the object snap settings. AutoCAD
// keeps these per user (its registry profile), not in a drawing, so Triya keeps them on the
// device, in IndexedDB (`triya-settings`, ARCHITECTURE.md §13), until "Clear all local data".
// ORTHO, SNAP, GRID, LWT and TPY are each drawing's own in AutoCAD (ORTHOMODE, SNAPMODE,
// GRIDMODE, LWDISPLAY, TRANSPARENCYDISPLAY) and stay per session, as M2-04 built them.
import { GRIP_COLORS_DEFAULT, type GripColors } from '@triya/render';
import { LINEWEIGHTS, OSMODE_DEFAULT, OSNAP_OFF } from '@triya/engine';
import {
  AUTOSNAP_KEPT,
  INITIAL_MODIFY_OPTIONS,
  LWSCALE_RANGE,
  MODIFY_OPTIONS,
  QP_DISTANCES,
  QP_QUADRANTS,
  QP_ROW_COUNTS,
  additionalAngles,
  type Drafting,
  type DraftingState,
  type QpQuadrant,
} from './drafting';
import type { DynMode } from './dynamic-input';
import { normalizeKeyOverrides, type KeyOverrides } from './keymap';
import {
  DEFAULT_LAYER_COLUMNS,
  normalizeLayerColumns,
  type LayerColumnSettings,
} from './layer-columns';
import { closeOnDelete } from './local-data';
import { normalizeWords } from './custom-dictionary';
import { normalizeFilters, type NamedFilters } from './selection-filters';
import { DEFAULT_TEMPLATE_ID } from './templates';
import { DEFAULT_TOOLTIP, tooltipAppearanceOf } from './tooltip-appearance';
import { ALIAS_FILE_MAX } from './user-aliases';

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
  /**
   * The crosshairs, rubber band and ZOOM window (M2-20 part 2); undefined follows the
   * background as ACI 7 does.
   */
  readonly crosshair: string | undefined;
  /** The AutoSnap marker; undefined is amber on a dark background, deep amber on a light one. */
  readonly autosnap: string | undefined;
  /** The tracking paths (AutoTrack vector); undefined is light or deep blue by background. */
  readonly autotrack: string | undefined;
}

/** The drafting settings AutoCAD keeps per user. */
export type DraftingPreferences = Pick<
  DraftingState,
  | 'osmode'
  | 'polar'
  | 'polarAngle'
  | 'otrack'
  | 'markerSize'
  | 'aperture'
  | 'pdfOsnap'
  | 'revcloudGrips'
  | 'layerEvalCtl'
  | 'qpmode'
  | 'qpLocation'
  | 'autosnap'
  | 'pickfirst'
  | 'gripSize'
  | 'gripColors'
  | 'rolloverTips'
  | 'arrayAssociativity'
  | 'fieldDisplay'
  | 'layLockFade'
  | 'xFade'
  | 'annoAutoScale'
  | 'plotTransparencyOverride'
  | 'layoutCreateViewport'
  | 'showPageSetupForNewLayouts'
  | 'lwDefault'
  | 'lwUnits'
  | 'lwScale'
  | 'polarMode'
  | 'polarAddAngles'
  | 'snapType'
  | 'polarDist'
  | 'gridStyle'
  | 'tempOverrides'
  | 'dynBits'
  | 'dynPrompt'
  | 'dynPiCoords'
  | 'dynPiFormat'
  | 'dynPiVis'
  | 'dynDiVis'
  | 'dynDiGrip'
  | 'dynInfoTips'
  | 'tooltip'
  | 'selectSimilarMode'
  | 'selectionCycling'
  | 'pickStyle'
  | 'groupDisplayMode'
  | 'pickbox'
  | 'pickadd'
  | 'pickauto'
  | 'selectionPreview'
  | 'previewFilter'
  | 'selectionPreviewLimit'
  | 'commandPreview'
  | 'qpQuadrant'
  | 'qpDistance'
  | 'qpCollapse'
  | 'qpRows'
  | 'scLocation'
  | 'scQuadrant'
  | 'scDistance'
  | 'scTitleBar'
  | 'modifyOptions'
>;

export interface Preferences {
  readonly theme: Theme;
  readonly canvas: CanvasColours;
  readonly coordinates: CoordinateDisplay;
  /** DYNMODE on (F12). */
  readonly dynMode: boolean;
  readonly drafting: DraftingPreferences;
  /** FILTER's named filters (M3-04 part 4), AutoCAD's filter.nfl. */
  readonly filters: NamedFilters;
  /** The user alias file (M3-10, user-aliases.ts), acad.pgp syntax; '' for none. */
  readonly aliasFile: string;
  /** The user's shortcut keys over AutoCAD's defaults (M3-10 part 2, keymap.ts). */
  readonly keys: KeyOverrides;
  /** SPELL's custom dictionary (M4-09 part 4, custom-dictionary.ts), AutoCAD's .cus file. */
  readonly customDictionary: readonly string[];
  /** As-you-type spell checking in the text editors (M4-17, spell-check.ts); on by default. */
  readonly spellCheck: boolean;
  /** The Layer Properties Manager's columns and sort (M5-05 part 3, layer-columns.ts). */
  readonly layerColumns: LayerColumnSettings;
  /**
   * The template QNEW and the start screen's New drawing open (M5-10, templates.ts): its id, or
   * '' for none, when QNEW opens the Select Template dialog as AutoCAD's does.
   */
  readonly defaultTemplate: string;
}

/** POLARANG's choices in AutoCAD's Drafting Settings, degrees. */
export const POLAR_ANGLES = [90, 45, 30, 22.5, 18, 15, 10, 5] as const;
/** AUTOSNAPSIZE's and APERTURE's ranges, pixels (AutoCAD 2024 system variable reference). */
export const MARKER_SIZES = { min: 1, max: 20 } as const;
export const APERTURES = { min: 1, max: 50 } as const;
/** GRIPSIZE's range, pixels (M2-59 part 3). */
export const GRIP_SIZES = { min: 1, max: 255 } as const;

export const DEFAULT_CANVAS: CanvasColours = {
  model: '#212830',
  paper: '#ffffff',
  surround: '#8a8f98',
  grid: undefined,
  selection: '#4da3ff',
  crosshair: undefined,
  autosnap: undefined,
  autotrack: undefined,
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
    annoAutoScale: -4,
    plotTransparencyOverride: 1,
    layoutCreateViewport: true,
    showPageSetupForNewLayouts: false,
    lwDefault: 25,
    lwUnits: 1,
    lwScale: 1,
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
    scLocation: 0,
    scQuadrant: 'top-right',
    scDistance: 25,
    scTitleBar: true,
    modifyOptions: INITIAL_MODIFY_OPTIONS,
  },
  filters: {},
  aliasFile: '',
  keys: {},
  customDictionary: [],
  spellCheck: true,
  layerColumns: DEFAULT_LAYER_COLUMNS,
  defaultTemplate: DEFAULT_TEMPLATE_ID,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hex = (v: unknown): string | undefined =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** A whole number in `range`, else the fallback: a value out of range means another setting. */
function within(v: unknown, range: { min: number; max: number }, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= range.min && v <= range.max
    ? v
    : fallback;
}

/** The modify commands' options stored (M3-12): each one valid, else its initial value. */
function modifyOptions(v: unknown): Readonly<Record<string, number>> {
  const stored = isRecord(v) ? v : {};
  return Object.fromEntries(
    Object.entries(MODIFY_OPTIONS).map(([name, o]) => [
      name,
      within(stored[name], { min: 0, max: o.max }, o.initial),
    ]),
  );
}

function int(v: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(v)));
}

/** The grip colours stored (M3-05 part 5): each an ACI 1 to 255, else its initial value. */
function gripColors(v: unknown): GripColors {
  const stored = isRecord(v) ? v : {};
  const d = GRIP_COLORS_DEFAULT;
  const aci = { min: 1, max: 255 };
  return {
    unselected: within(stored['unselected'], aci, d.unselected),
    hover: within(stored['hover'], aci, d.hover),
    selected: within(stored['selected'], aci, d.selected),
    contour: within(stored['contour'], aci, d.contour),
  };
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
  const polarAddAngles = k['polarAddAngles'];
  const qpQuadrant = k['qpQuadrant'];
  const scQuadrant = k['scQuadrant'];
  return {
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : d.theme,
    canvas: {
      model: hex(c['model']) ?? d.canvas.model,
      paper: hex(c['paper']) ?? d.canvas.paper,
      surround: hex(c['surround']) ?? d.canvas.surround,
      grid: hex(c['grid']),
      selection: hex(c['selection']) ?? d.canvas.selection,
      crosshair: hex(c['crosshair']),
      autosnap: hex(c['autosnap']),
      autotrack: hex(c['autotrack']),
    },
    coordinates: coordinates === 'decimal' ? 'decimal' : 'drawing',
    dynMode: bool(raw['dynMode'], d.dynMode),
    filters: normalizeFilters(raw['filters']),
    aliasFile:
      typeof raw['aliasFile'] === 'string' && raw['aliasFile'].length <= ALIAS_FILE_MAX
        ? raw['aliasFile']
        : d.aliasFile,
    keys: normalizeKeyOverrides(raw['keys']),
    customDictionary: normalizeWords(raw['customDictionary']),
    spellCheck: bool(raw['spellCheck'], d.spellCheck),
    layerColumns: normalizeLayerColumns(raw['layerColumns']),
    defaultTemplate:
      typeof raw['defaultTemplate'] === 'string' && raw['defaultTemplate'].length <= 260
        ? raw['defaultTemplate']
        : d.defaultTemplate,
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
      gripSize: int(k['gripSize'], GRIP_SIZES, d.drafting.gripSize),
      gripColors: gripColors(k['gripColors']),
      pdfOsnap: bool(k['pdfOsnap'], d.drafting.pdfOsnap),
      revcloudGrips: bool(k['revcloudGrips'], d.drafting.revcloudGrips),
      layerEvalCtl: bool(k['layerEvalCtl'], d.drafting.layerEvalCtl),
      qpmode: within(k['qpmode'], { min: -2, max: 2 }, d.drafting.qpmode),
      qpLocation: within(k['qpLocation'], { min: 0, max: 1 }, d.drafting.qpLocation) as 0 | 1,
      // AUTOSNAP's bits but POLAR's and OTRACK's, which are kept as their toggles (M2-59).
      autosnap:
        typeof k['autosnap'] === 'number' && Number.isInteger(k['autosnap']) && k['autosnap'] >= 0
          ? k['autosnap'] & AUTOSNAP_KEPT
          : d.drafting.autosnap,
      pickfirst: bool(k['pickfirst'], d.drafting.pickfirst),
      rolloverTips: bool(k['rolloverTips'], d.drafting.rolloverTips),
      arrayAssociativity: bool(k['arrayAssociativity'], d.drafting.arrayAssociativity),
      fieldDisplay: bool(k['fieldDisplay'], d.drafting.fieldDisplay),
      layLockFade: within(k['layLockFade'], { min: -90, max: 90 }, d.drafting.layLockFade),
      xFade: within(k['xFade'], { min: 0, max: 90 }, d.drafting.xFade),
      // M6-03: ANNOAUTOSCALE is −4 to 4 but 0.
      annoAutoScale:
        within(k['annoAutoScale'], { min: -4, max: 4 }, d.drafting.annoAutoScale) ||
        d.drafting.annoAutoScale,
      plotTransparencyOverride: within(
        k['plotTransparencyOverride'],
        { min: 0, max: 2 },
        d.drafting.plotTransparencyOverride,
      ) as 0 | 1 | 2,
      layoutCreateViewport: bool(k['layoutCreateViewport'], d.drafting.layoutCreateViewport),
      showPageSetupForNewLayouts: bool(
        k['showPageSetupForNewLayouts'],
        d.drafting.showPageSetupForNewLayouts,
      ),
      // M5-08 part 3: one of AutoCAD's lineweights; mm or inches; the slider's range.
      lwDefault:
        typeof k['lwDefault'] === 'number' && LINEWEIGHTS.includes(k['lwDefault'])
          ? k['lwDefault']
          : d.drafting.lwDefault,
      lwUnits: within(k['lwUnits'], { min: 0, max: 1 }, d.drafting.lwUnits) as 0 | 1,
      lwScale:
        typeof k['lwScale'] === 'number' &&
        k['lwScale'] >= LWSCALE_RANGE.min &&
        k['lwScale'] <= LWSCALE_RANGE.max
          ? k['lwScale']
          : d.drafting.lwScale,
      polarMode: within(k['polarMode'], { min: 0, max: 15 }, d.drafting.polarMode),
      selectSimilarMode: within(
        k['selectSimilarMode'],
        { min: 0, max: 255 },
        d.drafting.selectSimilarMode,
      ),
      selectionCycling: within(
        k['selectionCycling'],
        { min: -2, max: 2 },
        d.drafting.selectionCycling,
      ),
      pickStyle: within(k['pickStyle'], { min: 0, max: 3 }, d.drafting.pickStyle),
      groupDisplayMode: within(
        k['groupDisplayMode'],
        { min: 0, max: 2 },
        d.drafting.groupDisplayMode,
      ),
      pickbox: within(k['pickbox'], { min: 0, max: 50 }, d.drafting.pickbox),
      pickadd: within(k['pickadd'], { min: 0, max: 3 }, d.drafting.pickadd),
      pickauto: within(k['pickauto'], { min: 0, max: 7 }, d.drafting.pickauto),
      selectionPreview: within(
        k['selectionPreview'],
        { min: 0, max: 3 },
        d.drafting.selectionPreview,
      ),
      previewFilter: within(k['previewFilter'], { min: 0, max: 63 }, d.drafting.previewFilter),
      selectionPreviewLimit: within(
        k['selectionPreviewLimit'],
        { min: 0, max: 32767 },
        d.drafting.selectionPreviewLimit,
      ),
      commandPreview: within(k['commandPreview'], { min: 0, max: 1 }, d.drafting.commandPreview),
      polarAddAngles:
        typeof polarAddAngles === 'string' && additionalAngles(polarAddAngles)
          ? polarAddAngles
          : d.drafting.polarAddAngles,
      snapType: within(k['snapType'], { min: 0, max: 1 }, d.drafting.snapType) as 0 | 1,
      polarDist:
        typeof k['polarDist'] === 'number' && Number.isFinite(k['polarDist']) && k['polarDist'] >= 0
          ? k['polarDist']
          : d.drafting.polarDist,
      gridStyle: within(k['gridStyle'], { min: 0, max: 7 }, d.drafting.gridStyle),
      tempOverrides: bool(k['tempOverrides'], d.drafting.tempOverrides),
      dynBits: within(k['dynBits'], { min: 0, max: 3 }, d.drafting.dynBits),
      dynPrompt: bool(k['dynPrompt'], d.drafting.dynPrompt),
      dynPiCoords: within(k['dynPiCoords'], { min: 0, max: 1 }, d.drafting.dynPiCoords) as 0 | 1,
      dynPiFormat: within(k['dynPiFormat'], { min: 0, max: 1 }, d.drafting.dynPiFormat) as 0 | 1,
      dynPiVis: within(k['dynPiVis'], { min: 0, max: 2 }, d.drafting.dynPiVis) as 0 | 1 | 2,
      dynDiVis: within(k['dynDiVis'], { min: 0, max: 2 }, d.drafting.dynDiVis) as 0 | 1 | 2,
      dynDiGrip: within(k['dynDiGrip'], { min: 0, max: 31 }, d.drafting.dynDiGrip),
      dynInfoTips: bool(k['dynInfoTips'], d.drafting.dynInfoTips),
      tooltip: tooltipAppearanceOf(k['tooltip']),
      qpQuadrant: QP_QUADRANTS.some((q) => q.value === qpQuadrant)
        ? (qpQuadrant as QpQuadrant)
        : d.drafting.qpQuadrant,
      qpDistance: int(k['qpDistance'], QP_DISTANCES, d.drafting.qpDistance),
      qpCollapse: bool(k['qpCollapse'], d.drafting.qpCollapse),
      qpRows: int(k['qpRows'], QP_ROW_COUNTS, d.drafting.qpRows),
      scLocation: within(k['scLocation'], { min: 0, max: 1 }, d.drafting.scLocation) as 0 | 1,
      scQuadrant: QP_QUADRANTS.some((q) => q.value === scQuadrant)
        ? (scQuadrant as QpQuadrant)
        : d.drafting.scQuadrant,
      scDistance: int(k['scDistance'], QP_DISTANCES, d.drafting.scDistance),
      scTitleBar: bool(k['scTitleBar'], d.drafting.scTitleBar),
      modifyOptions: modifyOptions(k['modifyOptions']),
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
    revcloudGrips: s.revcloudGrips,
    layerEvalCtl: s.layerEvalCtl,
    qpmode: s.qpmode,
    qpLocation: s.qpLocation,
    autosnap: s.autosnap,
    pickfirst: s.pickfirst,
    gripSize: s.gripSize,
    gripColors: s.gripColors,
    rolloverTips: s.rolloverTips,
    arrayAssociativity: s.arrayAssociativity,
    fieldDisplay: s.fieldDisplay,
    layLockFade: s.layLockFade,
    xFade: s.xFade,
    annoAutoScale: s.annoAutoScale,
    plotTransparencyOverride: s.plotTransparencyOverride,
    layoutCreateViewport: s.layoutCreateViewport,
    showPageSetupForNewLayouts: s.showPageSetupForNewLayouts,
    lwDefault: s.lwDefault,
    lwUnits: s.lwUnits,
    lwScale: s.lwScale,
    polarMode: s.polarMode,
    polarAddAngles: s.polarAddAngles,
    snapType: s.snapType,
    polarDist: s.polarDist,
    gridStyle: s.gridStyle,
    tempOverrides: s.tempOverrides,
    dynBits: s.dynBits,
    dynPrompt: s.dynPrompt,
    dynPiCoords: s.dynPiCoords,
    dynPiFormat: s.dynPiFormat,
    dynPiVis: s.dynPiVis,
    dynDiVis: s.dynDiVis,
    dynDiGrip: s.dynDiGrip,
    dynInfoTips: s.dynInfoTips,
    tooltip: s.tooltip,
    selectSimilarMode: s.selectSimilarMode,
    selectionCycling: s.selectionCycling,
    pickStyle: s.pickStyle,
    groupDisplayMode: s.groupDisplayMode,
    pickbox: s.pickbox,
    pickadd: s.pickadd,
    pickauto: s.pickauto,
    selectionPreview: s.selectionPreview,
    previewFilter: s.previewFilter,
    selectionPreviewLimit: s.selectionPreviewLimit,
    commandPreview: s.commandPreview,
    qpQuadrant: s.qpQuadrant,
    qpDistance: s.qpDistance,
    qpCollapse: s.qpCollapse,
    qpRows: s.qpRows,
    scLocation: s.scLocation,
    scQuadrant: s.scQuadrant,
    scDistance: s.scDistance,
    scTitleBar: s.scTitleBar,
    modifyOptions: s.modifyOptions,
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
