// The error report's payload (M7-08, PRD §8 G6, ARCHITECTURE.md §17, DEC-029): what the app
// may send to report.openengtools.com after the user has read it and pressed Send Report, and
// what the report worker (services/report-worker) accepts. Plain data and a strict check, no
// imports, so the worker bundles this file as it is.
//
// What a report holds: the error's kind and name, its message with anything that could be
// drawing content taken out (build.ts), its stack frames (code locations only), the browser's
// family, major version and operating system, the app version, the drawing's statistics
// (counts by entity type and table, the file version and units) and a fixed list of feature
// flags. Never drawing content, file names or paths (PRD §8): `validReport` refuses any field
// not listed here, so a later change cannot add one silently.

/** Where reports go, the one request the app makes on its own besides the service worker's. */
export const REPORT_URL = 'https://report.openengtools.com/';

export const REPORT_SCHEMA = 1;

/** The most the worker reads of a request body. */
export const MAX_REPORT_BYTES = 16 * 1024;

export const MAX_MESSAGE = 300;
export const MAX_FRAMES = 30;
export const MAX_FRAME = 200;

/** Where the error came from. */
export const ERROR_SOURCES = ['window', 'promise', 'command', 'worker'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

/** The feature flags a report may name (anything else is refused). */
export const REPORT_FEATURES = [
  // The drawing's.
  'dwg',
  'xrefs',
  'images',
  'pdf-underlays',
  'unknown-objects',
  'unmapped-entities',
  'layouts',
  // The browser's and the app's.
  'file-system-access',
  'offscreen-canvas',
  'service-worker',
  'engine-in-worker',
] as const;
export type ReportFeature = (typeof REPORT_FEATURES)[number];

/** The drawing's tables and collections counted. */
export const REPORT_COUNTS = [
  'layers',
  'linetypes',
  'textStyles',
  'dimStyles',
  'blocks',
  'layouts',
  'objects',
  'edits',
] as const;
export type ReportCount = (typeof REPORT_COUNTS)[number];

export interface ReportBrowser {
  readonly name: 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Other';
  /** The major version, digits only; empty when unknown. */
  readonly version: string;
  readonly os: 'Windows' | 'macOS' | 'Linux' | 'Android' | 'iOS' | 'ChromeOS' | 'Other';
}

export interface ReportError {
  readonly source: ErrorSource;
  /** The error's class, e.g. `TypeError`. */
  readonly name: string;
  /** The message, drawing content taken out (build.ts `scrubMessage`). */
  readonly message: string;
  /** The command that threw, a registered command's name; empty otherwise. */
  readonly command: string;
  /** `function (location:line:column)`, the location a path in the app or `<worker>`/`<external>`. */
  readonly stack: readonly string[];
}

export interface ReportDrawing {
  /** `$ACADVER`, e.g. `AC1032`; empty for a new drawing's. */
  readonly version: string;
  /** `$INSUNITS`. */
  readonly units: number;
  readonly measurement: 'imperial' | 'metric';
  /** Entities by type (`LINE`, `MTEXT`, ...), every block and layout counted. */
  readonly entities: Readonly<Record<string, number>>;
  readonly counts: Readonly<Record<ReportCount, number>>;
}

export interface ErrorReport {
  readonly schema: typeof REPORT_SCHEMA;
  /** The app version (package.json). */
  readonly app: string;
  readonly browser: ReportBrowser;
  readonly error: ReportError;
  /** The drawing on screen when it happened; absent with none open. */
  readonly drawing?: ReportDrawing;
  readonly features: readonly ReportFeature[];
}

const BROWSERS = new Set(['Chrome', 'Edge', 'Firefox', 'Safari', 'Other']);
const SYSTEMS = new Set(['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'ChromeOS', 'Other']);

/** An error class's name, a command's name, an entity type. */
export const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$]{0,39}$/;
const COMMAND_NAME = /^$|^[A-Z0-9_.+-]{1,40}$/;
const ENTITY_TYPE = /^[A-Z][A-Z0-9_]{0,31}$/;
const ACAD_VERSION = /^$|^AC10[0-9]{2}$/;
const APP_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]{1,20})?$/;
/** A stack frame as build.ts writes it: a code identifier and a location in the app. */
export const FRAME =
  /^(?:[A-Za-z0-9_$.<> ]{1,80} \()?(?:\/[A-Za-z0-9_$./@~+-]{0,120}|<worker>|<external>|<native>):[0-9]{1,7}:[0-9]{1,7}\)?$|^<native>$/;

type Json = Readonly<Record<string, unknown>>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Exactly these keys, `optional` ones allowed to be missing. */
const hasKeys = (o: Json, keys: readonly string[], optional: readonly string[] = []): boolean =>
  Object.keys(o).every((k) => keys.includes(k)) &&
  keys.every((k) => optional.includes(k) || k in o);

const count = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function validBrowser(v: unknown): boolean {
  return (
    isObject(v) &&
    hasKeys(v, ['name', 'version', 'os']) &&
    BROWSERS.has(v['name'] as string) &&
    typeof v['version'] === 'string' &&
    /^[0-9]{0,4}$/.test(v['version']) &&
    SYSTEMS.has(v['os'] as string)
  );
}

function validError(v: unknown): boolean {
  if (!isObject(v) || !hasKeys(v, ['source', 'name', 'message', 'command', 'stack'])) return false;
  const stack = v['stack'];
  return (
    (ERROR_SOURCES as readonly unknown[]).includes(v['source']) &&
    typeof v['name'] === 'string' &&
    ERROR_NAME.test(v['name']) &&
    text(v['message'], MAX_MESSAGE) &&
    typeof v['command'] === 'string' &&
    COMMAND_NAME.test(v['command']) &&
    Array.isArray(stack) &&
    stack.length <= MAX_FRAMES &&
    stack.every((f) => text(f, MAX_FRAME) && FRAME.test(f))
  );
}

function validDrawing(v: unknown): boolean {
  if (!isObject(v) || !hasKeys(v, ['version', 'units', 'measurement', 'entities', 'counts'])) {
    return false;
  }
  const entities = v['entities'];
  const counts = v['counts'];
  return (
    typeof v['version'] === 'string' &&
    ACAD_VERSION.test(v['version']) &&
    count(v['units']) &&
    (v['measurement'] === 'imperial' || v['measurement'] === 'metric') &&
    isObject(entities) &&
    Object.keys(entities).length <= 100 &&
    Object.entries(entities).every(([k, n]) => ENTITY_TYPE.test(k) && count(n)) &&
    isObject(counts) &&
    hasKeys(counts, REPORT_COUNTS) &&
    REPORT_COUNTS.every((k) => count(counts[k]))
  );
}

/** Whether `v` is a report the app may send and the worker files: every field checked. */
export function validReport(v: unknown): v is ErrorReport {
  if (!isObject(v)) return false;
  if (!hasKeys(v, ['schema', 'app', 'browser', 'error', 'drawing', 'features'], ['drawing'])) {
    return false;
  }
  const features = v['features'];
  return (
    v['schema'] === REPORT_SCHEMA &&
    typeof v['app'] === 'string' &&
    APP_VERSION.test(v['app']) &&
    validBrowser(v['browser']) &&
    validError(v['error']) &&
    (!('drawing' in v) || validDrawing(v['drawing'])) &&
    Array.isArray(features) &&
    features.length <= REPORT_FEATURES.length &&
    new Set(features).size === features.length &&
    features.every((f) => (REPORT_FEATURES as readonly unknown[]).includes(f))
  );
}
