// PDFATTACH (M5-04 part 8; COMMANDS.md "Blocks and references"), as AutoCAD 2024's (AutoCAD
// Help, "PDFATTACH (Command)", "Attach PDF Underlay Dialog Box", "-PDFATTACH (Command)"): the
// Attach PDF Underlay dialog (`PdfAttachRequest`), then what it leaves Specify On-screen asked
// at the command line, in -PDFATTACH's words:
//   Specify insertion point:
//   Specify scale factor <1.0000>:
//   Specify rotation <0>:
// Each page selected becomes a PDFUNDERLAY (edit/underlay-attach.ts), its lower-left corner at the
// insertion point; the rotation counts from the current UCS's X axis, as IMAGEATTACH's does. One
// undo step.
//
// The app picks the file and reads its pages and their sizes (pdf.js); a browser cannot name a
// file's folder, so a definition names the file alone (Path type "No path", looked for beside
// the drawing, M1-21).
// Settled for the common drafter expectation (noted in the PR):
// - the dialog opens as AutoCAD's does, with Insertion point Specify On-screen, Scale 1 and
//   Rotation 0, then on the settings it last closed with, per drawing;
// - AutoCAD's help does not say where the pages after the first go when several are selected:
//   each goes to the right of the one before (along the rotation), an inch at the scale apart,
//   so none hides another;
// - the insertion point prompt has no default (as -PDFATTACH's), so Enter asks again;
// - the scale prompt's Unit option is left out (INSUNITS sets the units a page is sized in).
import type { Vec2 } from '../geom/types';
import type { PdfDefinition } from '../model/types';
import {
  attachPdfPage,
  hasPageSize,
  pdfBaseName,
  pdfFileKey,
  underlayScaleFor,
  type PdfAttachPage,
} from '../edit/underlay-attach';
import { insUnitsOf } from '../model/units';
import { currentProps } from '../properties/current';
import { toWorld } from '../input/ucs';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { currentUcs } from './ucs';
import { drawingUnits, formatDistance } from './units';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The Attach PDF Underlay dialog's Insertion point, Scale and Rotation. */
export interface PdfAttachSettings {
  readonly pointOnScreen: boolean;
  /** The insertion point, in the current UCS. */
  readonly point: Vec2;
  readonly scaleOnScreen: boolean;
  readonly scale: number;
  readonly rotationOnScreen: boolean;
  /** Radians, from the current UCS's X axis. */
  readonly rotation: number;
}

/** A PDF file the drawing shows already, which the dialog's Name list offers. */
export interface PdfAttachEntry {
  /** Its name without folder or extension, as the list shows it. */
  readonly name: string;
  /** As its first definition names it. */
  readonly fileName: string;
  /** The pages the drawing has definitions of, in page order. */
  readonly pages: readonly string[];
}

/** The file OK attaches: its name and the pages selected, with their sizes. */
export interface PdfAttachFile {
  readonly fileName: string;
  readonly pages: readonly PdfAttachPage[];
}

/** PDFATTACH's Attach PDF Underlay dialog. */
export interface PdfAttachRequest {
  readonly type: 'pdfattach';
  readonly settings: PdfAttachSettings;
  /** The drawing's PDF files, by name. */
  readonly pdfs: readonly PdfAttachEntry[];
  /** The drawing's INSUNITS. */
  readonly units: number;
  /** Drawing units in a page's inch at scale 1: what Show Details sizes a page in. */
  readonly unitsPerInch: number;
  /** Why the last OK attached nothing. */
  readonly note?: string;
}

/** The Attach PDF Underlay dialog's answer: the file and pages, and the fields as OK closed it. */
export interface PdfAttachAnswer {
  readonly file: PdfAttachFile;
  readonly settings: PdfAttachSettings;
}

/** The settings the dialog closed with last, per drawing. */
const lastSettings = new WeakMap<object, PdfAttachSettings>();

const DEFAULTS: PdfAttachSettings = {
  pointOnScreen: true,
  point: { x: 0, y: 0 },
  scaleOnScreen: false,
  scale: 1,
  rotationOnScreen: false,
  rotation: 0,
};

/** An inch between pages placed side by side, at the scale. */
const PAGE_GAP = 1;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validSettings(s: unknown): s is PdfAttachSettings {
  const v = s as PdfAttachSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    finite(v.point?.x) &&
    finite(v.point?.y) &&
    finite(v.scale) &&
    finite(v.rotation)
  );
}

/** Why `f` cannot be attached, or undefined. */
function fileProblem(f: unknown): string | undefined {
  const v = f as PdfAttachFile | undefined;
  if (typeof v !== 'object' || v === null || typeof v.fileName !== 'string' || !v.fileName.trim())
    return 'Select a PDF file.';
  if (!Array.isArray(v.pages) || v.pages.length === 0 || !v.pages.every(hasPageSize))
    return 'Select one or more pages.';
  return undefined;
}

const byPage = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** The drawing's PDF files, by name, each with the pages it has definitions of. */
function pdfsOf(ctx: CommandContext): PdfAttachEntry[] {
  const files = new Map<string, { fileName: string; pages: Set<string> }>();
  for (const o of ctx.model.objects.values()) {
    if (o.type !== 'PDFDEFINITION') continue;
    const d = o as PdfDefinition;
    const key = pdfFileKey(d.fileName);
    let f = files.get(key);
    if (!f) files.set(key, (f = { fileName: d.fileName, pages: new Set() }));
    f.pages.add(d.page);
  }
  return [...files.values()]
    .map((f) => ({
      name: pdfBaseName(f.fileName),
      fileName: f.fileName,
      pages: [...f.pages].sort(byPage),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Where each page's lower-left corner goes, the first at `at`, along `rotation`. */
function corners(pages: readonly PdfAttachPage[], at: Vec2, k: number, rotation: number): Vec2[] {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  let x = 0;
  return pages.map((p) => {
    const corner = { x: at.x + x * c, y: at.y + x * s };
    x += (p.width + PAGE_GAP) * k;
    return corner;
  });
}

/** The pages' frames at `k` drawing units an inch and `rotation`, from `at`. */
function frames(pages: readonly PdfAttachPage[], at: Vec2, k: number, rotation: number) {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const starts = corners(pages, at, k, rotation);
  return pages.map((p, i) => {
    const o = starts[i]!;
    const corner = (x: number, y: number) => ({
      x: o.x + x * c - y * s,
      y: o.y + x * s + y * c,
      bulge: 0,
    });
    const w = p.width * k;
    const h = p.height * k;
    return {
      kind: 'LWPOLYLINE' as const,
      closed: true,
      vertices: [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)],
    };
  });
}

/** Attaches the pages as the settings say, asking what is Specify On-screen. */
async function* place(ctx: CommandContext, f: PdfAttachFile, s: PdfAttachSettings): Sub<void> {
  const ucs = currentUcs(ctx);
  let at = toWorld(ucs, s.point);
  if (s.pointOnScreen) {
    const origin = { x: 0, y: 0 };
    const k = underlayScaleFor(ctx.model, s.scaleOnScreen ? 1 : s.scale);
    ctx.preview(frames(f.pages, origin, k, ucs.angle + (s.rotationOnScreen ? 0 : s.rotation)));
    for (;;) {
      const a = yield ctx.prompt.point({
        message: 'Specify insertion point',
        drag: { kind: 'preview', from: origin },
      });
      if (a.kind === 'enter') continue;
      ctx.preview([]);
      if (a.kind !== 'point') return;
      at = a.point;
      break;
    }
  }

  let scale = s.scale;
  if (s.scaleOnScreen) {
    for (;;) {
      const a = yield ctx.prompt.distance({
        message: 'Specify scale factor',
        base: at,
        defaultLabel: formatDistance(1, drawingUnits(ctx.model.header)),
      });
      if (a.kind === 'enter') scale = 1;
      else if (a.kind === 'distance') scale = a.value;
      else return;
      if (scale > 0) break;
      ctx.message('Value must be positive and nonzero.');
    }
  }

  let rotation = ucs.angle + s.rotation;
  if (s.rotationOnScreen) {
    const a = yield ctx.prompt.angle({
      message: 'Specify rotation',
      base: at,
      default: { kind: 'angle', value: ucs.angle },
    });
    if (a.kind !== 'angle') return;
    rotation = a.value;
  }

  const props = currentProps(ctx.model);
  const k = underlayScaleFor(ctx.model, scale);
  const starts = corners(f.pages, at, k, rotation);
  ctx.edit((b) => {
    f.pages.forEach((p, i) => {
      attachPdfPage(b, ctx.model, f.fileName, p, ctx.space, starts[i]!, scale, rotation, props);
    });
  });
}

export function pdfattachCommand(): CommandDef {
  return {
    name: 'PDFATTACH',
    usesSelection: 'none',
    async *run(ctx) {
      let settings: PdfAttachSettings = { ...DEFAULTS, ...lastSettings.get(ctx.model) };
      let note: string | undefined;
      for (;;) {
        const a = yield ctx.prompt.dialog({
          message: 'Attach PDF Underlay',
          dialog: {
            type: 'pdfattach',
            settings,
            pdfs: pdfsOf(ctx),
            units: insUnitsOf(ctx.model),
            unitsPerInch: underlayScaleFor(ctx.model, 1),
            ...(note !== undefined && { note }),
          },
        });
        if (a.kind !== 'dialog' || a.action !== 'ok') return;
        const answer = a.pdfAttach;
        if (!validSettings(answer?.settings)) return;
        settings = answer.settings;
        note =
          fileProblem(answer.file) ??
          (!settings.scaleOnScreen && !(settings.scale > 0)
            ? 'Value must be positive and nonzero.'
            : undefined);
        if (note) continue;
        lastSettings.set(ctx.model, settings);
        yield* place(ctx, answer.file, settings);
        return;
      }
    },
  };
}
