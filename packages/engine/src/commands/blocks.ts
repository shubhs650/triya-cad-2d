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
// BLOCK and INSERT run the same prompts until their dialogs come (M5-01 part 2). What the blocks
// and references are made of is `edit/blocks.ts`'s.
//
// Ambiguities, settled for the common drafter expectation and noted in the PR:
// - Help does not word the refusals; they read "Invalid block name." (asked again), "Block "B"
//   references itself.", "Block "B" not found." and "Block "B" is an external reference.";
// - -BLOCK's Annotative option is left out: Triya makes no annotative objects (DEC-058);
// - -INSERT's X, Y, Z presets set that axis alone (the others stay 1) and, like Scale, skip
//   the scale prompts that follow the insertion point; Basepoint's point is picked on the block
//   as its definition places it (base point at its own base point, unscaled, unturned);
// - ATTDIA 1 asks the values at the command line too until the INSERT dialog brings AutoCAD's
//   Edit Attributes dialog with it (M5-01 part 2).
import type { Vec2 } from '../geom/types';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { EntityId } from '../model/entity-ids';
import type { AttdefGeometry, EntityGeometry, InsertGeometry } from '../model/types';
import {
  ATTRIBUTE_PRESET,
  ATTRIBUTE_VERIFY,
  attributeDefinitions,
  blockNameProblem,
  blockNamed,
  defineBlock,
  insertableBlocks,
  placeReference,
  referenceGeometry,
  selfReferences,
  type BlockPlacement,
} from '../edit/blocks';
import { refusalMessages } from '../edit/edit';
import { followedBy, moveBy, scaleAbout, turnAbout } from '../edit/similarity';
import { transformGeometry } from '../edit/transform';
import { isXrefRecord } from '../model/xref';
import { insUnitsOf, insUnitsScale } from '../model/units';
import { currentProps } from '../properties/current';
import { toUcs, turnToUcs } from '../input/ucs';
import { INSUNITS_NAMES } from './drawing-units';
import { wcmatch } from './modify/attributes';
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
      const typed = yield* insertName(ctx);
      if (typed === undefined) return;
      const explode = typed.startsWith('*');
      const name = explode ? typed.slice(1).trim() : typed;
      const r = blockNamed(ctx.model, name);
      if (!r || !ctx.model.hasBlock(r.handle) || name.startsWith('*')) {
        ctx.message(`Block "${name}" not found.`);
        return;
      }
      if (isXrefRecord(r)) {
        ctx.message(`Block "${r.name}" is an external reference.`);
        return;
      }
      const block = r.handle;
      const def = ctx.model.blocks.get(block)!;
      const k = insUnitsScale(r.units, insUnitsOf(ctx.model));
      ctx.message(`Units: ${INSUNITS_NAMES[r.units]}   Conversion:  ${formatNumber(k, 4)}`);
      const uniform = explode || r.scalable === false;

      // The insertion point, after any presets.
      const presets: Presets = {};
      const options = explode
        ? ['Basepoint', 'Scale', 'Rotate']
        : ['Basepoint', 'Scale', 'X', 'Y', 'Z', 'Rotate'];
      let at: Vec2 | undefined;
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
      const values: string[] = definitions.map((e) => (e.geom as AttdefGeometry).value);
      const asked = attreq(ctx) ? definitions.map((e) => askedFor(e.geom as AttdefGeometry)) : [];
      if (asked.some(Boolean)) {
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
      }

      lastInserted.set(ctx.model, r.name);
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
    },
  };
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
