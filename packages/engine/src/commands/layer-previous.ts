// LAYERP and LAYERPMODE (M5-06 part 2), as AutoCAD 2024's help describes them ("LAYERP
// (Command)": "Undoes the last change or set of changes made to layer settings"; "LAYERPMODE
// (Command)": "Turns on and off the tracking of changes made to layer settings"):
//
//   - Each step that changed layer settings (a command, or one change in the Layer Properties
//     Manager or the Layer control) is one set; LAYERP puts the newest set back.
//   - "Renamed layers: ... Layer Previous restores the original properties but not the original
//     name." Deleted or purged layers are not restored, and new layers are not removed: a set
//     names layers by handle and restores only those still in the drawing.
//   - The current layer is a layer setting here: LAYMCUR or Set Current is put back.
//
// Ambiguities, settled for the common drafter expectation: AutoCAD's help quotes no message, so
// "Restored previous layer state." and the others are Triya's; turning LAYERPMODE off forgets
// what was tracked, since a set restored across changes made while it was off would undo some
// and not others. The history lives with the drawing while it is open, as AutoCAD's does.
import type { CommandDef } from './command';
import type { ChangeSet } from '../model/changeset';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { LayerRecord } from '../model/types';

/** The layer settings LAYERP puts back (not the name, nor the viewport overrides it cannot write). */
const SETTINGS = [
  'on',
  'frozen',
  'locked',
  'color',
  'linetype',
  'lineweight',
  'transparency',
  'plot',
  'plotStyle',
  'material',
  'description',
] as const;
type Setting = (typeof SETTINGS)[number];
type Settings = { -readonly [K in Setting]?: LayerRecord[K] };

/** One set: each layer's settings before it, and the current layer before it. */
interface LayerSet {
  readonly layers: Map<Handle, Settings>;
  current?: Handle;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const upper = (s: string) => s.toUpperCase();

/** The changes LAYERP can put back, newest last (AutoCAD keeps them while the drawing is open). */
export class LayerPrevious {
  #on = true;
  readonly #sets: LayerSet[] = [];

  /** LAYERPMODE: off forgets what was tracked and tracks nothing until it is on again. */
  get on(): boolean {
    return this.#on;
  }

  set on(on: boolean) {
    this.#on = on;
    if (!on) this.#sets.length = 0;
  }

  /**
   * A step's change sets, already applied to `model`: the layer settings and current layer they
   * changed become a set. A step that changed none adds none.
   */
  record(model: DocumentModel, changes: readonly ChangeSet[]): void {
    if (!this.#on) return;
    const set: LayerSet = { layers: new Map() };
    for (const cs of changes) {
      for (const { before, after } of cs.tables?.layers?.updated ?? []) {
        for (const k of SETTINGS) {
          if (same(before[k], after[k])) continue;
          const kept = set.layers.get(before.handle) ?? {};
          if (!(k in kept)) (kept as Record<string, unknown>)[k] = before[k];
          set.layers.set(before.handle, kept);
        }
      }
      const clayer = cs.header?.find((h) => h.name === '$CLAYER');
      if (clayer && set.current === undefined) {
        const was = layerHandle(model, cs, clayer.before, 'before');
        const now = layerHandle(model, cs, clayer.after, 'after');
        // A rename of the current layer changes $CLAYER's name, not the layer.
        if (was !== undefined && was !== now) set.current = was;
      }
    }
    if (set.layers.size > 0 || set.current !== undefined) this.#sets.push(set);
  }

  /** The newest set, taken off; undefined when there is none. */
  take(): LayerSet | undefined {
    return this.#sets.pop();
  }
}

/** The layer `name` named on that side of `cs`: a renamed layer's record first, then the drawing's. */
function layerHandle(
  model: DocumentModel,
  cs: ChangeSet,
  name: unknown,
  side: 'before' | 'after',
): Handle | undefined {
  const key = upper(String(name));
  const renamed = cs.tables?.layers?.updated?.find((r) => upper(r[side].name) === key);
  return (renamed?.[side] ?? [...model.tables.layers.values()].find((l) => upper(l.name) === key))
    ?.handle;
}

const histories = new WeakMap<DocumentModel, LayerPrevious>();

/** The drawing's layer history: the bus records each step into it, LAYERP takes from it. */
export function layerPreviousOf(model: DocumentModel): LayerPrevious {
  let h = histories.get(model);
  if (!h) {
    h = new LayerPrevious();
    histories.set(model, h);
  }
  return h;
}

/** The command whose own change LAYERP's set must not become (it would put itself back). */
export const LAYERP = 'LAYERP';

/** LAYERP: the newest set of layer changes put back. */
export function layerpCommand(): CommandDef {
  return {
    name: LAYERP,
    usesSelection: 'none',
    // eslint-disable-next-line require-yield -- no prompt: it acts at once, as AutoCAD's does
    async *run(ctx) {
      const history = layerPreviousOf(ctx.model);
      if (!history.on) {
        ctx.message('LAYERP is off. Turn it on with LAYERPMODE.');
        return;
      }
      const set = history.take();
      if (!set) {
        ctx.message('No previous layer state to restore.');
        return;
      }
      const layers = ctx.model.tables.layers;
      const current = set.current !== undefined ? layers.get(set.current) : undefined;
      // The current layer after: the one the set names, unless it is gone or would be frozen.
      const header = ctx.model.header.get('$CLAYER');
      const currentAfter =
        current && !(set.layers.get(current.handle)?.frozen ?? current.frozen)
          ? current
          : [...layers.values()].find(
              (l) => typeof header === 'string' && l.name.toUpperCase() === header.toUpperCase(),
            );
      ctx.edit((b) => {
        for (const [h, settings] of set.layers) {
          const l = layers.get(h);
          if (!l) continue;
          const patch: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(settings)) {
            if (!same(l[k as Setting], v)) patch[k] = v;
          }
          // AutoCAD never freezes the current layer.
          if (h === currentAfter?.handle && patch.frozen === true) delete patch.frozen;
          if (Object.keys(patch).length > 0) b.updateTableRecord('layers', h, patch);
        }
        if (currentAfter && currentAfter === current && header !== current.name)
          b.setHeader('$CLAYER', current.name);
      });
      ctx.message('Restored previous layer state.');
    },
  };
}

/** LAYERPMODE: "Enter LAYERP mode [ON/OFF] <ON>". */
export function layerpmodeCommand(): CommandDef {
  return {
    name: 'LAYERPMODE',
    usesSelection: 'none',
    async *run(ctx) {
      const history = layerPreviousOf(ctx.model);
      const a = yield ctx.prompt.keyword({
        message: 'Enter LAYERP mode',
        options: ['ON', 'OFF'],
        default: { kind: 'keyword', keyword: history.on ? 'ON' : 'OFF' },
      });
      // A keyword prompt with a default answers a keyword (Esc ends the command).
      history.on = (a as { readonly keyword: string }).keyword === 'ON';
      ctx.message(`*LAYERP mode is ${history.on ? 'ON' : 'OFF'}*`);
    },
  };
}
