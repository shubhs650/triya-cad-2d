// New drawings from templates (M5-10, DEC-024, UI_SPEC.md §9): the bundled Triya ISO (mm) and
// Triya ANSI (inch) templates (assets/templates, written by scripts/templates/build-templates.py)
// and the names new drawings get.
//
// AutoCAD 2024 Help, "NEW": the Select Template dialog box lists the templates and opens a new
// drawing from the one chosen; "QNEW" starts one from the default template (Options > Files >
// Template Settings > Default Template File Name for QNEW), or opens Select Template when none is
// set. A new drawing is "Drawing1.dwg", "Drawing2.dwg", …, untitled (DWGTITLED 0) until it is
// saved, so its first Save is a Save As. Triya's is a .dxf (DEC-047). Each template is a chunk of
// its own, loaded the first time it is used and cached with the app for offline use.
//
// Part 2: the user's own templates, .dxf files added in Settings > Templates and kept on this
// device (AutoCAD's Template Settings > Drawing Template File Location), each opened as it is
// added to check it; and the Open button's "Open with no template - Imperial / Metric", a drawing
// set up with nothing but the units' defaults (assets/templates/no-template-*.dxf).
import type { SupportKind, SupportFile } from './support-files';

/** A template a new drawing can start from. */
export interface DrawingTemplate {
  /** The id the default-template setting keeps. */
  readonly id: string;
  /** As the Select Template dialog lists it. */
  readonly name: string;
  /** The template's file name. */
  readonly file: string;
  /** What it sets up, one line. */
  readonly description: string;
  /** The template's bytes, an AC1032 DXF. */
  load(): Promise<Uint8Array>;
}

const encoded = (m: { default: string }) => new TextEncoder().encode(m.default);

export const BUNDLED_TEMPLATES: readonly DrawingTemplate[] = [
  {
    id: 'triya-iso',
    name: 'Triya ISO (mm)',
    file: 'triya-iso.dxf',
    description:
      'Millimetres: ISO-25 dimension styles, drafting layers and text styles, A4 to A0 sheets with a title block and revision table.',
    load: () => import('../../../assets/templates/triya-iso.dxf?raw').then(encoded),
  },
  {
    id: 'triya-ansi',
    name: 'Triya ANSI (inch)',
    file: 'triya-ansi.dxf',
    description:
      'Inches: decimal-inch dimension styles, drafting layers and text styles, ANSI A to E sheets with a title block and revision table.',
    load: () => import('../../../assets/templates/triya-ansi.dxf?raw').then(encoded),
  },
];

/**
 * The drawings the Select Template dialog's "Open with no template - Imperial / Metric" opens
 * (AutoCAD 2024 Help, "Select Template Dialog Box"): layer 0, the Standard text style, the units'
 * dimension style, grid limits 12 x 9 inches or 420 x 297 mm and the layouts Layout1 and Layout2.
 */
export const NO_TEMPLATE = {
  imperial: {
    id: 'no-template-imperial',
    name: 'No template - Imperial',
    file: 'no-template-imperial.dxf',
    description: 'Inches, with only the imperial defaults: layer 0 and the Standard styles.',
    load: () => import('../../../assets/templates/no-template-imperial.dxf?raw').then(encoded),
  },
  metric: {
    id: 'no-template-metric',
    name: 'No template - Metric',
    file: 'no-template-metric.dxf',
    description:
      'Millimetres, with only the metric defaults: layer 0 and the ISO-25 dimension style.',
    load: () => import('../../../assets/templates/no-template-metric.dxf?raw').then(encoded),
  },
} as const satisfies Record<string, DrawingTemplate>;

/** The template QNEW and the start screen's New drawing use until the user picks another. */
export const DEFAULT_TEMPLATE_ID = 'triya-iso';

/** A user template's id: its file name, which the store matches whatever the case. */
const USER_PREFIX = 'user:';

/** The template with `id`, if there is one: a bundled template or one of the user's. */
export function templateById(
  id: string,
  user: readonly DrawingTemplate[] = [],
): DrawingTemplate | undefined {
  if (!id.startsWith(USER_PREFIX)) return BUNDLED_TEMPLATES.find((t) => t.id === id);
  const key = id.toLowerCase();
  return user.find((t) => t.id.toLowerCase() === key);
}

/**
 * The user's templates as the Select Template dialog lists them, after the bundled ones: by file
 * name, each described by what its header holds.
 */
export function userTemplates(
  files: readonly SupportFile[],
  bytes: (name: string) => Uint8Array | undefined,
): DrawingTemplate[] {
  return files.map((f) => ({
    id: USER_PREFIX + f.name,
    name: f.name.replace(/\.dxf$/i, ''),
    file: f.name,
    description: `Your template, kept on this device: ${f.summary}.`,
    load: () => {
      const b = bytes(f.name);
      // A copy: the drawing opened from it never shares the kept bytes.
      return b ? Promise.resolve(b.slice()) : Promise.reject(new Error(`${f.name} was removed`));
    },
  }));
}

/** What a DXF file's HEADER section says about it, read without parsing the drawing. */
export interface TemplateHeader {
  readonly binary: boolean;
  /** $ACADVER. */
  readonly version?: string;
  /** $MEASUREMENT: 0 imperial, 1 metric. */
  readonly measurement?: number;
  /** $INSUNITS. */
  readonly insunits?: number;
}

const BINARY_DXF = 'AutoCAD Binary DXF';
/** The header section is near the file's start; this much of it is read. */
const HEADER_SCAN = 1 << 20;

/**
 * The header of a DXF file (ASCII or binary), or why the bytes are not a DXF file. An ASCII
 * file's first section is read pair by pair; a binary one is only recognised (Open reads it).
 */
export function readTemplateHeader(bytes: Uint8Array): TemplateHeader | { readonly error: string } {
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, HEADER_SCAN));
  if (head.startsWith(BINARY_DXF)) return { binary: true };
  const lines = head.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code) || lines[i]!.trim() === '') break;
    pairs.push([code, lines[i + 1]!.trim()]);
  }
  const body = pairs.filter(([code]) => code !== 999);
  const [first, second] = body;
  if (first?.[0] !== 0 || first[1] !== 'SECTION' || second?.[0] !== 2)
    return { error: 'is not a DXF file' };
  if (second[1] !== 'HEADER') return { binary: false };
  const found: { version?: string; measurement?: number; insunits?: number } = {};
  let name = '';
  for (const [code, value] of body.slice(2)) {
    if (code === 0) break;
    if (code === 9) name = value;
    else if (name === '$ACADVER' && code === 1) found.version = value;
    else if (name === '$MEASUREMENT' && code === 70) found.measurement = Number(value);
    else if (name === '$INSUNITS' && code === 70) found.insunits = Number(value);
  }
  return { binary: false, ...found };
}

const RELEASES: Readonly<Record<string, string>> = {
  AC1009: 'AutoCAD R12',
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
};

/** INSUNITS as the Units dialog's Insertion scale names them. */
const UNITS: Readonly<Record<number, string>> = {
  1: 'inches',
  2: 'feet',
  3: 'miles',
  4: 'millimetres',
  5: 'centimetres',
  6: 'metres',
  7: 'kilometres',
  10: 'yards',
  14: 'decimetres',
};

/** One line on what a template's header holds: its release, measurement and units. */
export function describeTemplateHeader(h: TemplateHeader): string {
  const parts = [`${(h.version && RELEASES[h.version]) ?? (h.binary ? 'Binary' : '')} DXF`.trim()];
  if (h.measurement === 1) parts.push('metric');
  else if (h.measurement === 0) parts.push('imperial');
  const units = h.insunits === undefined ? undefined : UNITS[h.insunits];
  if (units) parts.push(units);
  return parts.join(', ');
}

/**
 * The user's templates folder (Settings > Templates): .dxf files, whose header is read when they
 * are listed and which are opened as drawings, with `open`, when they are added, so that a file
 * no new drawing could start from is refused then rather than when NEW picks it.
 */
export function templateFiles(
  open: (bytes: Uint8Array) => Promise<{ readonly modelSpace: unknown }>,
): SupportKind {
  return {
    folder: 'templates',
    accepts: (name) => /\.dxf$/i.test(name),
    read: (name, bytes) => {
      const h = readTemplateHeader(bytes);
      if ('error' in h) return { error: `${name} ${h.error}.` };
      const summary = describeTemplateHeader(h);
      return { summary, notice: `Added template ${name} (${summary}).` };
    },
    verify: async (name, bytes) => {
      try {
        // A copy: the worker takes its bytes.
        const opened = await open(bytes.slice());
        if (opened.modelSpace === undefined)
          return `${name} cannot be a template: the drawing has no model space.`;
        return undefined;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        return `${name} cannot be a template: it could not be opened (${why}).`;
      }
    },
  };
}

/**
 * The name of the next new drawing: `Drawing<n>.dxf` for the lowest n no open drawing has, as
 * AutoCAD numbers them, matched whatever the case.
 */
export function newDrawingName(open: readonly string[]): string {
  const taken = new Set(open.map((n) => n.toUpperCase()));
  let n = 1;
  while (taken.has(`DRAWING${n}.DXF`)) n++;
  return `Drawing${n}.dxf`;
}

/**
 * The Select Template dialog while it is open, and what NEW waits for: the template chosen, or
 * undefined on Cancel.
 */
export const selectTemplate = (() => {
  let open = false;
  let done: ((t: DrawingTemplate | undefined) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: boolean) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (t: DrawingTemplate | undefined) => {
    const d = done;
    done = undefined;
    d?.(t);
  };
  return {
    isOpen: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(): Promise<DrawingTemplate | undefined> {
      finish(undefined);
      set(true);
      return new Promise((resolve) => (done = resolve));
    },
    close(chosen?: DrawingTemplate) {
      set(false);
      finish(chosen);
    },
  };
})();
