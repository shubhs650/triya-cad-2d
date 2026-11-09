// M2-02: the command engine inside the engine session. Front-ends send `CommandInput`s; the
// session answers with the bus's events and, for each edit, the ChangeSet the render replicas
// apply, before the prompt that follows it.
import { describe, expect, it } from 'vitest';
import { DocumentModel, EngineSession, type CommandOutput } from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, sampleInit, snapshot } from '../model/fixtures';

function setup() {
  const s = new EngineSession(sampleInit());
  const out: CommandOutput[] = [];
  const stop = s.onCommand((o) => out.push(o));
  return { s, out, stop };
}

describe('EngineSession commands', () => {
  it('runs typed input and reports each change before the next prompt', async () => {
    const { s, out } = setup();
    await s.command({ kind: 'submit', text: 'L' });
    await s.command({ kind: 'submit', text: '0,0' });
    await s.command({ kind: 'submit', text: '@100<45' });
    await s.command({ kind: 'submit', text: '' });
    const types = out.map((o) => o.type);
    expect(types.slice(types.indexOf('change'))).toEqual([
      'change',
      'prompt',
      'log',
      'end',
      // The undo history's new state (M2-05), for the undo/redo buttons (M2-23).
      'undo',
      'commit',
      'idle',
    ]);
    const change = out.find((o) => o.type === 'change');
    expect(change?.type === 'change' && change.change.entities?.added?.[0]?.entity.owner).toBe(
      MODEL_SPACE,
    );
    expect(out.find((o) => o.type === 'commit')).toEqual({ type: 'commit', command: 'LINE' });
  });

  it('keeps a replica in step through the change outputs', async () => {
    const { s, out } = setup();
    const replica = DocumentModel.create(sampleInit());
    for (const text of ['L', '0,0', '10,0', '10,10', '5,5', '']) {
      await s.command({ kind: 'submit', text });
    }
    // As a render replica takes them (RenderSession.apply): new handles bound in id order.
    for (const o of out) {
      if (o.type !== 'change') continue;
      for (const { entity } of o.change.entities?.added ?? []) {
        expect(replica.ids.assign(entity.handle)).toBe(entity.id);
      }
      replica.apply(o.change);
    }
    expect(snapshot(replica)).toEqual(snapshot(s.model));
  });

  it('draws in the space shown, ignoring a block that does not exist', async () => {
    const { s, out } = setup();
    await s.command({ kind: 'space', block: 'FFFF' });
    await s.command({ kind: 'space', block: PAPER_SPACE });
    await s.command({ kind: 'invoke', name: 'LINE' });
    await s.command({ kind: 'answer', answer: { kind: 'point', point: { x: 0, y: 0 } } });
    await s.command({ kind: 'submit', text: '20', cursor: { x: 0, y: 5 } });
    await s.command({ kind: 'cancel' });
    const change = out.find((o) => o.type === 'change');
    const added =
      change?.type === 'change' ? change.change.entities?.added?.[0]?.entity : undefined;
    expect(added?.owner).toBe(PAPER_SPACE);
    expect(added?.geom).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 0, y: 20 } });
  });

  it('selects by Ctrl+A and canvas picks, and clears the selection when another space shows (M2-03)', async () => {
    const { s, out } = setup();
    const shown = () =>
      out
        .flatMap((o) =>
          o.type === 'selection' ? [o.ids.map((id) => s.model.ids.handleOf(id))] : [],
        )
        .at(-1);
    // The canvas's answers: picks and windows here find nothing.
    s.onCommand((o) => {
      if (o.type === 'view')
        void s.command({ kind: 'view', id: o.id, reply: { ok: true, ids: [] } });
    });
    await s.command({ kind: 'select-all' });
    expect(shown()).toEqual(['20', '21', '23']);
    await s.command({ kind: 'space', block: MODEL_SPACE });
    expect(shown()).toEqual([]);
    await s.command({ kind: 'select-all' });
    // A pick that finds nothing opens a window, which the end of the drag closes.
    await s.command({ kind: 'pick', point: { x: 1, y: 1 }, shift: true });
    expect(out.at(-1)).toMatchObject({ type: 'prompt', text: 'Specify opposite corner:' });
    await s.command({ kind: 'pick', point: { x: 2, y: 2 }, release: true });
    expect(out.at(-1)).toMatchObject({ type: 'idle' });
    await s.command({ kind: 'space', block: PAPER_SPACE });
    expect(shown()).toEqual([]);
    await s.command({ kind: 'select-all' });
    expect(shown()).toEqual(['24']);
  });

  it('stops telling a listener that unsubscribed', async () => {
    const { s, out, stop } = setup();
    stop();
    await s.command({ kind: 'submit', text: 'L' });
    expect(out).toEqual([]);
  });
});
