// The error report's payload, assembled in the page (M7-08, PRD §8 G6, ARCHITECTURE.md §17):
// pure functions of what the app knows when an error reaches it, so the privacy test runs them
// in Node on a drawing full of marker strings (test/error-report.test.ts) as well as in the app.
//
// Drawing content stays out by construction and by a second pass:
// - by construction, the report holds counts and a fixed list of flags about the drawing, and
//   of the error only its class, its stack frames (code identifiers and locations in the app,
//   other locations reduced to `<external>`) and its message;
// - the message is the one free text, so it is scrubbed: quoted text, URLs, paths and decimal
//   numbers (coordinates) are taken out, and so is every string the drawing holds (text, names,
//   xdata, the file's name; `drawingStrings`) wherever it appears, without regard to case.
// The user reads the result before anything is sent (ErrorReportDialog.tsx).
import type { ChangeSet, DocumentInit } from '@triya/engine';
import type { DrawingFacts } from '@triya/io/health';
import {
  ERROR_NAME,
  FRAME,
  MAX_FRAME,
  MAX_FRAMES,
  MAX_MESSAGE,
  REPORT_FEATURES,
  REPORT_SCHEMA,
  type ErrorReport,
  type ErrorSource,
  type ReportBrowser,
  type ReportCount,
  type ReportDrawing,
  type ReportFeature,
} from './schema';

/** An error as it reached the app. */
export interface Fault {
  readonly source: ErrorSource;
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
  /** The command that threw (a command's fault). */
  readonly command?: string;
}

/** The drawing on screen when the error happened. */
export interface ReportDrawingInput {
  readonly name: string;
  readonly opened: {
    readonly init: DocumentInit;
    readonly facts: DrawingFacts;
    readonly summary?: { readonly format: string };
  };
  /** Every change its engine applied since it opened. */
  readonly changes: readonly ChangeSet[];
  readonly edits: number;
  /**
   * The file as opened, when the app has it: a DXF's strings are read from it too, as the
   * file holds some the app never maps (a linetype's description, a passthrough object's).
   */
  readonly bytes?: Uint8Array;
}

export interface ReportContext {
  readonly appVersion: string;
  readonly userAgent: string;
  /** The app's origin: stack locations in it keep their path, any other is `<external>`. */
  readonly origin: string;
  /** The browser's and the app's feature flags (the drawing's are worked out here). */
  readonly features: readonly ReportFeature[];
  /** Registered command names: a command's fault names it only if it is one. */
  readonly commands: ReadonlySet<string>;
  readonly drawing?: ReportDrawingInput;
}

/** Text shorter than this is not taken out of a message on its own (it would eat words). */
const MIN_REDACTED = 3;
const REDACTED = '…';

export function buildReport(fault: Fault, ctx: ReportContext): ErrorReport {
  const known = ctx.drawing ? drawingStrings(ctx.drawing) : new Set<string>();
  const words = knownWords(known);
  const drawing = ctx.drawing ? drawingStatistics(ctx.drawing) : undefined;
  const features = new Set<ReportFeature>([
    ...ctx.features,
    ...(ctx.drawing ? drawingFeatures(ctx.drawing, drawing!) : []),
  ]);
  const command = fault.command?.toUpperCase() ?? '';
  return {
    schema: REPORT_SCHEMA,
    app: ctx.appVersion,
    browser: browserOf(ctx.userAgent),
    error: {
      source: fault.source,
      name: fault.name && ERROR_NAME.test(fault.name) ? fault.name : 'Error',
      message: scrubMessage(fault.message, known, words),
      command: ctx.commands.has(command) ? command : '',
      stack: stackFrames(fault.stack ?? '', ctx.origin, words),
    },
    ...(drawing ? { drawing } : {}),
    features: REPORT_FEATURES.filter((f) => features.has(f)),
  };
}

/** A word, as messages and drawing strings are split into: letters, digits, `_`, `$`, `-`. */
const WORD = /[\p{L}\p{N}_$-]+/gu;
/** Words shorter than this are not taken out on their own. */
const MIN_WORD = 4;

/**
 * The words of the drawing's strings, lower case: a message word that is one of them goes, so
 * part of a string (one line of an MTEXT's formatted text, a name with a suffix) goes too.
 */
export function knownWords(known: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const s of known) {
    for (const w of s.toLowerCase().match(WORD) ?? []) if (w.length >= MIN_WORD) out.add(w);
  }
  return out;
}

/**
 * The message with whatever could be drawing content taken out: quoted text, URLs, paths,
 * decimal numbers, every string in `known` and every word of them (`words`). Over-redacting
 * is the safe side.
 */
export function scrubMessage(
  message: string,
  known: ReadonlySet<string>,
  words: ReadonlySet<string> = knownWords(known),
): string {
  let m = message
    .slice(0, 4 * MAX_MESSAGE)
    // Quoted: a name or a value the code put in its message (an apostrophe in a word is not).
    .replace(
      /"[^"]*"|“[^”]*”|‘[^’]*’|«[^»]*»|`[^`]*`|(?<![\p{L}\p{N}])'[^']*'/gu,
      (q) => `${q[0]}${REDACTED}${q.at(-1)}`,
    )
    .replace(/\b(?:[a-z][a-z0-9+.-]*):\/\/\S*|\bblob:\S*|\bdata:\S*/gi, '<url>')
    .replace(/(?:\b[A-Za-z]:)?(?:[\\/][^\\/\s:]+){2,}[\\/]?/g, '<path>')
    .replace(/-?\d*\.\d+(?:e[+-]?\d+)?/gi, '#');
  // Words first: a short string taken out of the middle of a word would hide the word.
  m = m.replace(WORD, (w) => (w.length >= MIN_WORD && words.has(w.toLowerCase()) ? REDACTED : w));
  // Longest first, so a name holding a shorter one goes whole.
  const lower = () => m.toLowerCase();
  for (const s of [...known].sort((a, b) => b.length - a.length)) {
    const needle = s.toLowerCase();
    let at = lower().indexOf(needle);
    while (at >= 0) {
      m = m.slice(0, at) + REDACTED + m.slice(at + needle.length);
      at = lower().indexOf(needle, at + REDACTED.length);
    }
  }
  // Control characters (line breaks, escapes) become spaces: the message is one line.
  m = [...m]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  return m.length > MAX_MESSAGE ? `${m.slice(0, MAX_MESSAGE - 1)}${REDACTED}` : m;
}

/**
 * Every string the drawing holds, as the message scrub takes them out: its text, names, xdata
 * and header strings (everything `init` and the changes since carry, walked), the file's name
 * with and without its extension, and each line of multi-line text.
 */
export function drawingStrings(d: ReportDrawingInput): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const part of [s, ...s.split(/\\P|[\r\n]+/)]) {
      const t = part.trim();
      if (t.length >= MIN_REDACTED) out.add(t);
    }
  };
  const seen = new WeakSet<object>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') return add(v);
    if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v) || seen.has(v)) return;
    seen.add(v);
    if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k);
        walk(x);
      }
    } else if (Array.isArray(v) || v instanceof Set) {
      for (const x of v) walk(x);
    } else for (const x of Object.values(v)) walk(x);
  };
  walk(d.opened.init);
  walk(d.opened.facts);
  walk(d.changes);
  if (d.bytes) for (const s of dxfStrings(d.bytes)) add(s);
  add(d.name);
  add(d.name.replace(/\.[^.]*$/, ''));
  return out;
}

/**
 * A DXF's string values: names, text and xdata strings, by group code (DXF reference, "Group
 * Code Value Types"): 1-8, 300-309, 410-419, 430-439, 470-479, 999 and 1000-1009. Entity and
 * subclass names (0, 100) and header variable names (9) are the format's own, so they stay. A
 * DWG (binary) gives none: its strings are the ones the app maps.
 */
export function dxfStrings(bytes: Uint8Array): string[] {
  if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'AC10') return [];
  const lines = new TextDecoder('utf-8').decode(bytes).split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (
      (code >= 1 && code <= 8) ||
      (code >= 300 && code <= 309) ||
      (code >= 410 && code <= 419) ||
      (code >= 430 && code <= 439) ||
      (code >= 470 && code <= 479) ||
      code === 999 ||
      (code >= 1000 && code <= 1009)
    ) {
      out.push(lines[i + 1]!);
    }
  }
  return out;
}

/** The drawing's counts as they are now: what it opened with and the changes since. */
export function drawingStatistics(d: ReportDrawingInput): ReportDrawing {
  const { init, facts } = d.opened;
  const entities = new Map<string, number>();
  const bump = (kind: string, by: number) => entities.set(kind, (entities.get(kind) ?? 0) + by);
  for (const e of init.entities ?? []) bump(e.geom.kind, 1);
  const counts: Record<ReportCount, number> = {
    layers: init.tables?.layers?.length ?? 0,
    linetypes: init.tables?.linetypes?.length ?? 0,
    textStyles: init.tables?.textStyles?.length ?? 0,
    dimStyles: init.tables?.dimStyles?.length ?? 0,
    blocks: init.blocks?.length ?? 0,
    layouts: init.layouts?.length ?? 0,
    objects: init.objects?.length ?? 0,
    edits: Math.max(0, d.edits),
  };
  const keyed = (
    key: ReportCount,
    c?: { added?: readonly unknown[]; removed?: readonly unknown[] },
  ) => {
    if (c) counts[key] += (c.added?.length ?? 0) - (c.removed?.length ?? 0);
  };
  for (const c of d.changes) {
    for (const a of c.entities?.added ?? []) bump(a.entity.geom.kind, 1);
    for (const r of c.entities?.removed ?? []) bump(r.entity.geom.kind, -1);
    for (const u of c.entities?.updated ?? []) {
      if (u.before.geom.kind !== u.after.geom.kind) {
        bump(u.before.geom.kind, -1);
        bump(u.after.geom.kind, 1);
      }
    }
    keyed('layers', c.tables?.layers);
    keyed('linetypes', c.tables?.linetypes);
    keyed('textStyles', c.tables?.textStyles);
    keyed('dimStyles', c.tables?.dimStyles);
    keyed('blocks', c.blocks);
    keyed('layouts', c.layouts);
    keyed('objects', c.objects);
  }
  for (const k of Object.keys(counts) as ReportCount[]) counts[k] = Math.max(0, counts[k]);
  const sorted = [...entities].filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    version: /^AC10[0-9]{2}$/.test(facts.version) ? facts.version : '',
    units: Number.isSafeInteger(facts.insUnits) && facts.insUnits >= 0 ? facts.insUnits : 0,
    measurement: facts.measurement === 'imperial' ? 'imperial' : 'metric',
    entities: Object.fromEntries(sorted),
    counts,
  };
}

function drawingFeatures(d: ReportDrawingInput, stats: ReportDrawing): ReportFeature[] {
  const { facts, summary } = d.opened;
  const out: ReportFeature[] = [];
  if (summary?.format === 'dwg') out.push('dwg');
  const kinds = new Set(facts.references.map((r) => r.kind));
  if (kinds.has('xref')) out.push('xrefs');
  if (kinds.has('image')) out.push('images');
  if (kinds.has('pdf')) out.push('pdf-underlays');
  if (facts.unknownObjects.length > 0) out.push('unknown-objects');
  if (facts.unmappedEntities.length > 0) out.push('unmapped-entities');
  // Model is a layout too: more than one means paper space is used.
  if (stats.counts.layouts > 1) out.push('layouts');
  return out;
}

/**
 * The stack's frames, `function (location:line:column)`: V8's `    at fn (url:l:c)` and
 * Firefox's and Safari's `fn@url:l:c`. The first line of a V8 stack (the message again) and
 * anything that is not a frame are dropped; a location in the app keeps its path (no query),
 * a worker's blob URL is `<worker>`, anything else `<external>`.
 */
export function stackFrames(
  stack: string,
  origin: string,
  words: ReadonlySet<string> = new Set(),
): string[] {
  const out: string[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    const v8 = /^at (?:(.+?) \((.+)\)|(.+))$/.exec(line);
    const gecko = v8 ? null : /^([^@\s]*)@(.+)$/.exec(line);
    if (!v8 && !gecko) continue;
    const fn = v8 ? (v8[1] ?? '') : gecko![1]!;
    const where = v8 ? (v8[2] ?? v8[3]!) : gecko![2]!;
    const frame = formatFrame(identifier(fn, words), where, origin);
    if (frame.length <= MAX_FRAME && FRAME.test(frame)) out.push(frame);
    if (out.length === MAX_FRAMES) break;
  }
  return out;
}

/**
 * A function's name as a stack gives it, kept to what a code identifier holds; a word of the
 * drawing's (code made by `new Function` could be named anything) is `<redacted>`.
 */
function identifier(fn: string, words: ReadonlySet<string>): string {
  return fn
    .replace(/[^A-Za-z0-9_$.<> ]/g, '')
    .replace(/[A-Za-z0-9_$-]+/g, (w) =>
      w.length >= MIN_WORD && words.has(w.toLowerCase()) ? '<redacted>' : w,
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function formatFrame(fn: string, where: string, origin: string): string {
  const at = /^(.*):(\d+):(\d+)$/.exec(where);
  if (!at) return where === 'native' || where === '<anonymous>' ? '<native>' : '';
  const [, url, line, column] = at;
  const loc = location(url!, origin);
  const place = `${loc}:${line}:${column}`;
  // Code that is not the app's names nothing: its names are not ours to send.
  return fn && loc !== '<external>' ? `${fn} (${place})` : place;
}

function location(url: string, origin: string): string {
  if (url.startsWith('blob:')) return '<worker>';
  if (url === 'native' || url === '<anonymous>') return '<native>';
  if (!url.startsWith(`${origin}/`)) return '<external>';
  const path = url.slice(origin.length).replace(/[?#].*$/, '');
  return /^\/[A-Za-z0-9_$./@~+-]{0,120}$/.test(path) ? path : '<external>';
}

/** The browser's family, major version and operating system, from its user agent string. */
export function browserOf(ua: string): ReportBrowser {
  const version = (re: RegExp) => re.exec(ua)?.[1]?.slice(0, 4) ?? '';
  let name: ReportBrowser['name'] = 'Other';
  let v = '';
  if (/Edg(?:e|A|iOS)?\/\d/.test(ua)) [name, v] = ['Edge', version(/Edg(?:e|A|iOS)?\/(\d+)/)];
  else if (/Firefox\/\d|FxiOS\/\d/.test(ua))
    [name, v] = ['Firefox', version(/(?:Firefox|FxiOS)\/(\d+)/)];
  else if (/(?:Headless)?Chrome\/\d|CriOS\/\d/.test(ua) && !/OPR\//.test(ua)) {
    [name, v] = ['Chrome', version(/(?:Chrome|CriOS)\/(\d+)/)];
  } else if (/Version\/\d+.*Safari\//.test(ua)) [name, v] = ['Safari', version(/Version\/(\d+)/)];
  let os: ReportBrowser['os'] = 'Other';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  return { name, version: v, os };
}
