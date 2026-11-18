// Blocks at the command line (M5-01 part 1): -BLOCK, -INSERT and BASE, with AutoCAD 2024's prompts
// (AutoCAD Help, "-BLOCK (Command)", "-INSERT (Command)", "BASE (Command)"):
//
//   -BLOCK   Enter block name or [?]:
//            Block "NAME" already exists. Redefine it? [Yes/No] <No>:     (a name in use)
//            Specify insertion base point:
//            Select objects:
//   -INSERT  Enter block name or [?] <last>:                              (*NAME explodes it)
//            Units: Millimeters   Conversion:  1.0000
//            Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:
//            Enter X scale factor, specify opposite corner, or [Corner/XYZ] <1>:
//            Enter Y scale factor <use X scale factor>:
//            Specify rotation angle <0>:
//            Enter attribute values                                       (ATTREQ 1)
//   BASE     Enter base point <0.0000,0.0000,0.0000>:
//
// A drawing file as the block (M5-01 part 4, AutoCAD Help "-INSERT (Command)": "name=file"
// "inserts a drawing file as a block named name"; "About Inserting Blocks"): -INSERT's
// `name=file` (`name=` takes the file of the block's own name), and a name no block has, read
// the drawing file, whose model space becomes the block, based at its $INSBASE, in its units;
// INSERT's Browse... picks the file in the dialog. A block of the name already there is
// redefined from the file at the command line's "Block "NAME" already exists. Redefine it?
// [Yes/No] <No>" (No inserts the block as it is) and at the dialog's Redefine Block question.
// The browser reads no folder by itself, so the app finds a typed file among the drawings open
// and the files given for xrefs; "File "NAME" not found." otherwise.
//
// BLOCK opens the Block Definition dialog (M5-01 part 2, below), INSERT the Insert dialog (part
// 3, below). What the blocks and references are made of is `edit/blocks.ts`'s.
//
// Ambiguities, settled for the common drafter expectation and noted in the PR:
// - Help does not word the refusals; they read "Invalid block name." (asked again), "Block "B"
//   references itself.", "Block "B" not found." and "Block "B" is an external reference.";
// - -BLOCK's Annotative option is left out: Triya makes no annotative objects (DEC-058);
// - -INSERT's X, Y, Z presets set that axis alone (the others stay 1) and, like Scale, skip
//   the scale prompts that follow the insertion point; Basepoint's point is picked on the block
//   as its definition places it (base point at its own base point, unscaled, unturned);
// - ATTDIA 1 asks new attribute values in the Edit Attributes dialog (M5-01 part 3), whose Cancel
//   ends the command, nothing placed; a missing $ATTDIA is 0, the command line.
import type { Vec2 } from '../geom/types';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type {
  AttdefGeometry,
  BlockTableRecord,
  Entity,
  EntityGeometry,
  InsertGeometry,
} from '../model/types';
import {
  ATTRIBUTE_CONSTANT,
  ATTRIBUTE_PRESET,
  ATTRIBUTE_VERIFY,
  attributeDefinitions,
  blockNameProblem,
  blockNamed,
  defineBlock,
  definitionAttribute,
  insertableBlocks,
  placeReference,
  referenceGeometry,
  selfReferences,
  type BlockPlacement,
  type BlockSettings,
} from '../edit/blocks';
import { refusalMessages } from '../edit/edit';
import { blockFromClipboard, clipboardHoldsBlock, type Clipboard } from '../edit/clipboard';
import { followedBy, moveBy, scaleAbout, turnAbout } from '../edit/similarity';
import { transformGeometry } from '../edit/transform';
import { isXrefRecord } from '../model/xref';
import { insUnitsOf, insUnitsScale } from '../model/units';
import { currentProps } from '../properties/current';
import { toUcs, toWorld, turnToUcs } from '../input/ucs';
import { INSUNITS_NAMES } from './drawing-units';
import { definitionEntry, wcmatch } from './modify/attributes';
import { currentUcs } from './ucs';
import { drawingUnits, formatDistance, formatNumber } from './units';
import { modelSpaceOf } from './bus';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The block INSERT offers next (AutoCAD's INSNAME): the last one inserted in the drawing. */
const lastInserted = new WeakMap<object, string>();

/** What the preview can draw without the drawing's blocks and styles: the curves. */
const DRAWN = new Set(['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'SPLINE', 'POINT']);

/** The most objects of a block dragged with the cursor. */
const DRAGGED = 2000;

// ── ? ─────────────────────────────────────────────────────────────────────────────────────────

/** `?`: the blocks whose names match the patterns, then how many of each kind the drawing has. */
async function* listBlocks(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter block(s) to list',
    default: { kind: 'string', value: '*' },
  });
  // A string prompt with a default answers a string (Esc ends the command).
  const pattern = (a as { readonly value: string }).value;
  const records = [...ctx.model.tables.blockRecords.values()];
  const named = insertableBlocks(ctx.model).filter((r) => wcmatch(r.name, pattern));
  ctx.message('Defined blocks.');
  for (const r of named) ctx.message(`  "${r.name}"`);
  const user = records.filter((r) => !r.name.startsWith('*') && !isXrefRecord(r));
  const xrefs = records.filter((r) => isXrefRecord(r));
  const dependent = user.filter((r) => r.name.includes('|'));
  const unnamed = records.filter(
    (r) => r.name.startsWith('*') && !/^\*(MODEL|PAPER)_SPACE/i.test(r.name),
  );
  ctx.message('User      External     Dependent    Unnamed');
  ctx.message('Blocks    References   Blocks       Blocks');
  ctx.message(
    [user.length - dependent.length, xrefs.length, dependent.length, unnamed.length]
      .map((n, i) => String(n).padEnd([10, 13, 13, 0][i]!))
      .join('')
      .trimEnd(),
  );
}

// ── -BLOCK ────────────────────────────────────────────────────────────────────────────────────

/** "Enter block name or [?]": a valid name, or undefined at Enter or Esc. */
async function* blockName(ctx: CommandContext): Sub<string | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({ message: 'Enter block name or', options: ['?'] });
    if (a.kind === 'keyword') {
      yield* listBlocks(ctx);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    const problem = blockNameProblem(a.value);
    if (!problem) return a.value.trim();
    ctx.message(problem);
  }
}

export function blockCommand(): CommandDef {
  return {
    name: 'BLOCK',
    dashVariant: true,
    erases: true,
    usesSelection: 'during',
    async *run(ctx) {
      if (!ctx.dash) {
        yield* blockDialog(ctx);
        return;
      }
      const name = yield* blockName(ctx);
      if (name === undefined) return;
      const existing = blockNamed(ctx.model, name);
      if (existing) {
        if (isXrefRecord(existing)) {
          ctx.message(`Block "${existing.name}" is an external reference.`);
          return;
        }
        const a = yield ctx.prompt.keyword({
          message: `Block "${existing.name}" already exists. Redefine it?`,
          options: ['Yes', 'No'],
          default: { kind: 'keyword', keyword: 'No' },
        });
        if ((a as { readonly keyword: string }).keyword !== 'Yes') return;
      }
      const at = yield ctx.prompt.point({ message: 'Specify insertion base point' });
      if (at.kind !== 'point') return;
      const s = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      const ids = (s as { readonly ids: readonly EntityId[] }).ids;
      if (ids.length === 0) {
        ctx.message('No objects selected.');
        return;
      }
      if (existing && selfReferences(ctx.model, ids, existing.handle).length > 0) {
        ctx.message(`Block "${existing.name}" references itself.`);
        return;
      }
      const ucs = currentUcs(ctx);
      let refused: ReadonlyMap<string, number> = new Map();
      ctx.edit((b) => {
        refused = defineBlock(b, ctx.model, {
          name,
          base: at.point,
          ids,
          ucs,
          erase: true,
        }).refused;
      });
      for (const line of refusalMessages(refused, 'put in the block')) ctx.message(line);
    },
  };
}

// ── BLOCK: the Block Definition dialog ─────────────────────────────────────────────────────────
//
// AutoCAD 2024 Help, "Block Definition Dialog Box": Name; Base point (Specify On-screen, Pick
// point, X, Y, Z); Objects (Specify On-screen, Select objects, Quick Select, Retain / Convert to
// block / Delete, the count selected); Behavior (Annotative, Scale uniformly, Allow exploding);
// Settings (Block unit, Hyperlink); Description; Open in block editor. Pick point and Select
// objects close the dialog for the pick and open it again; with Specify On-screen the point or
// the objects are asked once OK closes it. Objects selected as BLOCK starts are its objects.
//
// Left out, and why: Z (Triya draws the plan; a block's base point is 2D), Quick Select (QSELECT
// is its own command), Annotative (DEC-058), Hyperlink (Triya has no hyperlinks) and Open in block
// editor (BEDIT is M5-02). Where Help is silent, settled for the common drafter expectation:
// the dialog opens on a blank name, base 0,0, the drawing's units and the last Objects choice
// (Convert to block the first time); picking a block in the Name list shows its settings
// (the web dialog); the dialog itself asks before redefining a block and before making an empty
// one; a converted reference is on the current layer, turned with the UCS so that it lies over
// the objects, its attribute values asked as -INSERT asks them (ATTREQ).

/** The Block Definition dialog's fields. */
export interface BlockDefinitionSettings {
  readonly name: string;
  /** The base point, in the current UCS. */
  readonly base: Vec2;
  /** Base point "Specify On-screen": asked once the dialog closes. */
  readonly baseOnScreen: boolean;
  /** Objects "Specify On-screen": selected once the dialog closes. */
  readonly objectsOnScreen: boolean;
  /** What becomes of the objects: Retain, Convert to block or Delete. */
  readonly objects: 'retain' | 'convert' | 'delete';
  readonly scaleUniformly: boolean;
  readonly allowExploding: boolean;
  /** Block unit, an `$INSUNITS` code. */
  readonly units: number;
  readonly description: string;
}

/** A block the Name list offers, with the settings the dialog shows when it is picked. */
export interface BlockDefinitionEntry {
  readonly name: string;
  readonly scaleUniformly: boolean;
  readonly allowExploding: boolean;
  readonly units: number;
  readonly description: string;
}

/** BLOCK's Block Definition dialog. */
export interface BlockDefinitionRequest {
  readonly type: 'block';
  readonly settings: BlockDefinitionSettings;
  /** How many objects are selected (the Objects group's "n objects selected"). */
  readonly selected: number;
  /** The drawing's blocks, as the Name list offers them (insertable, by name). */
  readonly blocks: readonly BlockDefinitionEntry[];
  /** Why the last OK made nothing ("Invalid block name."). */
  readonly note?: string;
}

/** The Block Definition dialog's answer: its fields, and the pick that closed it, if one did. */
export interface BlockDefinitionAnswer {
  readonly settings: BlockDefinitionSettings;
  readonly pick?: 'point' | 'objects';
}

/** The Objects choice the dialog opens on next, per drawing (AutoCAD keeps it per session). */
const lastObjects = new WeakMap<object, BlockDefinitionSettings['objects']>();

const OBJECT_CHOICES = new Set(['retain', 'convert', 'delete']);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validBlockSettings(s: unknown): s is BlockDefinitionSettings {
  const v = s as BlockDefinitionSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.name === 'string' &&
    Number.isFinite(v.base?.x) &&
    Number.isFinite(v.base?.y) &&
    OBJECT_CHOICES.has(v.objects) &&
    Number.isInteger(v.units) &&
    v.units >= 0 &&
    v.units < INSUNITS_NAMES.length &&
    typeof v.description === 'string'
  );
}

function entryOf(ctx: CommandContext, name: string): BlockDefinitionEntry {
  const r = blockNamed(ctx.model, name)!;
  return {
    name: r.name,
    scaleUniformly: !r.scalable,
    allowExploding: r.explodable,
    units: r.units,
    description: ctx.model.blocks.get(r.handle)?.description ?? '',
  };
}

async function* blockDialog(ctx: CommandContext): Sub<void> {
  let settings: BlockDefinitionSettings = {
    name: '',
    base: { x: 0, y: 0 },
    baseOnScreen: false,
    objectsOnScreen: false,
    objects: lastObjects.get(ctx.model) ?? 'convert',
    scaleUniformly: false,
    allowExploding: true,
    units: insUnitsOf(ctx.model),
    description: '',
  };
  let ids: readonly EntityId[] = ctx.preselected;
  let note: string | undefined;
  for (;;) {
    const a = yield ctx.prompt.dialog({
      message: 'Block Definition',
      dialog: {
        type: 'block',
        settings,
        selected: ids.length,
        blocks: insertableBlocks(ctx.model).map((r) => entryOf(ctx, r.name)),
        ...(note !== undefined && { note }),
      },
    });
    note = undefined;
    if (a.kind !== 'dialog' || !a.block || !validBlockSettings(a.block.settings)) return;
    settings = a.block.settings;
    if (a.block.pick === 'point') {
      const p = yield ctx.prompt.point({
        message: 'Specify insertion base point',
        escape: true,
      });
      if (p.kind === 'point') settings = { ...settings, base: toUcs(currentUcs(ctx), p.point) };
      continue;
    }
    if (a.block.pick === 'objects') {
      // A selection of its own, not the pre-selection the dialog opened on.
      const s = yield ctx.prompt.selection({
        message: 'Select objects',
        pickfirst: false,
        escape: true,
      });
      if (s.kind === 'selection') ids = s.ids;
      continue;
    }
    if (a.action !== 'ok') return;

    // OK: what refuses the block reopens the dialog saying why (AutoCAD's alerts).
    const name = settings.name.trim();
    const existing = blockNameProblem(name) ? undefined : blockNamed(ctx.model, name);
    note =
      blockNameProblem(name) ??
      (existing && isXrefRecord(existing)
        ? `Block "${existing.name}" is an external reference.`
        : undefined);
    if (!note && existing && !settings.objectsOnScreen) note = selfReference(ctx, ids, existing);
    if (note) continue;
    lastObjects.set(ctx.model, settings.objects);
    yield* makeBlock(ctx, settings, ids);
    return;
  }
}

/** Why `ids` cannot go into `existing`: one of them is, or holds, a reference to it. */
function selfReference(
  ctx: CommandContext,
  ids: readonly EntityId[],
  existing: { readonly handle: string; readonly name: string },
): string | undefined {
  return selfReferences(ctx.model, ids, existing.handle).length > 0
    ? `Block "${existing.name}" references itself.`
    : undefined;
}

/** The dialog's OK: the on-screen picks, then the block, the objects' fate and any reference. */
async function* makeBlock(
  ctx: CommandContext,
  settings: BlockDefinitionSettings,
  selected: readonly EntityId[],
): Sub<void> {
  const ucs = currentUcs(ctx);
  let base = toWorld(ucs, settings.base);
  if (settings.baseOnScreen) {
    const p = yield ctx.prompt.point({ message: 'Specify insertion base point' });
    if (p.kind !== 'point') return;
    base = p.point;
  }
  let ids = selected;
  if (settings.objectsOnScreen) {
    const s = yield ctx.prompt.selection({ message: 'Select objects', pickfirst: false });
    ids = s.kind === 'selection' ? s.ids : [];
    if (ids.length === 0) {
      ctx.message('No objects selected.');
      return;
    }
  }
  const name = settings.name.trim();
  const existing = blockNamed(ctx.model, name);
  const refusal = existing && selfReference(ctx, ids, existing);
  if (refusal) {
    ctx.message(refusal);
    return;
  }

  // Convert to block: the reference's attributes are the selected definitions, as they lie.
  // An empty block has nothing to convert.
  const convert = settings.objects === 'convert' && ids.length > 0;
  const definitions = convert
    ? ids
        .map((id) => ctx.model.entity(id))
        .filter(
          (e): e is NonNullable<typeof e> =>
            e?.geom.kind === 'ATTDEF' &&
            ((e.geom as AttdefGeometry).flags & ATTRIBUTE_CONSTANT) === 0,
        )
    : [];
  const values = yield* attributeValues(ctx, name, definitions);
  if (!values) return;

  const blockSettings: BlockSettings = {
    units: settings.units,
    explodable: settings.allowExploding,
    scalable: !settings.scaleUniformly,
    description: settings.description.trim(),
  };
  let refused: ReadonlyMap<string, number> = new Map();
  ctx.edit((b) => {
    const made = defineBlock(b, ctx.model, {
      name,
      base,
      ids,
      ucs,
      erase: settings.objects !== 'retain',
      settings: blockSettings,
    });
    refused = made.refused;
    if (!convert) return;
    // The reference lies over the objects: at the base point, turned with the UCS the block was
    // made in, unscaled.
    const geom: InsertGeometry = {
      kind: 'INSERT',
      block: made.block,
      position: base,
      scale: { x: 1, y: 1, z: 1 },
      rotation: ucs.angle,
      attributes: definitions.map((e, i) => definitionAttribute(e, values[i])),
    };
    placeReference(b, ctx.model, ctx.space, currentProps(ctx.model), geom);
  });
  for (const line of refusalMessages(refused, 'put in the block')) ctx.message(line);
}

// ── -INSERT ───────────────────────────────────────────────────────────────────────────────────

/** "Enter block name or [?] <last>": the block's name as typed (`*` kept), or undefined. */
async function* insertName(ctx: CommandContext): Sub<string | undefined> {
  const last = lastInserted.get(ctx.model);
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter block name or',
      options: ['?'],
      ...(last !== undefined && { default: { kind: 'string' as const, value: last } }),
    });
    if (a.kind === 'keyword') {
      yield* listBlocks(ctx);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    return a.value.trim();
  }
}

/** The curves of `block` placed by `p`, for dragging (none past `DRAGGED`). */
function previewOf(ctx: CommandContext, block: string, p: BlockPlacement): EntityGeometry[] {
  // A block too big to drag shows its first objects only.
  const ids = ctx.model.blockEntities(block).slice(0, DRAGGED);
  const def = ctx.model.blocks.get(block)!;
  const k = Math.abs(p.scale.x);
  let t = moveBy({ x: p.position.x - def.basePoint.x, y: p.position.y - def.basePoint.y });
  if (k !== 1) t = followedBy(t, scaleAbout(p.position, k));
  if (p.rotation !== 0) t = followedBy(t, turnAbout(p.position, p.rotation));
  const out: EntityGeometry[] = [];
  for (const id of ids) {
    const g = ctx.model.entity(id)?.geom;
    if (g && DRAWN.has(g.kind)) out.push(transformGeometry(g, t));
  }
  return out;
}

/** "Specify … scale factor <1>": the number typed, 1 at Enter. */
async function* scaleFactor(ctx: CommandContext, message: string): Sub<number> {
  const a = yield ctx.prompt.real({ message, defaultLabel: '1' });
  return a.kind === 'number' ? a.value : 1;
}

/** "Specify … scale factor <use X scale factor>": the number typed, `x` at Enter. */
async function* otherScale(ctx: CommandContext, message: string, x: number): Sub<number> {
  const a = yield ctx.prompt.real({ message, defaultLabel: 'use X scale factor' });
  return a.kind === 'number' ? a.value : x;
}

interface Presets {
  scale?: { x: number; y: number; z: number };
  rotation?: number;
  /** The block's point the insertion point takes, in block coordinates (Basepoint). */
  base?: Vec2;
}

/** The world angle that rotation 0 is (the current UCS's X axis). */
const zeroAngle = (ctx: CommandContext) => currentUcs(ctx).angle;

/** "Specify rotation angle <0>": an angle prompt with a default answers an angle. */
async function* rotationAngle(ctx: CommandContext, base?: Vec2): Sub<number> {
  const a = yield ctx.prompt.angle({
    message: 'Specify rotation angle',
    ...(base && { base }),
    default: { kind: 'angle', value: zeroAngle(ctx) },
  });
  return (a as { readonly value: number }).value;
}

export function insertCommand(): CommandDef {
  return {
    name: 'INSERT',
    dashVariant: true,
    usesSelection: 'none',
    async *run(ctx) {
      if (!ctx.dash) return yield* insertDialog(ctx);
      const typed = yield* insertName(ctx);
      if (typed === undefined) return;
      const explode = typed.startsWith('*');
      let name = explode ? typed.slice(1).trim() : typed;
      // name=file, or a name no block has: the drawing file (M5-01 part 4).
      const eq = name.indexOf('=');
      const file =
        eq >= 0
          ? name.slice(eq + 1).trim() || name.slice(0, eq).trim()
          : name !== '' && !insertableBlock(ctx, name)
            ? name
            : undefined;
      if (file !== undefined) {
        name = eq >= 0 ? name.slice(0, eq).trim() : fileBlockName(file);
        const loaded = yield* fileBlock(ctx, name, file, eq >= 0);
        if (!loaded) return;
      }
      const refusal = insertRefusal(ctx, name);
      if (refusal) {
        ctx.message(refusal);
        return;
      }
      const r = blockNamed(ctx.model, name)!;
      const k = insUnitsScale(r.units, insUnitsOf(ctx.model));
      ctx.message(`Units: ${INSUNITS_NAMES[r.units]}   Conversion:  ${formatNumber(k, 4)}`);
      yield* insertBlock(ctx, r, { explode, uniform: explode || r.scalable === false });
    },
  };
}

/** The block `name` names, when it has contents and is no xref. */
function insertableBlock(ctx: CommandContext, name: string): BlockTableRecord | undefined {
  const r = blockNamed(ctx.model, name);
  return r && ctx.model.hasBlock(r.handle) && !isXrefRecord(r) ? r : undefined;
}

/** The block a drawing file makes: its name without folders and extension. */
export function fileBlockName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.(dxf|dwg)$/i, '').trim();
}

/**
 * -INSERT's drawing file as block `name` (`typed`: as `name=file`, else a name no block has):
 * asks before redefining a block of the name (No keeps it, to be inserted as it is), then reads
 * the file through the app and makes the block. Returns false when nothing is to be inserted.
 */
async function* fileBlock(
  ctx: CommandContext,
  name: string,
  file: string,
  typed: boolean,
): Sub<boolean> {
  // A name no block has is a block not found, unless a drawing file of that name answers it.
  const notFound = `Block "${name}" not found.`;
  const problem = blockNameProblem(name);
  if (problem) {
    ctx.message(typed ? problem : notFound);
    return false;
  }
  const existing = blockNamed(ctx.model, name);
  if (existing && isXrefRecord(existing)) {
    ctx.message(`Block "${existing.name}" is an external reference.`);
    return false;
  }
  if (existing && ctx.model.hasBlock(existing.handle)) {
    const a = yield ctx.prompt.keyword({
      message: `Block "${existing.name}" already exists. Redefine it?`,
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'No' },
    });
    if ((a as { readonly keyword: string }).keyword !== 'Yes') return true;
  }
  const reply = await ctx.view.request({ op: 'drawingFile', file });
  if (!reply.ok || !reply.drawing) {
    // A file found that cannot be read says why; one not found, what the drafter asked for.
    ctx.message(!reply.ok ? reply.message : typed ? `File "${file}" not found.` : notFound);
    return false;
  }
  return blockOfDrawing(ctx, name, reply.drawing.content);
}

/** Why a drawing file cannot be block `name` (the Insert dialog's note). */
function drawingRefusal(ctx: CommandContext, name: string, content: Clipboard): string | undefined {
  const problem = blockNameProblem(name);
  if (problem) return problem;
  const existing = blockNamed(ctx.model, name);
  if (existing && isXrefRecord(existing))
    return `Block "${existing.name}" is an external reference.`;
  if (clipboardHoldsBlock(content, name)) return `Block "${name}" references itself.`;
  return undefined;
}

/** Block `name` made, or redefined, from a drawing's contents; false when it would hold itself. */
function blockOfDrawing(ctx: CommandContext, name: string, content: Clipboard): boolean {
  if (clipboardHoldsBlock(content, name)) {
    ctx.message(`Block "${name}" references itself.`);
    return false;
  }
  let refused: ReadonlyMap<string, number> = new Map();
  let redefined = false;
  ctx.edit((b) => {
    const made = blockFromClipboard(b, ctx.model, content, name);
    refused = made.refused;
    redefined = made.redefined;
  });
  if (redefined) ctx.message(`Block "${name}" redefined.`);
  for (const line of refusalMessages(refused, 'put in the block')) ctx.message(line);
  return true;
}

/** Why `name` cannot be inserted: no such block, or an external reference. */
function insertRefusal(ctx: CommandContext, name: string): string | undefined {
  const r = name === '' || name.startsWith('*') ? undefined : blockNamed(ctx.model, name);
  if (!r || !ctx.model.hasBlock(r.handle)) return `Block "${name}" not found.`;
  if (isXrefRecord(r)) return `Block "${r.name}" is an external reference.`;
  return undefined;
}

/** How a block is placed: what is fixed beforehand, and what is asked. */
export interface Placing {
  /** Contents placed, not a reference (`*NAME`, the dialog's Explode). */
  readonly explode: boolean;
  /** One scale factor for X, Y and Z. */
  readonly uniform: boolean;
  /** The insertion point (world), not asked. */
  readonly at?: Vec2;
  /** The scale (before the unit conversion), not asked. */
  readonly scale?: { x: number; y: number; z: number };
  /** The rotation (world), not asked. */
  readonly rotation?: number;
  /** Repeat Placement: the insertion point asked again after each placement, until Esc. */
  readonly repeat?: boolean;
  /**
   * An xref placed (XATTACH, M5-04 part 6): its insertion point prompt has no Basepoint, as
   * XATTACH's has none, and the reference is not the block INSERT offers next (INSNAME).
   */
  readonly xref?: boolean;
}

/**
 * Places block `r` as -INSERT asks for it (the insertion point with its presets, the scale, the
 * rotation, the attribute values), what `placing` fixes not asked; once, or until Esc with
 * Repeat Placement.
 */
export async function* insertBlock(
  ctx: CommandContext,
  r: BlockTableRecord,
  placing: Placing,
): Sub<void> {
  const block = r.handle;
  const def = ctx.model.blocks.get(block)!;
  const k = insUnitsScale(r.units, insUnitsOf(ctx.model));
  const { explode, uniform } = placing;
  for (;;) {
    // The insertion point, after any presets.
    const presets: Presets = {
      ...(placing.scale && { scale: placing.scale }),
      ...(placing.rotation !== undefined && { rotation: placing.rotation }),
    };
    const options = explode
      ? ['Basepoint', 'Scale', 'Rotate']
      : placing.xref
        ? ['Scale', 'X', 'Y', 'Z', 'Rotate']
        : ['Basepoint', 'Scale', 'X', 'Y', 'Z', 'Rotate'];
    let at = placing.at;
    while (!at) {
      const scale = presets.scale ?? { x: 1, y: 1, z: 1 };
      const shown: BlockPlacement = {
        position: def.basePoint,
        scale: { x: scale.x * k, y: scale.y * k, z: scale.z * k },
        rotation: presets.rotation ?? zeroAngle(ctx),
      };
      ctx.preview(previewOf(ctx, block, shown));
      const a = yield ctx.prompt.point({
        message: 'Specify insertion point or',
        options,
        drag: { kind: 'preview', from: def.basePoint },
      });
      ctx.preview([]);
      if (a.kind === 'point') {
        at = a.point;
        break;
      }
      if (a.kind !== 'keyword') return;
      switch (a.keyword) {
        case 'Basepoint': {
          ctx.preview(
            previewOf(ctx, block, {
              position: def.basePoint,
              scale: { x: 1, y: 1, z: 1 },
              rotation: 0,
            }),
          );
          const p = yield ctx.prompt.point({ message: 'Specify base point' });
          ctx.preview([]);
          if (p.kind !== 'point') return;
          presets.base = p.point;
          break;
        }
        case 'Scale': {
          const v = yield* scaleFactor(ctx, 'Specify scale factor for XYZ axes');
          presets.scale = { x: v, y: v, z: v };
          break;
        }
        case 'X':
        case 'Y':
        case 'Z': {
          const v = yield* scaleFactor(ctx, `Specify ${a.keyword} scale factor`);
          const was = presets.scale ?? { x: 1, y: 1, z: 1 };
          presets.scale = { ...was, [a.keyword.toLowerCase()]: v };
          break;
        }
        default:
          presets.rotation = yield* rotationAngle(ctx);
      }
    }

    // The scale, unless preset.
    let scale = presets.scale;
    if (!scale && uniform) {
      const v = yield* scaleFactor(ctx, 'Specify scale factor for XYZ axes');
      scale = { x: v, y: v, z: v };
    }
    while (!scale) {
      const a = yield ctx.prompt.distance({
        message: 'Enter X scale factor, specify opposite corner, or',
        options: ['Corner', 'XYZ'],
        base: at,
        defaultLabel: '1',
      });
      let corner: Vec2 | undefined;
      if (a.kind === 'distance' && a.to) corner = a.to;
      else if (a.kind !== 'keyword') {
        // A number typed, or 1 at Enter.
        const x = a.kind === 'distance' ? a.value : 1;
        scale = { x, y: yield* otherScale(ctx, 'Enter Y scale factor', x), z: x };
      } else if (a.keyword === 'Corner') {
        const c = yield ctx.prompt.point({
          message: 'Specify opposite corner',
          rubberBand: { from: at, box: true },
        });
        if (c.kind !== 'point') return;
        corner = c.point;
      } else {
        // XYZ.
        const x = yield* scaleFactor(ctx, 'Specify X scale factor');
        const y = yield* otherScale(ctx, 'Specify Y scale factor', x);
        scale = { x, y, z: yield* otherScale(ctx, 'Specify Z scale factor', x) };
      }
      if (corner) {
        // The corner's offset along the UCS's axes is the X and Y scale.
        const d = turnToUcs(currentUcs(ctx), { x: corner.x - at.x, y: corner.y - at.y });
        if (d.x === 0 || d.y === 0) {
          ctx.message('Value must be nonzero.');
          continue;
        }
        scale = { x: d.x, y: d.y, z: d.x };
      }
      if (scale && (scale.x === 0 || scale.y === 0 || scale.z === 0)) {
        ctx.message('Value must be nonzero.');
        scale = undefined;
      }
    }

    // The rotation, unless preset.
    const rotation = presets.rotation ?? (yield* rotationAngle(ctx, at));

    const total = { x: scale.x * k, y: scale.y * k, z: scale.z * k };
    // Basepoint: the block's point `presets.base` goes to `at`, not its base point.
    let position = at;
    if (presets.base) {
      const offset = { x: presets.base.x - def.basePoint.x, y: presets.base.y - def.basePoint.y };
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      const ox = offset.x * total.x;
      const oy = offset.y * total.y;
      position = { x: at.x - (ox * c - oy * s), y: at.y - (ox * s + oy * c) };
    }

    // The attribute values (none for an exploded insert: its definitions stay definitions).
    const definitions = explode ? [] : attributeDefinitions(ctx.model, block);
    const values = yield* attributeValues(ctx, r.name, definitions);
    if (!values) return;

    if (!placing.xref) lastInserted.set(ctx.model, r.name);
    const geom: InsertGeometry = referenceGeometry(
      ctx.model,
      block,
      { position, scale: total, rotation },
      definitions,
      values,
    );
    let refused: ReadonlyMap<string, number> = new Map();
    ctx.edit((b) => {
      refused = placeReference(
        b,
        ctx.model,
        ctx.space,
        currentProps(ctx.model),
        geom,
        explode,
      ).refused;
    });
    for (const line of refusalMessages(refused, 'inserted')) ctx.message(line);
    // Repeat Placement asks for the next insertion point; a point given in the dialog is one.
    if (!placing.repeat || placing.at) return;
  }
}

// ── INSERT's Insert dialog ────────────────────────────────────────────────────────────────────
//
// AutoCAD 2024's INSERT opens the Blocks palette; its CLASSICINSERT opens the Insert dialog
// ("Insert Dialog Box"), whose structure Triya's dialog keeps (UI_SPEC.md §7 lists INSERT among
// the dialogs), with the Blocks palette's Repeat Placement added:
//   Name (the drawing's blocks) · Insertion point (Specify On-screen, X, Y) · Scale (Specify
//   On-screen, X, Y, Z, Uniform Scale) · Rotation (Specify On-screen, Angle) · Block Unit (Unit,
//   Factor) · Explode · Repeat Placement · OK, Cancel.
// What is Specify On-screen is asked with -INSERT's prompts once the dialog closes, the rest taken
// from the dialog. Settled for the common drafter expectation (noted in the PR):
// - the dialog opens on the settings it last closed with, per drawing (AutoCAD keeps them for the
//   session), on the block inserted last, else the first block by name;
// - Explode and a block that scales uniformly scale by the X factor alone, as AutoCAD's dialog
//   greys Y and Z for them;
// - Repeat Placement repeats the insertion point only when it is Specify On-screen;
// - Browse... (a drawing file as the block) is a later part of M5-01; Z of the insertion point
//   and Locate using Geographic Data are left out (2D, no geographic data).

/** The Insert dialog's fields. */
export interface InsertDialogSettings {
  /** The block's name. */
  readonly name: string;
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
  readonly explode: boolean;
  /** The Blocks palette's Repeat Placement. */
  readonly repeat: boolean;
}

/** A block the Name list offers, with what the dialog shows of it. */
export interface InsertBlockEntry {
  readonly name: string;
  /** Its BLOCK_RECORD, for the preview (`StylePreview` kind 'block'). */
  readonly handle: Handle;
  /** Block Unit: an `$INSUNITS` code. */
  readonly units: number;
  /** Block Unit's Factor: its units into the drawing's (INSUNITS). */
  readonly factor: number;
  readonly scaleUniformly: boolean;
  readonly allowExploding: boolean;
}

/** INSERT's Insert dialog. */
export interface InsertDialogRequest {
  readonly type: 'insert';
  readonly settings: InsertDialogSettings;
  /** The drawing's blocks (insertable, by name). */
  readonly blocks: readonly InsertBlockEntry[];
  /** The drawing's `$INSUNITS`, which a drawing file's units convert into (Block Unit). */
  readonly units: number;
  /** The drawing file Browse... picked before the dialog last closed, still the one named. */
  readonly file?: string;
  /** Why the last OK placed nothing ("Block "X" not found."). */
  readonly note?: string;
}

/**
 * The drawing file Browse... picked (M5-01 part 4): its file name and model space
 * (`drawingContent`); without `content`, the one the dialog was opened with (`file`).
 */
export interface InsertDialogFile {
  readonly file: string;
  readonly content?: Clipboard;
  /** The answer to Redefine Block where the drawing has a block of the name: No inserts it. */
  readonly redefine: boolean;
}

/** The Insert dialog's answer: its fields as OK closed it. */
export interface InsertDialogAnswer {
  readonly settings: InsertDialogSettings;
  /** The block is this drawing file's (Browse...). */
  readonly drawing?: InsertDialogFile;
}

/** The settings the Insert dialog closed with last, per drawing. */
const lastInsertSettings = new WeakMap<object, InsertDialogSettings>();

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validInsertSettings(s: unknown): s is InsertDialogSettings {
  const v = s as InsertDialogSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.name === 'string' &&
    finite(v.point?.x) &&
    finite(v.point?.y) &&
    finite(v.scale?.x) &&
    finite(v.scale?.y) &&
    finite(v.scale?.z) &&
    finite(v.rotation)
  );
}

function insertEntry(ctx: CommandContext, r: BlockTableRecord): InsertBlockEntry {
  return {
    name: r.name,
    handle: r.handle,
    units: r.units,
    factor: insUnitsScale(r.units, insUnitsOf(ctx.model)),
    scaleUniformly: !r.scalable,
    allowExploding: r.explodable,
  };
}

async function* insertDialog(ctx: CommandContext): Sub<void> {
  const blocks = insertableBlocks(ctx.model);
  const last = lastInsertSettings.get(ctx.model);
  const named = (n: string | undefined) =>
    n === undefined ? undefined : blocks.find((r) => r.name.toUpperCase() === n.toUpperCase());
  const name =
    named(lastInserted.get(ctx.model))?.name ?? named(last?.name)?.name ?? blocks[0]?.name ?? '';
  let settings: InsertDialogSettings = {
    pointOnScreen: true,
    point: { x: 0, y: 0 },
    scaleOnScreen: false,
    scale: { x: 1, y: 1, z: 1 },
    uniformScale: false,
    rotationOnScreen: false,
    rotation: 0,
    explode: false,
    repeat: false,
    ...last,
    name,
  };
  let note: string | undefined;
  /** The drawing file Browse... picked, kept while the dialog opens again with a note. */
  let picked: { readonly file: string; readonly content: Clipboard } | undefined;
  for (;;) {
    const a = yield ctx.prompt.dialog({
      message: 'Insert',
      dialog: {
        type: 'insert',
        settings,
        blocks: blocks.map((r) => insertEntry(ctx, r)),
        units: insUnitsOf(ctx.model),
        ...(picked && { file: picked.file }),
        ...(note !== undefined && { note }),
      },
    });
    if (a.kind !== 'dialog' || a.action !== 'ok' || !validInsertSettings(a.insert?.settings)) {
      return;
    }
    settings = a.insert.settings;
    const drawing = a.insert.drawing;
    const content =
      drawing?.content ?? (drawing?.file === picked?.file ? picked?.content : undefined);
    picked = drawing && content ? { file: drawing.file, content } : undefined;
    note = picked ? drawingRefusal(ctx, settings.name.trim(), picked.content) : undefined;
    if (!note && picked && (drawing!.redefine || !insertableBlock(ctx, settings.name.trim()))) {
      if (!blockOfDrawing(ctx, settings.name.trim(), picked.content)) return;
    }
    note ??= insertRefusal(ctx, settings.name.trim());
    const r = note ? undefined : blockNamed(ctx.model, settings.name.trim())!;
    const uniform = settings.uniformScale || settings.explode || r?.scalable === false;
    const s = settings.scale;
    if (!note && !settings.scaleOnScreen && (s.x === 0 || (!uniform && (s.y === 0 || s.z === 0))))
      note = 'Value must be nonzero.';
    if (!note && settings.explode && r?.explodable === false)
      note = `Block "${r.name}" cannot be exploded.`;
    if (note || !r) continue;
    lastInsertSettings.set(ctx.model, settings);
    const ucs = currentUcs(ctx);
    yield* insertBlock(ctx, r, {
      explode: settings.explode,
      uniform,
      ...(!settings.pointOnScreen && { at: toWorld(ucs, settings.point) }),
      ...(!settings.scaleOnScreen && { scale: uniform ? { x: s.x, y: s.x, z: s.x } : { ...s } }),
      ...(!settings.rotationOnScreen && { rotation: ucs.angle + settings.rotation }),
      repeat: settings.repeat,
    });
    return;
  }
}

/**
 * The values of a new reference's attributes, one per definition: asked in order with ATTREQ 1
 * ("Enter attribute values", presets taken), those to verify asked again ("Verify attribute
 * values"); the defaults with ATTREQ 0. ATTDIA 1 asks them in the Edit Attributes dialog
 * instead, whose Cancel ends the command (undefined).
 */
async function* attributeValues(
  ctx: CommandContext,
  block: string,
  definitions: readonly Entity[],
): Sub<string[] | undefined> {
  const values: string[] = definitions.map((e) => (e.geom as AttdefGeometry).value);
  const asked = attreq(ctx) ? definitions.map((e) => askedFor(e.geom as AttdefGeometry)) : [];
  if (!asked.some(Boolean)) return values;
  if (attdia(ctx)) {
    const shown = definitions.filter((_, i) => asked[i]);
    const d = yield ctx.prompt.dialog({
      message: 'Edit Attributes',
      dialog: {
        type: 'attedit',
        block,
        attributes: shown.map((e) => definitionEntry(e, (e.geom as AttdefGeometry).value)),
      },
    });
    if (d.kind !== 'dialog') return undefined;
    // The dialog answers the values it changed, by their definitions' handles.
    const typed = new Map((d.attributes ?? []).map((p) => [p.handle, p.value]));
    return definitions.map((e, i) => (asked[i] ? typed.get(e.handle) : undefined) ?? values[i]!);
  }
  ctx.message('Enter attribute values');
  for (const [i, e] of definitions.entries()) {
    if (!asked[i]) continue;
    values[i] = yield* attributeValue(ctx, e.geom as AttdefGeometry, values[i]!);
  }
  const verify = definitions.filter(
    (e, i) => asked[i] && ((e.geom as AttdefGeometry).flags & ATTRIBUTE_VERIFY) !== 0,
  );
  if (verify.length > 0) {
    ctx.message('Verify attribute values');
    for (const [i, e] of definitions.entries()) {
      const g = e.geom as AttdefGeometry;
      if (!asked[i] || (g.flags & ATTRIBUTE_VERIFY) === 0) continue;
      values[i] = yield* attributeValue(ctx, g, values[i]!);
    }
  }
  return values;
}

/** ATTDIA: 1 asks new attribute values in the Edit Attributes dialog, 0 (Triya's default) at
 * the command line, as before the dialog came. */
function attdia(ctx: CommandContext): boolean {
  const v = ctx.model.header.get('$ATTDIA');
  return v === 1 || v === true;
}

/** ATTREQ: 1 (the default) asks the attribute values, 0 takes their defaults. */
function attreq(ctx: CommandContext): boolean {
  const v = ctx.model.header.get('$ATTREQ');
  return !(v === 0 || v === false);
}

/** A definition whose value INSERT asks for: not preset (constants are no attributes at all). */
const askedFor = (g: AttdefGeometry): boolean => (g.flags & ATTRIBUTE_PRESET) === 0;

/** "<prompt> <default>:" (the tag where the definition has no prompt). */
async function* attributeValue(ctx: CommandContext, g: AttdefGeometry, value: string): Sub<string> {
  const a = yield ctx.prompt.string({
    message: g.prompt !== '' ? g.prompt : g.tag,
    spaces: true,
    default: { kind: 'string', value },
  });
  // A string prompt with a default answers a string (Esc ends the command).
  return (a as { readonly value: string }).value;
}

// ── BASE ──────────────────────────────────────────────────────────────────────────────────────

export function baseCommand(): CommandDef {
  return {
    name: 'BASE',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const paper = ctx.space !== modelSpaceOf(ctx.model);
      const key = paper ? '$PINSBASE' : '$INSBASE';
      const was = ctx.model.header.get(key) as { x: number; y: number; z?: number } | undefined;
      const u = drawingUnits(ctx.model.header);
      const shown = [was?.x ?? 0, was?.y ?? 0, was?.z ?? 0].map((v) => formatDistance(v, u));
      const ucs = currentUcs(ctx);
      const a = yield ctx.prompt.point({
        message: 'Enter base point',
        defaultLabel: shown.join(','),
      });
      if (a.kind !== 'point') return;
      // INSBASE is kept in the UCS's coordinates (AutoCAD Help, "INSBASE (System Variable)").
      const p = toUcs(ucs, a.point);
      ctx.edit((b) => b.setHeader(key, { x: p.x, y: p.y, z: was?.z ?? 0 }));
    },
  };
}

/** The block commands, for `builtinCommands`. */
export const BLOCK_COMMANDS: readonly (() => CommandDef)[] = [
  blockCommand,
  insertCommand,
  baseCommand,
];
