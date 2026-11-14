// M2-23: undo in the app. Every drawing's command engine runs UNDO, U, REDO and OOPS (M2-05),
// and the session's own edits, a layer's state (M1-23) and a layout's name, tab or page setup
// (M1-97), are undo steps as AutoCAD keeps them. Undo and redo reach the replicas as `change`
// outputs, and every `undo` output says what was undone or redone, for the toast.
import { describe, expect, it } from 'vitest';
import { DocumentModel, EngineSession, type CommandOutput } from '../../src/index';
import { LAYER_0, sampleInit, snapshot } from '../model/fixtures';

function setup() {
  const s = new EngineSession(sampleInit());
  const out: CommandOutput[] = [];
  s.onCommand((o) => out.push(o));
  const run = async (...lines: string[]) => {
    for (const text of lines) await s.command({ kind: 'submit', text });
  };
  const undos = () => out.filter((o) => o.type === 'undo');
  return { s, out, run, undos };
}

const lines = (s: EngineSession) =>
  [...s.model.entities()].filter((e) => e.geom.kind === 'LINE').length;

describe('undo in the engine session', () => {
  it('runs U and REDO on a drawing: draw two lines, U removes the second, REDO restores it', async () => {
    const t = setup();
    const n = lines(t.s);
    await t.run('L', '0,0', '10,0', '', 'L', '0,5', '10,5', '');
    expect(lines(t.s)).toBe(n + 2);
    await t.run('U');
    expect(lines(t.s)).toBe(n + 1);
    expect(t.out.filter((o) => o.type === 'log').at(-1)).toMatchObject({ line: 'LINE' });
    await t.run('REDO');
    expect(lines(t.s)).toBe(n + 2);
  });

  it('says what each U and REDO did, for the undo toast', async () => {
    const t = setup();
    await t.run('L', '0,0', '10,0', '', 'L', '0,5', '10,5', '', 'UNDO', '2');
    expect(t.undos().at(-1)).toMatchObject({
      state: { undoable: 0, redoable: 1, nextRedo: 'LINE' },
      action: { kind: 'undo', labels: ['LINE', 'LINE'] },
    });
    await t.run('REDO');
    expect(t.undos().at(-1)).toMatchObject({
      state: { undoable: 2, redoable: 0, nextUndo: 'LINE' },
      action: { kind: 'redo', labels: ['LINE', 'LINE'] },
    });
    // A new step says nothing was undone.
    await t.run('L', '0,9', '10,9', '');
    expect(t.undos().at(-1)).not.toHaveProperty('action');
  });

  it('runs OOPS', async () => {
    const t = setup();
    await t.run('L', '0,0', '10,0', '');
    const n = lines(t.s);
    await t.run('ERASE', 'L', '', 'L', '0,5', '10,5', '');
    expect(lines(t.s)).toBe(n);
    await t.run('OOPS');
    expect(lines(t.s)).toBe(n + 1);
    expect(t.out.filter((o) => o.type === 'commit').at(-1)).toEqual({
      type: 'commit',
      command: 'OOPS',
    });
  });

  it('makes a layer freeze one undo step, which U undoes', async () => {
    const t = setup();
    const r = t.s.edit({ kind: 'layer', layer: LAYER_0, frozen: true });
    expect(r.ok).toBe(true);
    expect(t.undos().at(-1)).toMatchObject({ state: { undoable: 1, nextUndo: 'LAYER' } });
    await t.run('U');
    expect(t.s.model.tables.layers.get(LAYER_0)?.frozen).toBe(false);
    // The undo reaches the replicas as a change output.
    const change = t.out.filter((o) => o.type === 'change').at(-1);
    expect(
      change?.type === 'change' && change.change.tables?.layers?.updated?.[0]?.after.frozen,
    ).toBe(false);
    await t.run('REDO');
    expect(t.s.model.tables.layers.get(LAYER_0)?.frozen).toBe(true);
  });

  it('keeps a replica in step through a layer edit, its undo and its redo', async () => {
    const t = setup();
    const replica = DocumentModel.create(sampleInit());
    const r = t.s.edit({ kind: 'layer', layer: LAYER_0, on: false, locked: true });
    if (!r.ok) throw new Error(r.message);
    const take = (cs: typeof r.change) => {
      const copy = JSON.parse(JSON.stringify(cs)) as typeof cs;
      // A replica swaps in its own records, as the render session does.
      const updated = copy.tables!.layers!.updated!.map((u) => ({
        before: replica.tables.layers.get(u.after.handle)!,
        after: u.after,
      }));
      replica.apply({ tables: { layers: { updated } } });
    };
    take(r.change);
    const from = t.out.length;
    await t.run('U', 'REDO', 'U');
    for (const o of t.out.slice(from)) if (o.type === 'change') take(o.change);
    expect(snapshot(replica)).toEqual(snapshot(t.s.model));
    expect(t.s.model.tables.layers.get(LAYER_0)?.on).toBe(true);
  });

  it('makes each layer edit its own step, between commands, undone in order', async () => {
    const t = setup();
    const n = lines(t.s);
    await t.run('L', '0,0', '10,0', '');
    t.s.edit({ kind: 'layer', layer: LAYER_0, locked: true });
    await t.run('L', '0,5', '10,5', '');
    expect(t.s.undoState.undoable).toBe(3);
    await t.run('U');
    expect(lines(t.s)).toBe(n + 1);
    expect(t.s.model.tables.layers.get(LAYER_0)?.locked).toBe(true);
    await t.run('U');
    expect(t.s.model.tables.layers.get(LAYER_0)?.locked).toBe(false);
    expect(lines(t.s)).toBe(n + 1);
  });

  it('makes a layout rename one undo step', async () => {
    const t = setup();
    const r = t.s.edit({ kind: 'layout', layout: '1E', name: 'Sheet A' });
    expect(r.ok).toBe(true);
    expect(t.s.undoState.nextUndo).toBe('LAYOUT');
    await t.run('U');
    expect(t.s.model.layouts.find((l) => l.handle === '1E')?.name).toBe('Layout1');
  });

  it('makes no step of a refused or a no-op edit, nor of loading an xref', () => {
    const t = setup();
    t.s.edit({ kind: 'layer', layer: 'FFFF', on: false });
    t.s.edit({ kind: 'layer', layer: LAYER_0, on: true });
    t.s.edit({ kind: 'layout', layout: '1E', name: 'Layout1' });
    expect(t.s.undoState.undoable).toBe(0);
    expect(t.undos()).toHaveLength(0);
  });

  it('forgets the redo once a layer edit changes the drawing', async () => {
    const t = setup();
    await t.run('L', '0,0', '10,0', '', 'U');
    expect(t.s.undoState.redoable).toBe(1);
    t.s.edit({ kind: 'layer', layer: LAYER_0, locked: true });
    expect(t.s.undoState.redoable).toBe(0);
  });

  it('makes a view the canvas changed one undo step, which U asks the canvas to swap back (M2-47 part 4)', async () => {
    const t = setup();
    const before = { center: { x: 1, y: 2 }, height: 30 };
    await t.s.command({ kind: 'view-step', label: 'ZOOM', viewport: '1F:0', view: before });
    expect(t.s.undoState).toMatchObject({ undoable: 1, nextUndo: 'ZOOM' });
    await t.run('U');
    const ask = t.out.findLast((o) => o.type === 'view');
    expect(ask).toMatchObject({ request: { op: 'swap', viewport: '1F:0', view: before } });
    // The canvas answers with the view it replaced, which REDO swaps back in.
    const after = { center: { x: 5, y: 6 }, height: 3, width: 4, paper: false };
    if (ask?.type !== 'view') throw new Error('no view request');
    await t.s.command({ kind: 'view', id: ask.id, reply: { ok: true, view: after } });
    await t.run('REDO');
    expect(t.out.findLast((o) => o.type === 'view')).toMatchObject({
      request: { op: 'swap', viewport: '1F:0', view: { center: after.center, height: 3 } },
    });
  });
});
