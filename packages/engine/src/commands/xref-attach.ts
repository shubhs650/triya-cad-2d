// XATTACH (M5-04 part 6; COMMANDS.md "Blocks and references"), alias XA, as AutoCAD 2024's
// (AutoCAD Help, "XATTACH (Command)", "Attach External Reference Dialog Box"): the Attach External
// Reference dialog (`XrefAttachRequest`), then what it leaves Specify On-screen asked at the
// command line, as -INSERT asks it:
//   Attach Xref "plan": plan.dxf                      (Overlay Xref … for an overlay)
//   "plan" loaded.
//   Specify insertion point or [Scale/X/Y/Z/Rotate]:
//   Enter X scale factor, specify opposite corner, or [Corner/XYZ] <1>:
//   Enter Y scale factor <use X scale factor>:
//   Specify rotation angle <0>:
//
// The xref is made (edit/xref-attach.ts) and the app loads its file at once (the `xref` view
// request, action `attach`), so the insertion point drags the drawing as AutoCAD's does. That load
// joins the command's undo step (`PromptBus.joinLoad`): U takes the xref, its content and its
// reference back together, and redo brings them back loaded. The reference is scaled from the
// file's INSUNITS to the drawing's, as the dialog's Block Unit shows (`insUnitsScale`).
//
// The app picks the file (AutoCAD's Select Reference File dialog and Browse...); a browser cannot
// name a file's folder, so the xref names the file alone: Path type "No path", which AutoCAD and
// Triya look for beside the drawing (M1-21). Settled for the common drafter expectation (noted in
// the PR):
// - the dialog opens on the settings it last closed with, per drawing (AutoCAD keeps them for the
//   session), with Attachment, Insertion point Specify On-screen, Scale 1 and Rotation 0 the first
//   time, as AutoCAD's dialog opens;
// - a file the drawing has an xref of already is referenced again through that xref, whatever the
//   dialog's Reference Type (AutoCAD keeps the type an xref was attached with); a nested one
//   becomes the drawing's own (edit/xref-attach.ts);
// - Esc at the insertion point leaves the xref attached with no reference, as AutoCAD's palette
//   then lists it Unreferenced; Detach takes it out.
//
// -XREF Attach and Overlay (M5-04 part 12; AutoCAD Help, "-XREF (Command)") ask at the command
// line, as AutoCAD asks with FILEDIA 0 (Triya has no FILEDIA: the dash form is the one scripts
// and typists use, and XATTACH is the dialog):
//   Enter name of file to attach <last>:            (to overlay, for Overlay)
// The app finds the file by name (`xrefFile`: folders, case and the extension aside) among the
// drawings it holds, since a browser cannot open a path by itself; `~` opens the Attach External
// Reference dialog instead, on Overlay for Overlay ("You can enter a tilde (~) to display a dialog
// box"). A name may be in double quotes, as AutoCAD takes one with spaces. <last> is the file the
// drawing last attached by name this session. The rest is XATTACH's: the same xref, load, prompts
// and one undo step.
import type { Vec2 } from '../geom/types';
import type { BlockTableRecord } from '../model/types';
import { insUnitsOf } from '../model/units';
import { XREF_OVERLAY_FLAG, xrefBringing } from '../model/xref';
import { toWorld } from '../input/ucs';
import {
  adoptNestedXref,
  attachXref,
  xrefFileName,
  xrefOfFile,
  type XrefAttachFile,
} from '../edit/xref-attach';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { insertBlock } from './blocks';
import { currentUcs } from './ucs';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The Attach External Reference dialog's Reference Type, Insertion point, Scale and Rotation. */
export interface XrefAttachSettings {
  /** Reference Type: Overlay, else Attachment. */
  readonly overlay: boolean;
  readonly pointOnScreen: boolean;
  /** The insertion point, in the current UCS. */
  readonly point: Vec2;
  readonly scaleOnScreen: boolean;
  readonly scale: { readonly x: number; readonly y: number; readonly z: number };
  /** One factor, X's, for all three axes. */
  readonly uniformScale: boolean;
  readonly rotationOnScreen: boolean;
  /** Radians, from the current UCS's X axis. */
  readonly rotation: number;
}

/** An xref the drawing has, which the dialog's Name list offers. */
export interface XrefAttachEntry extends XrefAttachFile {
  /** Its block's name. */
  readonly name: string;
  readonly overlay: boolean;
}

/** XATTACH's Attach External Reference dialog. */
export interface XrefAttachRequest {
  readonly type: 'xrefattach';
  readonly settings: XrefAttachSettings;
  /** The drawing's xrefs, by name. */
  readonly xrefs: readonly XrefAttachEntry[];
  /** The drawing's INSUNITS, which Block Unit's factor converts to. */
  readonly units: number;
  /** Why the last OK attached nothing. */
  readonly note?: string;
}

/** The dialog's answer: the drawing file and the fields as OK closed it. */
export interface XrefAttachAnswer {
  readonly file: XrefAttachFile;
  readonly settings: XrefAttachSettings;
}

/** The settings the dialog closed with last, per drawing. */
const lastSettings = new WeakMap<object, XrefAttachSettings>();

/** The file -XREF Attach or Overlay last attached, per drawing (<last>). */
const lastFile = new WeakMap<object, string>();

const DEFAULTS: XrefAttachSettings = {
  overlay: false,
  pointOnScreen: true,
  point: { x: 0, y: 0 },
  scaleOnScreen: false,
  scale: { x: 1, y: 1, z: 1 },
  uniformScale: false,
  rotationOnScreen: false,
  rotation: 0,
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validSettings(s: unknown): s is XrefAttachSettings {
  const v = s as XrefAttachSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    finite(v.point?.x) &&
    finite(v.point?.y) &&
    finite(v.scale?.x) &&
    finite(v.scale?.y) &&
    finite(v.scale?.z) &&
    finite(v.rotation)
  );
}

/** Whether `f` names a drawing file with INSUNITS. */
function validFile(f: unknown): f is XrefAttachFile {
  const v = f as XrefAttachFile | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fileName === 'string' &&
    xrefFileName(v.fileName).trim() !== '' &&
    Number.isInteger(v.units) &&
    v.units >= 0
  );
}

/** The drawing's xrefs, by name. */
function xrefsOf(ctx: CommandContext): XrefAttachEntry[] {
  const out: XrefAttachEntry[] = [];
  for (const r of ctx.model.tables.blockRecords.values()) {
    const path = ctx.model.blocks.get(r.handle)?.xrefPath;
    if (path === undefined) continue;
    out.push({
      name: r.name,
      fileName: xrefFileName(path),
      units: r.units,
      overlay: ((r.flags ?? 0) & XREF_OVERLAY_FLAG) !== 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** Why the dialog's values attach nothing, or undefined. */
function problemOf(answer: XrefAttachAnswer): string | undefined {
  if (!validFile(answer.file)) return 'Select a drawing file.';
  const { scale: s, scaleOnScreen, uniformScale } = answer.settings;
  if (!scaleOnScreen && (s.x === 0 || (!uniformScale && (s.y === 0 || s.z === 0))))
    return 'Value must be nonzero.';
  return undefined;
}

/**
 * The xref of `file`: the drawing's own when it has one of the file, else a new one, which the app
 * loads. Messages as AutoCAD's ("Attach Xref "name": path", then the app's "loaded").
 */
async function xrefFor(
  ctx: CommandContext,
  file: XrefAttachFile,
  overlay: boolean,
): Promise<BlockTableRecord> {
  const existing = xrefOfFile(ctx.model, file.fileName);
  if (existing) {
    // One a loaded xref brought in is the drawing's own once the drawing references it.
    if (xrefBringing(ctx.model, existing.handle))
      ctx.edit((b) => adoptNestedXref(b, ctx.model, existing.handle));
    return existing;
  }
  let block = '';
  ctx.edit((b) => {
    block = attachXref(b, ctx.model, file, overlay);
  });
  const r = ctx.model.tables.blockRecords.get(block)!;
  ctx.message(
    `${overlay ? 'Overlay' : 'Attach'} Xref "${r.name}": ${ctx.model.blocks.get(block)!.xrefPath}`,
  );
  const reply = await ctx.view.request({ op: 'xref', action: 'attach', blocks: [block] });
  if (!reply.ok) ctx.message(reply.message);
  else for (const m of reply.messages ?? []) ctx.message(m);
  return ctx.model.tables.blockRecords.get(block)!;
}

/** XATTACH's dialog, then the placing of what it attaches; with `overlay`, opened on Overlay. */
async function* xattachDialog(ctx: CommandContext, overlay?: boolean): Sub<void> {
  let settings: XrefAttachSettings = {
    ...DEFAULTS,
    ...lastSettings.get(ctx.model),
    ...(overlay !== undefined && { overlay }),
  };
  let note: string | undefined;
  for (;;) {
    const a = yield ctx.prompt.dialog({
      message: 'Attach External Reference',
      dialog: {
        type: 'xrefattach',
        settings,
        xrefs: xrefsOf(ctx),
        units: insUnitsOf(ctx.model),
        ...(note !== undefined && { note }),
      },
    });
    if (a.kind !== 'dialog' || a.action !== 'ok') return;
    const answer = a.xrefAttach;
    if (!answer || !validSettings(answer.settings)) return;
    settings = answer.settings;
    note = problemOf(answer);
    if (note) continue;
    lastSettings.set(ctx.model, settings);
    const r = await xrefFor(ctx, answer.file, settings.overlay);
    const ucs = currentUcs(ctx);
    const s = settings.scale;
    const uniform = settings.uniformScale || r.scalable === false;
    yield* insertBlock(ctx, r, {
      explode: false,
      uniform,
      xref: true,
      ...(!settings.pointOnScreen && { at: toWorld(ucs, settings.point) }),
      ...(!settings.scaleOnScreen && {
        scale: uniform ? { x: s.x, y: s.x, z: s.x } : { ...s },
      }),
      ...(!settings.rotationOnScreen && { rotation: ucs.angle + settings.rotation }),
    });
    return;
  }
}

/** A name typed at "Enter name of file": spaces at its ends and enclosing double quotes gone. */
function typedFileName(text: string): string {
  const t = text.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).trim() : t;
}

/**
 * -XREF Attach (Overlay with `overlay`): the file named at the command line, found by the app,
 * attached and placed as XATTACH attaches and places one; `~` is XATTACH's dialog.
 */
export async function* dashXrefAttach(ctx: CommandContext, overlay: boolean): Sub<void> {
  const last = lastFile.get(ctx.model);
  const a = yield ctx.prompt.string({
    message: `Enter name of file to ${overlay ? 'overlay' : 'attach'}`,
    spaces: true,
    ...(last !== undefined && { default: { kind: 'string', value: last } }),
  });
  if (a.kind !== 'string') return;
  const typed = typedFileName(a.value) || (last ?? '');
  if (typed === '') return;
  if (typed === '~') {
    yield* xattachDialog(ctx, overlay);
    return;
  }
  const reply = await ctx.view.request({ op: 'xrefFile', file: typed });
  if (!reply.ok) {
    ctx.message(reply.message);
    return;
  }
  if (!reply.xrefFile || !validFile(reply.xrefFile)) {
    ctx.message(`File "${typed}" not found.`);
    return;
  }
  lastFile.set(ctx.model, reply.xrefFile.fileName);
  const r = await xrefFor(ctx, reply.xrefFile, overlay);
  yield* insertBlock(ctx, r, { explode: false, uniform: r.scalable === false, xref: true });
}

export function xattachCommand(): CommandDef {
  return {
    name: 'XATTACH',
    usesSelection: 'none',
    async *run(ctx) {
      yield* xattachDialog(ctx);
    },
  };
}
