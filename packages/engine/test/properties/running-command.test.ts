// M2-35 part 30: Properties palette edits while a command's "Select objects" prompt runs. The
// palette shows the objects that prompt has selected so far (`PromptBus.selection`, since M2-21);
// an edit changes those objects and the command goes on prompting, its selection kept. Before,
// the edit cancelled the command first and so changed the drawing's current settings (nothing
// being selected at `Command:` once the command had started) instead of what the palette showed.
// AutoCAD 2024's Help ("Properties Palette") does not say what an edit does mid-command; the
// common expectation, that a palette edit changes what the palette shows, is the one encoded.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type CommandOutput,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type PropertySheet,
  type StringPrompt,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

function setup(i: DocumentInit = sampleInit()) {
  const model = DocumentModel.create(i);
  const registry = builtinCommands();
  const bus = new PromptBus({
    model,
    registry,
    view: { request: () => Promise.resolve({ ok: true }) },
  });
  const log: string[] = [];
  const events: BusEvent[] = [];
  bus.on((e: BusEvent) => {
    events.push(e);
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  const ends = (e: Entity) => {
    const g = e.geom as Extract<EntityGeometry, { kind: 'LINE' }>;
    return [g.start.x, g.start.y, g.end.x, g.end.y];
  };
  return { model, bus, registry, log, events, byHandle, ids, ends };
}

const RED = { kind: 'aci', index: 1 };

describe('a palette edit inside a running command’s selection (M2-35 part 30)', () => {
  it('changes the objects selected so far and leaves the command prompting', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL']);
    expect(s.bus.selection).toHaveLength(3);
    const logged = s.log.length;
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    for (const h of ['20', '21', '23']) expect(s.byHandle(h).color).toEqual(RED);
    // The drawing's current colour is not what changed.
    expect(s.model.header.get('$CECOLOR')).not.toBe(1);
    // MOVE is still at its prompt, with its selection: nothing is cancelled or echoed.
    expect(s.bus.command).toBe('MOVE');
    expect(s.bus.promptText).toBe('Select objects:');
    expect(s.bus.selection).toEqual(s.ids('20', '21', '23'));
    expect(s.log.slice(logged)).toEqual([]);
    // MOVE goes on with the edited objects. The edit joins MOVE's undo step, as a transparent
    // command's edits do: one U takes back both.
    expect(s.bus.undo.state.undoable).toBe(0);
    await s.bus.script(['', '0,0', '5,0']);
    expect(s.bus.command).toBeUndefined();
    expect(s.ends(s.byHandle('20'))).toEqual([5, 0, 15, 0]);
    expect(s.byHandle('20').color).toEqual(RED);
    expect(s.bus.undo.state).toMatchObject({ undoable: 1, nextUndo: 'MOVE' });
    await s.bus.submit('U');
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 10, 0]);
    expect(s.byHandle('20').color).toEqual({ kind: 'byLayer' });
  });

  it('applies to the type the palette is narrowed to', async () => {
    const s = setup();
    await s.bus.script(['ERASE', 'ALL']);
    await s.bus.setProperty({ key: 'ltScale', value: '2' }, 'LINE');
    expect(s.byHandle('20').ltScale).toBe(2);
    expect(s.byHandle('23').ltScale).toBe(2);
    expect(s.byHandle('21').ltScale).toBe(1);
    expect(s.bus.command).toBe('ERASE');
    // ERASE still takes the whole selection.
    await s.bus.submit('');
    expect(s.model.entityByHandle('20')).toBeUndefined();
    expect(s.model.entityByHandle('21')).toBeUndefined();
  });

  it('keeps the edit when the command is then cancelled', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL']);
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect(s.byHandle('21').color).toEqual(RED);
    // A cancelled command keeps what was done in it, as one step.
    expect(s.bus.undo.state).toMatchObject({ undoable: 1, nextUndo: 'MOVE' });
    await s.bus.submit('U');
    expect(s.byHandle('21').color).toEqual({ kind: 'byLayer' });
  });

  it('undoes the edit in order with what the command did before it', async () => {
    // A command that has edited the drawing before its "Select objects" prompt: one step holds
    // its edit and the palette's, undone in the order they were made.
    const s = setup();
    s.registry.register({
      name: 'NUDGE',
      usesSelection: 'during',
      async *run(ctx) {
        const line = ctx.model.entityByHandle('20')!;
        ctx.edit((b) =>
          b.updateEntity(line.id, {
            geom: { ...line.geom, end: { x: 12, y: 0 } } as EntityGeometry,
          }),
        );
        yield ctx.prompt.selection({ message: 'Select objects', editable: true });
      },
    });
    await s.bus.script(['NUDGE', 'ALL']);
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    await s.bus.submit('');
    expect(s.bus.undo.state.undoList).toEqual(['NUDGE']);
    await s.bus.submit('U');
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 10, 0]);
    expect(s.byHandle('20').color).toEqual({ kind: 'byLayer' });
    expect(s.log.at(-1)).not.toMatch(/error/);
  });

  it('changes the current settings when the prompt has selected nothing yet', async () => {
    const s = setup();
    await s.bus.submit('MOVE');
    expect(s.bus.selection).toEqual([]);
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    expect(s.model.header.get('$CECOLOR')).toBe(1);
    expect(s.bus.command).toBe('MOVE');
    expect(s.bus.promptText).toBe('Select objects:');
  });

  it('reports a refused value and asks again', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL']);
    const logged = s.log.length;
    const prompts = s.events.length;
    await s.bus.setProperty({ key: 'ltScale', value: '-1' });
    expect(s.log.slice(logged).length).toBeGreaterThan(0);
    // The prompt is shown again after the message.
    expect(s.events.slice(prompts).at(-1)).toMatchObject({
      type: 'prompt',
      text: 'Select objects:',
    });
    expect(s.bus.command).toBe('MOVE');
    expect(s.bus.undo.state.undoable).toBe(0);
  });

  it('cancels a command whose prompt is not "Select objects", as before', async () => {
    const s = setup();
    await s.bus.script(['LINE', '0,0']);
    await s.bus.setProperty({ key: 'color', value: 'aci:1' });
    expect(s.bus.command).toBeUndefined();
    expect(s.log.at(-1)).toMatch(/\*Cancel\*$/);
  });

  it('opens the MTEXT editor on the MTEXT the prompt selected', async () => {
    const base = sampleInit();
    const s = setup({
      ...base,
      tables: {
        ...base.tables,
        textStyles: [
          { handle: '30', name: 'Standard', height: 0, widthFactor: 1, obliqueAngle: 0 } as never,
        ],
      },
      entities: [
        entityInit('62', {
          kind: 'MTEXT',
          contents: 'NOTE',
          style: '30',
          position: { x: 2, y: 8 },
          height: 2.5,
          width: 40,
          rotation: 0,
          attachment: 1,
          lineSpacing: 1,
        } as EntityGeometry),
      ],
    });
    await s.bus.script(['MOVE', 'ALL']);
    // The editor is a command of its own: MOVE is cancelled first, as before, and the editor
    // opens on the MTEXT the palette showed.
    await s.bus.editContents('MTEXT');
    expect(s.bus.command).toBe('PROPERTIES');
    expect((s.bus.prompt as StringPrompt).editor).toMatchObject({ kind: 'mtext', value: 'NOTE' });
    await s.bus.answer({ kind: 'string', value: 'NEW', editor: true });
    expect((s.byHandle('62').geom as Extract<EntityGeometry, { kind: 'MTEXT' }>).contents).toBe(
      'NEW',
    );
    expect(s.bus.selection).toEqual(s.ids('62'));
  });
});

describe('the session’s palette inside a running command (M2-35 part 30)', () => {
  it('sends the sheet of the edited selection while the command runs', async () => {
    const session = new EngineSession(sampleInit());
    const sheets: PropertySheet[] = [];
    session.onCommand((o: CommandOutput) => {
      if (o.type === 'properties') sheets.push(o.sheet);
    });
    await session.command({ kind: 'properties', open: true });
    await session.command({ kind: 'submit', text: 'MOVE' });
    await session.command({ kind: 'submit', text: 'ALL' });
    await Promise.resolve();
    expect(sheets.at(-1)?.count).toBe(3);
    await session.command({ kind: 'property', edit: { key: 'color', value: 'aci:1' } });
    await Promise.resolve();
    const color = sheets
      .at(-1)
      ?.sections.flatMap((x) => x.rows)
      .find((r) => r.label === 'Color');
    expect(sheets.at(-1)?.count).toBe(3);
    expect(color?.value).toBe('aci:1');
  });
});
