// M3-04 part 3: SELECTSIMILAR and selection cycling, as AutoCAD 2024's (AutoCAD Help,
// "SELECTSIMILAR (Command)", "SELECTSIMILARMODE (System Variable)", "Select Similar Settings
// Dialog Box", "SELECTIONCYCLING (System Variable)", "To Select Overlapping or Close Objects"):
//   - objects of the same type are similar when the properties SELECTSIMILARMODE names match
//     (initially 130: Layer, and Name for referenced objects); what is found is added to the
//     samples and left selected at `Command:`;
//   - with SELECTIONCYCLING 2 a pick over overlapping objects shows the Selection list and takes
//     the one chosen; with it off (0 or negative) or 1 (badge only) the nearest is taken.
// The app keeps both variables: the test double answers `sysvar` requests from a map, as the
// app's `systemVariableReply` does, and the `cycle` request as the Selection list would.
import { describe, expect, it } from 'vitest';
import {
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DialogRequest,
  type EntityGeometry,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0 } from '../model/fixtures';
import { host, setup } from './edit-harness';

const line = (x0: number, y0: number, x1: number, y1: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});
const text = (style: string, x: number): EntityGeometry => ({
  kind: 'TEXT',
  value: 'NOTE',
  style,
  position: { x, y: 40 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});
const insert = (x: number): EntityGeometry => ({
  kind: 'INSERT',
  block: '50',
  position: { x, y: 60 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});
const RED = { color: { kind: 'aci' as const, index: 1 } };

/**
 * edit-harness's line 30 and circle 31 on layer 0; on WALLS 40 a red line, 41 a line, 42 a
 * line crossing 41 at (25,5), 43 and 44 texts in styles Standard and NOTES, 45 and 46 inserts
 * of block B; 47 a red dashed line on layer 0, linetype scale 2, lineweight 0.30 mm, plot
 * style NORMAL.
 */
function drawing(vars: Record<string, number> = {}, choose?: (r: ViewRequest) => ViewReply) {
  const t = setup([
    [line(20, 0, 30, 0), RED],
    line(20, 5, 30, 5),
    line(25, 0, 25, 10),
    text('16', 0),
    text('17', 20),
    insert(0),
    insert(20),
    [
      line(0, 80, 10, 80),
      { ...RED, layer: LAYER_0, linetype: '15', ltScale: 2, lineweight: 30, plotStyle: '80' },
    ],
  ]);
  const canvas = host(() => t.model);
  const asked: ViewRequest[] = [];
  const bus = new PromptBus({
    model: t.model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        if (r.op === 'sysvar') {
          if (typeof r.value === 'number') vars[r.name] = r.value;
          const value = vars[r.name];
          return Promise.resolve(
            value === undefined ? { ok: false, message: 'no' } : { ok: true, value },
          );
        }
        if (r.op === 'cycle') {
          return Promise.resolve(choose ? choose(r) : { ok: false, message: 'no list' });
        }
        return canvas.request(r);
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const handles = () => bus.selection.map((id) => String(t.model.ids.handleOf(id))).sort();
  const dialog = () => {
    const p = bus.prompt;
    return p?.kind === 'dialog'
      ? (p.dialog as Extract<DialogRequest, { type: 'selectsimilar' }>)
      : undefined;
  };
  /** Esc, then a crossing window round the point at `Command:`: the object there alone. */
  const only = async (x: number, y: number) => {
    bus.cancel();
    await bus.pick({ x: x + 1, y: y + 1 });
    await bus.pick({ x: x - 1, y: y - 1 });
  };
  return { ...t, bus, log, vars, asked, handles, dialog, only };
}

describe('SELECTSIMILAR', () => {
  it('takes the objects selected at Command: and adds those like them: same type and layer', async () => {
    const t = drawing();
    await t.bus.pick({ x: 22, y: 5 });
    expect(t.handles()).toEqual(['41']);
    await t.bus.submit('SELECTSIMILAR');
    expect(t.bus.command).toBeUndefined();
    // The lines on WALLS, whatever their colour; not the lines on layer 0.
    expect(t.handles()).toEqual(['40', '41', '42']);
  });

  it('asks for the objects when none are selected, Enter taking them', async () => {
    const t = drawing();
    await t.bus.submit('SELECTSIMILAR');
    expect(t.bus.promptText).toBe('Select objects or [SEttings]:');
    await t.bus.pick({ x: 5, y: 0 });
    await t.bus.submit('');
    expect(t.bus.command).toBeUndefined();
    expect(t.handles()).toEqual(['30', '47']);
  });

  it('SEttings opens Select Similar Settings on SELECTSIMILARMODE, and OK sets it', async () => {
    const t = drawing();
    await t.bus.submit('SELECTSIMILAR');
    await t.bus.submit('SE');
    expect(t.bus.promptText).toBe('Select Similar Settings:');
    expect(t.dialog()).toEqual({ type: 'selectsimilar', mode: 130 });
    // Color alone: the red lines, whatever their layer.
    await t.bus.answer({ kind: 'dialog', action: 'ok', selectSimilar: 1 });
    expect(t.vars['SELECTSIMILARMODE']).toBe(1);
    expect(t.bus.promptText).toBe('Select objects or [SEttings]:');
    await t.bus.pick({ x: 22, y: 0 });
    await t.bus.submit('');
    expect(t.handles()).toEqual(['40', '47']);
  });

  it('Esc in the dialog keeps the setting and asks again; Esc at the prompt ends it', async () => {
    const t = drawing({ SELECTSIMILARMODE: 2 });
    await t.bus.submit('SELECTSIMILAR');
    await t.bus.submit('SE');
    expect(t.dialog()?.mode).toBe(2);
    t.bus.cancel();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(t.vars['SELECTSIMILARMODE']).toBe(2);
    expect(t.bus.promptText).toBe('Select objects or [SEttings]:');
    t.bus.cancel();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(t.bus.command).toBeUndefined();
    expect(t.handles()).toEqual([]);
  });

  it('Object style tells texts of one style from another; Name blocks by their block', async () => {
    const t = drawing({ SELECTSIMILARMODE: 2 | 64 });
    await t.only(0, 40);
    expect(t.handles()).toEqual(['43']);
    await t.bus.submit('SELECTSIMILAR');
    expect(t.handles()).toEqual(['43']);
    // Layer alone: both texts are similar.
    t.vars['SELECTSIMILARMODE'] = 2;
    await t.only(0, 40);
    await t.bus.submit('SELECTSIMILAR');
    expect(t.handles()).toEqual(['43', '44']);
    // The inserts of one block are similar by Name.
    t.vars['SELECTSIMILARMODE'] = 128;
    await t.only(0, 60);
    await t.bus.submit('SELECTSIMILAR');
    expect(t.handles()).toEqual(['45', '46']);
  });

  it('Linetype, Linetype scale, Lineweight and Plot style must match where named', async () => {
    const t = drawing({ SELECTSIMILARMODE: 4 | 8 | 16 | 32 });
    await t.only(0, 0);
    await t.bus.submit('SELECTSIMILAR');
    // Line 47 has its own linetype, scale, lineweight and plot style; the others are ByLayer.
    expect(t.handles()).toEqual(['30', '40', '41', '42']);
    for (const mode of [4, 8, 16, 32]) {
      t.vars['SELECTSIMILARMODE'] = mode;
      await t.only(0, 80);
      await t.bus.submit('SELECTSIMILAR');
      expect(t.handles()).toEqual(['47']);
    }
    // Object type alone: every line.
    t.vars['SELECTSIMILARMODE'] = 0;
    await t.only(0, 80);
    await t.bus.submit('SELECTSIMILAR');
    expect(t.handles()).toEqual(['30', '40', '41', '42', '47']);
  });
});

describe('selection cycling (SELECTIONCYCLING)', () => {
  it('2: a pick over overlapping objects shows the Selection list and takes the one chosen', async () => {
    const t = drawing({ SELECTIONCYCLING: 2 }, (r) => {
      if (r.op !== 'cycle') return { ok: false, message: 'no' };
      // The farther of the two, as a drafter picking it from the list.
      return { ok: true, ids: [r.candidates[1]!.id] };
    });
    await t.bus.pick({ x: 25, y: 5.1 });
    const cycle = t.asked.find((r) => r.op === 'cycle');
    expect(cycle).toMatchObject({
      op: 'cycle',
      point: { x: 25, y: 5.1 },
      candidates: [
        { id: t.model.ids.idOf('42'), label: 'Line' },
        { id: t.model.ids.idOf('41'), label: 'Line' },
      ],
    });
    expect(t.handles()).toEqual(['41']);
  });

  it('the list dismissed takes nothing and starts no window', async () => {
    const t = drawing({ SELECTIONCYCLING: 2 }, () => ({ ok: true, ids: [] }));
    await t.bus.submit('ERASE');
    await t.bus.pick({ x: 25, y: 5.1 });
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.submit('');
    expect(t.byHandle('41')).toBeDefined();
    expect(t.byHandle('42')).toBeDefined();
  });

  it('off, negative or badge only: the nearest object, with no list', async () => {
    for (const mode of [0, -2, 1]) {
      const t = drawing({ SELECTIONCYCLING: mode }, () => {
        throw new Error('no list expected');
      });
      await t.bus.pick({ x: 25, y: 5.1 });
      expect(t.handles()).toEqual(['42']);
      expect(t.asked.some((r) => r.op === 'cycle')).toBe(false);
    }
  });

  it('a canvas that cannot show the list takes the nearest; a single object needs none', async () => {
    const t = drawing({ SELECTIONCYCLING: 2 });
    await t.bus.pick({ x: 25, y: 5.1 });
    expect(t.handles()).toEqual(['42']);
    t.asked.length = 0;
    await t.bus.pick({ x: 28, y: 5 });
    expect(t.handles()).toEqual(['41', '42']);
    expect(t.asked.some((r) => r.op === 'sysvar' || r.op === 'cycle')).toBe(false);
  });
});
