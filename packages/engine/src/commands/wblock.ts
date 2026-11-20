// WBLOCK and -WBLOCK (M5-01 part 4): objects, a block or the whole drawing written to a new
// drawing file, as AutoCAD 2024 Help describes them ("WBLOCK (Command)", "Write Block Dialog
// Box", "-WBLOCK (Command)"):
//
//   WBLOCK   the Write Block dialog: Source (Block, Entire drawing, Objects); Base point (Pick
//            point, X, Y); Objects (Select objects, Retain / Convert to block / Delete from
//            drawing, the count selected); Destination (File name and path, Insert units).
//   -WBLOCK  Enter name of output file:
//            Enter name of existing block or [= (block=output file)/* (whole drawing)]
//              <define new drawing>:
//            Specify insertion base point:                      (a new drawing)
//            Select objects:
//
// The file is DXF (AC1032, DEC-047), written by the app, which hands it over as Save As does.
// A block's contents and the objects become the new drawing's model space with the base point
// at its origin ("the base point becomes the origin of the new drawing"), its $INSBASE 0,0,0
// and $INSUNITS the Insert units; the whole drawing is written as Save would write it.
// -WBLOCK's new drawing erases the objects written (OOPS brings them back), as -BLOCK does.
//
// Ambiguities, settled for the common drafter expectation and noted in the PR:
// - the new drawing keeps the drawing's units settings (LUNITS, LUPREC, AUNITS, AUPREC, ANGBASE,
//   ANGDIR, MEASUREMENT) and LTSCALE; everything else is the blank drawing's;
// - the objects keep their world orientation, moved so the base point is at the origin;
// - the dialog opens on Objects (Entire drawing never by itself), Retain, the drawing's units and
//   "new block.dxf"; picking a block names the file after it;
// - Convert to block makes a block named after the file and puts a reference over the objects
//   (attribute values their defaults); a block of that name already there is not redefined;
// - Entire drawing writes every record the drawing holds (PURGE, M5-09, takes the unused out).
import type { Vec2 } from '../geom/types';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { AttdefGeometry, HeaderValue, InsertGeometry } from '../model/types';
import type { BlockDrawing } from './view/host';
import {
  ATTRIBUTE_CONSTANT,
  blockNameProblem,
  blockNamed,
  defineBlock,
  definitionAttribute,
  insertableBlocks,
  placeReference,
} from '../edit/blocks';
import { copyToClipboard, type ClipboardCopy } from '../edit/clipboard';
import { eraseObjects, refusalMessages } from '../edit/edit';
import { insUnitsOf } from '../model/units';
import { isXrefRecord } from '../model/xref';
import { currentProps } from '../properties/current';
import { toUcs, toWorld } from '../input/ucs';
import { INSUNITS_NAMES } from './drawing-units';
import { fileBlockName } from './blocks';
import { currentUcs } from './ucs';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** What the Write Block dialog writes from. */
export type WriteBlockSource = 'block' | 'drawing' | 'objects';

/** The Write Block dialog's fields. */
export interface WriteBlockSettings {
  readonly source: WriteBlockSource;
  /** Source Block's block. */
  readonly block: string;
  /** The base point, in the current UCS (Source Objects). */
  readonly base: Vec2;
  /** What becomes of the objects written: Retain, Convert to block, Delete from drawing. */
  readonly objects: 'retain' | 'convert' | 'delete';
  /** Destination's File name and path. */
  readonly file: string;
  /** Destination's Insert units: an `$INSUNITS` code. */
  readonly units: number;
}

/** WBLOCK's Write Block dialog. */
export interface WriteBlockRequest {
  readonly type: 'wblock';
  readonly settings: WriteBlockSettings;
  /** How many objects are selected. */
  readonly selected: number;
  /** The drawing's blocks, as Source Block offers them. */
  readonly blocks: readonly string[];
  /** Why the last OK wrote nothing. */
  readonly note?: string;
}

/** The Write Block dialog's answer: its fields, and the pick that closed it, if one did. */
export interface WriteBlockAnswer {
  readonly settings: WriteBlockSettings;
  readonly pick?: 'point' | 'objects';
}

/** The variables the new drawing takes from the drawing: its units settings and LTSCALE. */
const CARRIED_HEADER = [
  '$MEASUREMENT',
  '$LUNITS',
  '$LUPREC',
  '$AUNITS',
  '$AUPREC',
  '$ANGBASE',
  '$ANGDIR',
  '$LTSCALE',
];

/** The file name WBLOCK writes: DXF whatever was typed, "new block.dxf" when nothing was. */
export function wblockFileName(typed: string): string {
  const name = typed
    .trim()
    .replace(/\.(dxf|dwg)$/i, '')
    .trim();
  return `${name === '' ? 'new block' : name}.dxf`;
}

/** The drawing's units settings, which a new drawing written from it keeps (LAYOUT SAveas too). */
export function carriedHeader(model: DocumentModel): Record<string, HeaderValue> {
  const header: Record<string, HeaderValue> = {};
  for (const key of CARRIED_HEADER) {
    const v = model.header.get(key);
    if (v !== undefined) header[key] = v;
  }
  return header;
}

/** The new drawing: `copy`'s objects with the drawing's units settings, in `units`. */
function blockDrawing(ctx: CommandContext, copy: ClipboardCopy, units: number): BlockDrawing {
  const header = carriedHeader(ctx.model);
  header['$INSUNITS'] = units;
  header['$INSBASE'] = { x: 0, y: 0, z: 0 };
  return { content: copy.clipboard, header };
}

/** Why a dimension stays out of WBLOCK's new drawing. */
const BLOCKLESS = 'a dimension without its block';

/**
 * What WBLOCK writes of `ids`, based at `base`: a dimension without its block (as some files
 * hold one) stays out, counted, since nothing draws one into the new drawing and AutoCAD shows
 * none without it (an open drawing's save gives it one, M2-30 part 2).
 */
export function wblockCopy(
  model: DocumentModel,
  ids: readonly EntityId[],
  base: Vec2,
): ClipboardCopy {
  let blockless = 0;
  const taken = ids.filter((id) => {
    const g = model.entity(id)?.geom;
    const out = g?.kind === 'DIMENSION' && g.block === undefined;
    if (out) blockless++;
    return !out;
  });
  const copy = copyToClipboard(model, taken, base);
  if (blockless === 0) return copy;
  return { ...copy, refused: new Map([...copy.refused, [BLOCKLESS, blockless]]) };
}

/** Hands the new drawing (or, without one, the whole drawing) to the app; false if it failed. */
async function writeFile(
  ctx: CommandContext,
  file: string,
  copy?: ClipboardCopy,
  units = insUnitsOf(ctx.model),
): Promise<boolean> {
  const reply = await ctx.view.request({
    op: 'writeBlock',
    file,
    ...(copy && { drawing: blockDrawing(ctx, copy, units) }),
  });
  if (!reply.ok) {
    ctx.message(reply.message);
    return false;
  }
  for (const line of refusalMessages(copy?.refused ?? new Map(), 'written')) ctx.message(line);
  ctx.message(`Wrote ${reply.file ?? file}.`);
  return true;
}

/** A block's contents, based at its base point. */
function blockCopy(ctx: CommandContext, name: string): ClipboardCopy {
  const r = blockNamed(ctx.model, name)!;
  const def = ctx.model.blocks.get(r.handle)!;
  return wblockCopy(ctx.model, ctx.model.blockEntities(r.handle), def.basePoint);
}

/** Why `name` cannot be written: no such block, or an external reference. */
function blockRefusal(ctx: CommandContext, name: string): string | undefined {
  const r = name === '' ? undefined : blockNamed(ctx.model, name);
  if (!r || !ctx.model.hasBlock(r.handle)) return `Block "${name}" not found.`;
  if (isXrefRecord(r)) return `Block "${r.name}" is an external reference.`;
  return undefined;
}

// ── -WBLOCK ───────────────────────────────────────────────────────────────────────────────────

async function* dashWblock(ctx: CommandContext): Sub<void> {
  const f = yield ctx.prompt.string({ message: 'Enter name of output file', spaces: true });
  if (f.kind !== 'string' || f.value.trim() === '') return;
  const file = wblockFileName(f.value);
  const a = yield ctx.prompt.string({
    message: 'Enter name of existing block or [= (block=output file)/* (whole drawing)]',
    defaultLabel: 'define new drawing',
    spaces: true,
  });
  if (a.kind !== 'string' && a.kind !== 'enter') return;
  const typed = a.kind === 'string' ? a.value.trim() : '';
  if (typed === '*') {
    await writeFile(ctx, file);
    return;
  }
  if (typed !== '') {
    const name = typed === '=' ? fileBlockName(file) : typed;
    const refusal = blockRefusal(ctx, name);
    if (refusal) {
      ctx.message(refusal);
      return;
    }
    await writeFile(ctx, file, blockCopy(ctx, name));
    return;
  }
  // A new drawing of the objects selected, which are erased once written.
  const p = yield ctx.prompt.point({ message: 'Specify insertion base point' });
  if (p.kind !== 'point') return;
  const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  const ids = s.kind === 'selection' ? s.ids : [];
  if (ids.length === 0) {
    ctx.message('No objects selected.');
    return;
  }
  if (!(await writeFile(ctx, file, wblockCopy(ctx.model, ids, p.point)))) return;
  ctx.edit((b) => eraseObjects(b, ctx.model, ids));
}

// ── WBLOCK: the Write Block dialog ────────────────────────────────────────────────────────────

const SOURCES = new Set(['block', 'drawing', 'objects']);
const OBJECT_CHOICES = new Set(['retain', 'convert', 'delete']);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validSettings(s: unknown): s is WriteBlockSettings {
  const v = s as WriteBlockSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    SOURCES.has(v.source) &&
    typeof v.block === 'string' &&
    Number.isFinite(v.base?.x) &&
    Number.isFinite(v.base?.y) &&
    OBJECT_CHOICES.has(v.objects) &&
    typeof v.file === 'string' &&
    Number.isInteger(v.units) &&
    v.units >= 0 &&
    v.units < INSUNITS_NAMES.length
  );
}

/** The settings the dialog closed with last, per drawing (AutoCAD keeps them for the session). */
const lastSettings = new WeakMap<object, WriteBlockSettings>();

async function* wblockDialog(ctx: CommandContext): Sub<void> {
  const blocks = insertableBlocks(ctx.model).map((r) => r.name);
  const last = lastSettings.get(ctx.model);
  let settings: WriteBlockSettings = {
    source: 'objects',
    block: blocks[0] ?? '',
    base: { x: 0, y: 0 },
    objects: 'retain',
    file: 'new block.dxf',
    units: insUnitsOf(ctx.model),
    ...(last && { objects: last.objects, units: last.units }),
  };
  let ids: readonly EntityId[] = ctx.preselected;
  let note: string | undefined;
  for (;;) {
    const a = yield ctx.prompt.dialog({
      message: 'Write Block',
      dialog: {
        type: 'wblock',
        settings,
        selected: ids.length,
        blocks,
        ...(note !== undefined && { note }),
      },
    });
    note = undefined;
    if (a.kind !== 'dialog' || !a.wblock || !validSettings(a.wblock.settings)) return;
    settings = a.wblock.settings;
    if (a.wblock.pick === 'point') {
      const p = yield ctx.prompt.point({ message: 'Specify insertion base point', escape: true });
      if (p.kind === 'point') settings = { ...settings, base: toUcs(currentUcs(ctx), p.point) };
      continue;
    }
    if (a.wblock.pick === 'objects') {
      const s = yield ctx.prompt.selection({
        message: 'Select objects',
        pickfirst: false,
        escape: true,
      });
      if (s.kind === 'selection') ids = s.ids;
      continue;
    }
    if (a.action !== 'ok') return;

    // OK: what refuses the file reopens the dialog saying why (AutoCAD's alerts).
    const file = wblockFileName(settings.file);
    const name = fileBlockName(file);
    if (settings.source === 'block') note = blockRefusal(ctx, settings.block.trim());
    else if (settings.source === 'objects') {
      if (ids.length === 0) note = 'No objects selected.';
      else if (settings.objects === 'convert') {
        const existing = blockNamed(ctx.model, name);
        note =
          blockNameProblem(name) ??
          (existing ? `Block "${existing.name}" already exists.` : undefined);
      }
    }
    if (note) continue;
    lastSettings.set(ctx.model, settings);
    if (settings.source === 'drawing') {
      await writeFile(ctx, file);
      return;
    }
    if (settings.source === 'block') {
      await writeFile(ctx, file, blockCopy(ctx, settings.block.trim()), settings.units);
      return;
    }
    const ucs = currentUcs(ctx);
    const base = toWorld(ucs, settings.base);
    const copy = wblockCopy(ctx.model, ids, base);
    if (!(await writeFile(ctx, file, copy, settings.units))) return;
    if (settings.objects === 'delete') ctx.edit((b) => eraseObjects(b, ctx.model, ids));
    if (settings.objects !== 'convert') return;
    // Convert to block: the objects become block `name`, a reference lying over them.
    const definitions = ids
      .map((id) => ctx.model.entity(id))
      .filter(
        (e): e is NonNullable<typeof e> =>
          e?.geom.kind === 'ATTDEF' &&
          ((e.geom as AttdefGeometry).flags & ATTRIBUTE_CONSTANT) === 0,
      );
    ctx.edit((b) => {
      const made = defineBlock(b, ctx.model, { name, base, ids, ucs, erase: true });
      const geom: InsertGeometry = {
        kind: 'INSERT',
        block: made.block,
        position: base,
        scale: { x: 1, y: 1, z: 1 },
        rotation: ucs.angle,
        attributes: definitions.map((e) => definitionAttribute(e)),
      };
      placeReference(b, ctx.model, ctx.space, currentProps(ctx.model), geom);
    });
    return;
  }
}

export function wblockCommand(): CommandDef {
  return {
    name: 'WBLOCK',
    dashVariant: true,
    erases: true,
    usesSelection: 'during',
    async *run(ctx) {
      if (ctx.dash) yield* dashWblock(ctx);
      else yield* wblockDialog(ctx);
    },
  };
}
