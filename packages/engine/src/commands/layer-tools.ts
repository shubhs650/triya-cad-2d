// The layer tool row (M5-06 part 1), with AutoCAD 2024's prompts and messages (AutoCAD Help,
// "LAYOFF (Command)", "LAYON", "LAYFRZ", "LAYTHW", "LAYLCK", "LAYULK", "LAYMCUR", "LAYCUR",
// "LAYMCH", "LAYISO", "LAYUNISO", "LAYLOCKFADECTL (System Variable)"):
//
//   - LAYOFF and LAYFRZ turn off or freeze the layer of each object picked until Enter; Undo
//     takes the last one back. The current layer is turned off only after a Yes, and never
//     frozen. LAYON and LAYTHW turn on or thaw every layer.
//   - LAYLCK and LAYULK lock or unlock the layer of one object picked; LAYMCUR makes it current.
//   - LAYCUR moves the objects selected to the current layer, LAYMCH to the layer of an object
//     picked, or of a layer named.
//   - LAYISO keeps the layers of the objects selected (isolated) and locks the others, fading
//     them by LAYLOCKFADECTL, or turns them off (Settings); LAYUNISO undoes the last LAYISO,
//     keeping what was changed since ("Any additional changes made to layer settings after you
//     use the LAYISO command will be retained").
//
// Each command is one undo step; picks take objects on locked layers too, since the layer, not
// the object, is edited. A pick on a block reference or an xref takes the layer of the object
// picked inside it (part 5, `nested-pick.ts`): LAYOFF and LAYFRZ as their Block selection setting
// says, the other picks always (Entity).
//
// Viewports: AutoCAD freezes (Vpfreeze) a layer in the layout viewport made current only;
// Triya cannot make one current yet (MSPACE, M6-02), and outside one AutoCAD changes the layer
// itself, so the setting is kept and shown but every change is the layer's own.
//
// Ambiguities, settled for the common drafter expectation: LAYISO makes the first isolated
// layer current when the current layer is not isolated (new objects would otherwise go on a
// layer turned off or locked), and LAYUNISO leaves the current layer as it is. LAYISO's
// restore point lives with the drawing while it is open; AutoCAD's help does not say whether a
// reopened drawing keeps it.
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import type { Handle } from '../model/handle';
import type { LayerRecord } from '../model/types';
import type { EntityId } from '../model/entity-ids';
import { currentLayer } from '../properties/current';
import { newLayer } from '../edit/layer-manager';
import { BLOCK_SELECTIONS, pickedLayer, selectedLayers, type BlockSelection } from './nested-pick';

/** DXF 70 bit 16: a layer that came in with an xref (its objects stay on it). */
const XREF_DEPENDENT = 16;

/** LAYLOCKFADECTL: how faded objects on locked layers are drawn (AutoCAD's initial 50). */
export const LAYLOCKFADECTL = 'LAYLOCKFADECTL';
const FADE_INITIAL = 50;
/** LAYISO's fade value: "Enter fade value (0-90)". */
const FADE_MAX = 90;

type LayerFlags = Partial<Pick<LayerRecord, 'on' | 'frozen' | 'locked'>>;

/** What the layer tool row keeps while the drawing is open (AutoCAD keeps it per session). */
interface LayerToolState {
  offViewports: 'Vpfreeze' | 'Off';
  freezeViewports: 'Freeze' | 'Vpfreeze';
  /** LAYOFF's and LAYFRZ's Block selection nesting level (part 5). */
  offBlocks: BlockSelection;
  freezeBlocks: BlockSelection;
  isoMode: 'Off' | 'Lock and fade';
  isoViewports: 'Vpfreeze' | 'Off';
  /** What the last LAYISO changed: each layer's flags before it and as LAYISO left them. */
  isolated: readonly { handle: Handle; before: LayerFlags; after: LayerFlags }[] | undefined;
}

/** A prompt of a command's own, answering with a value (undefined at Enter or Esc). */
type Asking<T> = AsyncGenerator<Prompt, T | undefined, PromptAnswer>;

const quoted = (name: string) => `"${name}"`;
const objects = (n: number) => `${n} object${n === 1 ? '' : 's'}`;

function layerOfObject(ctx: CommandContext, id: EntityId | undefined): LayerRecord | undefined {
  const e = id === undefined ? undefined : ctx.model.entity(id);
  return e && ctx.model.tables.layers.get(e.layer);
}

function isCurrent(ctx: CommandContext, layer: LayerRecord): boolean {
  return currentLayer(ctx.model) === layer.handle;
}

/** Sets flags on layers in one edit; layers already so are left out (no edit when none). */
function setFlags(ctx: CommandContext, patches: ReadonlyMap<Handle, LayerFlags>): void {
  const changes = [...patches].flatMap(([h, patch]) => {
    const l = ctx.model.tables.layers.get(h);
    if (!l) return [];
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => l[k as keyof LayerFlags] !== v),
    ) as LayerFlags;
    return Object.keys(changed).length > 0 ? [[h, changed] as const] : [];
  });
  if (changes.length === 0) return;
  ctx.edit((b) => {
    for (const [h, patch] of changes) b.updateTableRecord('layers', h, patch);
  });
}

const isXrefLayer = (l: LayerRecord) => ((l.flags ?? 0) & XREF_DEPENDENT) !== 0;

/**
 * One layer pick ("Select an object on the layer to be …"), into blocks and xrefs (Entity);
 * undefined at Enter or Esc.
 */
async function* pickLayer(ctx: CommandContext, message: string): Asking<LayerRecord> {
  const a = yield ctx.prompt.selection({ message, single: true });
  return a.kind === 'selection' ? await pickedLayer(ctx, a, 'Entity') : undefined;
}

/**
 * LAYOFF or LAYFRZ: the layer of each object picked until Enter, with Settings (the viewport
 * choice) and Undo (the last layer back as it was).
 */
function layerPicksCommand(name: 'LAYOFF' | 'LAYFRZ', state: LayerToolState): CommandDef {
  const off = name === 'LAYOFF';
  return {
    name,
    usesSelection: 'during',
    async *run(ctx) {
      const blocks = () => (off ? state.offBlocks : state.freezeBlocks);
      ctx.message(
        `Current settings: Viewports=${off ? state.offViewports : state.freezeViewports}, ` +
          `Block nesting level=${blocks()}`,
      );
      const done: { handle: Handle; before: LayerFlags }[] = [];
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: off
            ? 'Select an object on the layer to be turned off or'
            : 'Select an object on a layer to be frozen or',
          options: ['Settings', 'Undo'],
          single: true,
        });
        if (a.kind === 'keyword' && a.keyword === 'Settings') {
          const t = yield ctx.prompt.keyword({
            message: 'Enter setting type for',
            options: ['Viewports', 'Block selection'],
          });
          if (t.kind !== 'keyword') return;
          if (t.keyword === 'Block selection') {
            const n = yield ctx.prompt.keyword({
              message: 'Enter Block Selection nesting level',
              options: [...BLOCK_SELECTIONS],
              default: { kind: 'keyword', keyword: blocks() },
            });
            if (n.kind !== 'keyword') return;
            if (off) state.offBlocks = n.keyword as BlockSelection;
            else state.freezeBlocks = n.keyword as BlockSelection;
            continue;
          }
          const choices = off ? ['Vpfreeze', 'Off'] : ['Freeze', 'Vpfreeze'];
          const s = yield ctx.prompt.keyword({
            message: 'In paper space viewport use',
            options: choices,
            default: { kind: 'keyword', keyword: 'Vpfreeze' },
          });
          if (s.kind !== 'keyword') return;
          if (off) state.offViewports = s.keyword as LayerToolState['offViewports'];
          else state.freezeViewports = s.keyword as LayerToolState['freezeViewports'];
          continue;
        }
        if (a.kind === 'keyword') {
          const last = done.pop();
          if (last) setFlags(ctx, new Map([[last.handle, last.before]]));
          else ctx.message('Nothing to undo.');
          continue;
        }
        if (a.kind !== 'selection') return;
        const layer = await pickedLayer(ctx, a, blocks());
        if (!layer) return;
        if (!off && isCurrent(ctx, layer)) {
          ctx.message(`Cannot freeze layer ${quoted(layer.name)}.  It is the CURRENT layer.`);
          continue;
        }
        if (off && isCurrent(ctx, layer)) {
          const y = yield ctx.prompt.keyword({
            message: `Layer ${quoted(layer.name)} is the current layer, do you want to turn it off?`,
            options: ['Yes', 'No'],
            default: { kind: 'keyword', keyword: 'No' },
          });
          if (y.kind !== 'keyword') return;
          if (y.keyword !== 'Yes') continue;
        }
        done.push({
          handle: layer.handle,
          before: off ? { on: layer.on } : { frozen: layer.frozen },
        });
        setFlags(ctx, new Map([[layer.handle, off ? { on: false } : { frozen: true }]]));
        ctx.message(`Layer ${quoted(layer.name)} has been ${off ? 'turned off' : 'frozen'}.`);
      }
    },
  };
}

/** LAYON or LAYTHW: every layer turned on or thawed. */
function allLayersCommand(name: 'LAYON' | 'LAYTHW'): CommandDef {
  const on = name === 'LAYON';
  return {
    name,
    usesSelection: 'none',
    // eslint-disable-next-line require-yield -- no prompt: it acts at once, as AutoCAD's does
    async *run(ctx) {
      const flags: LayerFlags = on ? { on: true } : { frozen: false };
      setFlags(ctx, new Map([...ctx.model.tables.layers.keys()].map((h) => [h, flags])));
      ctx.message(on ? 'All layers have been turned on.' : 'All layers have been thawed.');
    },
  };
}

/** LAYLCK or LAYULK: the layer of one object picked locked or unlocked. */
function lockCommand(name: 'LAYLCK' | 'LAYULK'): CommandDef {
  const lock = name === 'LAYLCK';
  const verb = lock ? 'locked' : 'unlocked';
  return {
    name,
    usesSelection: 'during',
    async *run(ctx) {
      const layer = yield* pickLayer(ctx, `Select an object on the layer to be ${verb}`);
      if (!layer) return;
      if (layer.locked === lock) {
        ctx.message(`Layer ${quoted(layer.name)} is ${lock ? 'already locked' : 'not locked'}.`);
        return;
      }
      setFlags(ctx, new Map([[layer.handle, { locked: lock }]]));
      ctx.message(`Layer ${quoted(layer.name)} has been ${verb}.`);
    },
  };
}

function makeCurrent(ctx: CommandContext, layer: LayerRecord): void {
  if (isCurrent(ctx, layer)) return;
  ctx.edit((b) => b.setHeader('$CLAYER', layer.name));
}

/** LAYMCUR: the layer of the object picked made current. */
function laymcurCommand(): CommandDef {
  return {
    name: 'LAYMCUR',
    usesSelection: 'during',
    async *run(ctx) {
      const layer = yield* pickLayer(ctx, 'Select object whose layer will become current');
      if (!layer) return;
      // An xref's layer cannot be current, as the Layer Properties Manager refuses it too.
      if (isXrefLayer(layer)) {
        ctx.message(`Layer ${quoted(layer.name)} is xref-dependent and cannot be made current.`);
        return;
      }
      makeCurrent(ctx, layer);
      ctx.message(`${layer.name} is now the current layer.`);
    },
  };
}

/** Moves `ids` to `layer` in one edit; how many it moved. */
function moveToLayer(ctx: CommandContext, ids: readonly EntityId[], layer: Handle): number {
  const moving = ids.filter((id) => {
    const e = ctx.model.entity(id);
    return e !== undefined && e.layer !== layer;
  });
  if (moving.length > 0) {
    ctx.edit((b) => {
      for (const id of moving) b.updateEntity(id, { layer });
    });
  }
  return moving.length;
}

/** LAYCUR: the objects selected moved to the current layer. */
function laycurCommand(): CommandDef {
  return {
    name: 'LAYCUR',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select objects to be changed to the current layer',
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const current = ctx.model.tables.layers.get(currentLayer(ctx.model))!;
      const n = moveToLayer(ctx, a.ids, current.handle);
      ctx.message(`${objects(n)} changed to layer ${quoted(current.name)} (the current layer).`);
    },
  };
}

/**
 * Change to Layer's new layer: `name` made (with layer 0's properties, as the Layer Properties
 * Manager's New Layer makes one when no layer is selected) and the objects moved to it, one edit;
 * undefined, said why, when the name cannot be a layer's.
 */
function changeToNewLayer(
  ctx: CommandContext,
  ids: readonly EntityId[],
  name: string,
): number | undefined {
  const existing = [...ctx.model.tables.layers.values()].find(
    (l) => l.name.toUpperCase() === name.toUpperCase(),
  );
  if (existing) {
    const n = moveToLayer(ctx, ids, existing.handle);
    ctx.message(`${objects(n)} changed to layer ${quoted(existing.name)}.`);
    return n;
  }
  let problem: string | undefined;
  let n = 0;
  ctx.edit((b) => {
    const made = newLayer(b, ctx.model, undefined, name);
    if (typeof made === 'string') {
      problem = made;
      return;
    }
    for (const id of ids) {
      if (ctx.model.entity(id) === undefined) continue;
      b.updateEntity(id, { layer: made.handle });
      n++;
    }
  });
  if (problem) {
    ctx.message(problem);
    return undefined;
  }
  ctx.message(`Layer ${quoted(name)} created.`);
  ctx.message(`${objects(n)} changed to layer ${quoted(name)}.`);
  return n;
}

/** LAYMCH: the objects selected moved to the layer of an object picked, or of a layer named. */
function laymchCommand(): CommandDef {
  return {
    name: 'LAYMCH',
    dashVariant: true,
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({
        message: 'Select objects to be changed',
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      let target: LayerRecord | undefined;
      while (!target) {
        const b = yield ctx.prompt.selection({
          message: 'Select object on destination layer or',
          options: ['Name'],
          single: true,
        });
        if (b.kind === 'selection') {
          target = layerOfObject(ctx, b.ids[0]);
          if (!target) return;
        } else if (b.kind === 'keyword' && !ctx.dash) {
          // Name opens the Change to Layer dialog (M5-06 part 3); a name typed in its Current
          // Layer box that the drawing lacks makes that layer, in the same undo step.
          const d = yield ctx.prompt.dialog({
            message: 'Change to Layer',
            escape: true,
            dialog: {
              type: 'layerlist',
              title: 'Change to Layer',
              multiple: false,
              current: ctx.model.tables.layers.get(currentLayer(ctx.model))?.name ?? '0',
              layers: [...ctx.model.tables.layers.values()]
                .filter((l) => ((l.flags ?? 0) & XREF_DEPENDENT) === 0)
                .sort((x, y) =>
                  x.name.localeCompare(y.name, undefined, { numeric: true, sensitivity: 'base' }),
                )
                .map((l) => ({ handle: l.handle, name: l.name })),
            },
          });
          if (d.kind !== 'dialog' || d.action !== 'ok') continue;
          const name = d.layerName?.trim();
          if (name) {
            const made = changeToNewLayer(ctx, a.ids, name);
            if (made !== undefined) return;
            continue;
          }
          target =
            d.layers?.[0] === undefined ? undefined : ctx.model.tables.layers.get(d.layers[0]);
        } else if (b.kind === 'keyword') {
          // -LAYMCH asks for the name at the command line.
          const n = yield ctx.prompt.string({ message: 'Enter layer name' });
          if (n.kind !== 'string') return;
          const wanted = n.value.trim().toUpperCase();
          target = [...ctx.model.tables.layers.values()].find(
            (l) => l.name.toUpperCase() === wanted,
          );
          if (!target) ctx.message(`Layer ${quoted(n.value.trim())} not found.`);
        } else return;
      }
      const n = moveToLayer(ctx, a.ids, target.handle);
      ctx.message(`${objects(n)} changed to layer ${quoted(target.name)}.`);
    },
  };
}

/** LAYLOCKFADECTL as the app keeps it, AutoCAD's initial value when it keeps none. */
async function fadeValue(ctx: CommandContext): Promise<number> {
  const r = await ctx.view.request({ op: 'sysvar', name: LAYLOCKFADECTL });
  return r.ok && typeof r.value === 'number' ? r.value : FADE_INITIAL;
}

/** LAYISO: every layer but those of the objects selected locked and faded, or turned off. */
function layisoCommand(state: LayerToolState): CommandDef {
  return {
    name: 'LAYISO',
    usesSelection: 'during',
    async *run(ctx) {
      ctx.message(
        state.isoMode === 'Off'
          ? `Current setting: Hide layers, Viewports=${state.isoViewports}`
          : `Current setting: Lock layers, Fade=${await fadeValue(ctx)}`,
      );
      let isolated: LayerRecord[];
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select objects on the layer(s) to be isolated or',
          options: ['Settings'],
        });
        if (a.kind === 'selection') {
          isolated = await selectedLayers(ctx, a, 'Entity');
          break;
        }
        if (a.kind !== 'keyword') return;
        const s = yield ctx.prompt.keyword({
          message: 'Enter setting for layers not isolated',
          options: ['Off', 'Lock and fade'],
          default: { kind: 'keyword', keyword: 'Lock and fade' },
        });
        if (s.kind !== 'keyword') return;
        if (s.keyword === 'Off') {
          const v = yield ctx.prompt.keyword({
            message: 'In paper space viewport use',
            options: ['Vpfreeze', 'Off'],
            default: { kind: 'keyword', keyword: 'Vpfreeze' },
          });
          if (v.kind !== 'keyword') return;
          state.isoMode = 'Off';
          state.isoViewports = v.keyword as LayerToolState['isoViewports'];
          continue;
        }
        const fade = yield* askFade(ctx, await fadeValue(ctx));
        if (fade === undefined) return;
        await ctx.view.request({ op: 'sysvar', name: LAYLOCKFADECTL, value: fade });
        state.isoMode = 'Lock and fade';
      }
      if (isolated.length === 0) return;
      const lock = state.isoMode === 'Lock and fade';
      const keep = new Set(isolated.map((l) => l.handle));
      const patches = new Map<Handle, LayerFlags>();
      for (const l of ctx.model.tables.layers.values()) {
        if (keep.has(l.handle)) {
          if (lock && l.locked) patches.set(l.handle, { locked: false });
        } else if (lock ? !l.locked : l.on) {
          patches.set(l.handle, lock ? { locked: true } : { on: false });
        }
      }
      state.isolated = [...patches].map(([handle, after]) => {
        const l = ctx.model.tables.layers.get(handle)!;
        const before = Object.fromEntries(
          Object.keys(after).map((k) => [k, l[k as keyof LayerFlags]]),
        ) as LayerFlags;
        return { handle, before, after };
      });
      setFlags(ctx, patches);
      // An xref's layer cannot be current: the first isolated layer of the drawing's own is made
      // current, or the current layer stays when every isolated one is an xref's.
      const next = isolated.find((l) => !isXrefLayer(l) && !l.frozen);
      if (!keep.has(currentLayer(ctx.model)) && next) makeCurrent(ctx, next);
      ctx.message(
        isolated.length === 1
          ? `Layer ${quoted(isolated[0]!.name)} has been isolated.`
          : `${isolated.length} layers have been isolated.`,
      );
    },
  };
}

/** "Enter fade value (0-90)", asked again until it is in range; undefined at Esc. */
async function* askFade(ctx: CommandContext, initial: number): Asking<number> {
  for (;;) {
    const f = yield ctx.prompt.integer({
      message: 'Enter fade value (0-90)',
      default: { kind: 'number', value: Math.max(0, Math.min(FADE_MAX, initial)) },
    });
    if (f.kind !== 'number') return undefined;
    if (f.value >= 0 && f.value <= FADE_MAX) return f.value;
    ctx.message(`Value must be between 0 and ${FADE_MAX}.`);
  }
}

/** LAYUNISO: the layers the last LAYISO changed put back, unless changed since. */
function layunisoCommand(state: LayerToolState): CommandDef {
  return {
    name: 'LAYUNISO',
    usesSelection: 'none',
    // eslint-disable-next-line require-yield -- no prompt: it acts at once, as AutoCAD's does
    async *run(ctx) {
      const isolated = state.isolated;
      if (!isolated) {
        ctx.message('No layers have been isolated with LAYISO.');
        return;
      }
      state.isolated = undefined;
      const patches = new Map<Handle, LayerFlags>();
      for (const { handle, before, after } of isolated) {
        const l = ctx.model.tables.layers.get(handle);
        if (!l) continue;
        const back = Object.fromEntries(
          Object.entries(before).filter(
            ([k]) => l[k as keyof LayerFlags] === after[k as keyof LayerFlags],
          ),
        ) as LayerFlags;
        if (Object.keys(back).length > 0) patches.set(handle, back);
      }
      setFlags(ctx, patches);
      ctx.message('Layers isolated by LAYISO command have been restored.');
    },
  };
}

/** The layer tool row's commands, sharing the settings and LAYISO's restore point. */
export function layerToolCommands(): CommandDef[] {
  const state: LayerToolState = {
    offViewports: 'Vpfreeze',
    freezeViewports: 'Vpfreeze',
    offBlocks: 'Block',
    freezeBlocks: 'Block',
    isoMode: 'Lock and fade',
    isoViewports: 'Vpfreeze',
    isolated: undefined,
  };
  return [
    layerPicksCommand('LAYOFF', state),
    allLayersCommand('LAYON'),
    layerPicksCommand('LAYFRZ', state),
    allLayersCommand('LAYTHW'),
    lockCommand('LAYLCK'),
    lockCommand('LAYULK'),
    laymcurCommand(),
    laycurCommand(),
    laymchCommand(),
    layisoCommand(state),
    layunisoCommand(state),
  ];
}
