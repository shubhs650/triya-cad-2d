// M2-13: QSAVE, SAVE, SAVEAS and CLOSE hand the file to the app through the host and report its
// refusal; none changes the drawing or becomes an undo step. DRAWINGRECOVERY (M2-14 part 2) asks
// the app to offer the drawings it can recover again. PLOT and PRINT (M2-17) open the app's Plot
// dialog; its Window< button hands back to PLOT, which asks for the window's corners at the command
// line and opens the dialog again with them (part 2), or as it was on Esc there (part 3). PUBLISH
// opens the app's Publish dialog. EXPORT (EXP) and EXPORTPDF (M2-39 part 2) open the app's Export
// Data and Save As PDF dialogs, and ask for a window's corners when the dialog's Export is Window.
// While a command waits on one of the app's dialogs no prompt shows (M2-41), as AutoCAD's command
// line shows none while its dialog is up.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

function setup(answer: (r: ViewRequest) => ViewReply = () => ({ ok: true, file: 'a.dxf' })) {
  const asked: ViewRequest[] = [];
  const model = DocumentModel.create(sampleInit());
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        return Promise.resolve(answer(r));
      },
    },
  });
  return { bus, asked, model };
}

describe('the file commands', () => {
  it.each([
    ['QSAVE', 'qsave'],
    ['SAVE', 'saveas'],
    ['SAVEAS', 'saveas'],
    ['CLOSE', 'close'],
    ['CLOSEALL', 'closeall'],
    ['DRAWINGRECOVERY', 'recover'],
    ['PLOT', 'plot'],
    ['PRINT', 'plot'],
    ['PUBLISH', 'publish'],
    ['PREVIEW', 'preview'],
    ['EXPORT', 'export'],
    ['EXP', 'export'],
    ['EXPORTPDF', 'exportpdf'],
  ] as const)('%s asks the app to %s', async (name, action) => {
    const { bus, asked, model } = setup();
    const version = model.version;
    await bus.submit(name);
    expect(asked).toEqual([{ op: 'file', action }]);
    expect(bus.command).toBeUndefined();
    expect(model.version).toBe(version);
    expect(bus.undo.state.undoable).toBe(0);
  });

  it('PREVIEW (PRE) tells the drafter how to leave the preview while the app shows it', async () => {
    const { bus, asked } = setup();
    await bus.submit('PRE');
    expect(asked).toEqual([{ op: 'file', action: 'preview' }]);
    expect(bus.history).toContain(
      'Press ESC or ENTER to exit, or right-click to display shortcut menu.',
    );
  });

  it('reports what the app could not do', async () => {
    const { bus } = setup(() => ({ ok: false, message: 'Save cancelled.' }));
    await bus.submit('QSAVE');
    expect(bus.history.at(-1)).toBe('Save cancelled.');
  });

  it('asks for a plot window at the command line when the dialog wants one', async () => {
    let n = 0;
    const { bus, asked } = setup((r) =>
      r.op === 'file' && n++ === 0 ? { ok: true, pickWindow: true } : { ok: true },
    );
    await bus.submit('PLOT');
    expect(bus.command).toBe('PLOT');
    expect(bus.history).toContain('Specify window for printing');
    expect(bus.prompt?.message).toBe('Specify first corner');
    await bus.submit('10,20');
    expect(bus.prompt?.message).toBe('Specify opposite corner');
    await bus.submit('110,5');
    expect(asked).toEqual([
      { op: 'file', action: 'plot' },
      {
        op: 'file',
        action: 'plot',
        resume: true,
        window: { a: { x: 10, y: 20 }, b: { x: 110, y: 5 } },
      },
    ]);
    expect(bus.command).toBeUndefined();
  });

  it('opens the dialog again, as it was, on Esc at either corner (part 3)', async () => {
    let n = 0;
    // The dialog asks for a window twice, then plots.
    const { bus, asked } = setup((r) =>
      r.op === 'file' && n++ < 2 ? { ok: true, pickWindow: true } : { ok: true },
    );
    await bus.submit('PLOT');
    await bus.cancel();
    expect(bus.history).toContain('Specify first corner: *Cancel*');
    expect(bus.command).toBe('PLOT');
    expect(bus.prompt?.message).toBe('Specify first corner');
    await bus.submit('10,20');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(asked).toEqual([
      { op: 'file', action: 'plot' },
      { op: 'file', action: 'plot', resume: true },
      { op: 'file', action: 'plot', resume: true },
    ]);
  });

  it('ends PLOT when the dialog is cancelled after a window was asked for', async () => {
    let n = 0;
    const { bus, asked } = setup((r) =>
      r.op === 'file' && n++ === 0 ? { ok: true, pickWindow: true } : { ok: false, message: 'x' },
    );
    await bus.submit('PLOT');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(asked).toHaveLength(2);
  });

  it('EXPORTPDF asks for a window at the command line and opens Save As PDF again with it', async () => {
    let n = 0;
    const { bus, asked } = setup((r) =>
      r.op === 'file' && n++ === 0 ? { ok: true, pickWindow: true } : { ok: true },
    );
    await bus.submit('EXPORTPDF');
    expect(bus.command).toBe('EXPORTPDF');
    // AutoCAD's EXPORTPDF asks for the corners only; "for printing" is PLOT's.
    expect(bus.history).not.toContain('Specify window for printing');
    expect(bus.prompt?.message).toBe('Specify first corner');
    await bus.submit('0,0');
    await bus.submit('50,40');
    expect(asked).toEqual([
      { op: 'file', action: 'exportpdf' },
      {
        op: 'file',
        action: 'exportpdf',
        resume: true,
        window: { a: { x: 0, y: 0 }, b: { x: 50, y: 40 } },
      },
    ]);
    expect(bus.command).toBeUndefined();
  });

  it('EXPORT opens Export Data again as it was on Esc at the corners', async () => {
    let n = 0;
    const { bus, asked } = setup((r) =>
      r.op === 'file' && n++ === 0 ? { ok: true, pickWindow: true } : { ok: true },
    );
    await bus.submit('EXPORT');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(asked).toEqual([
      { op: 'file', action: 'export' },
      { op: 'file', action: 'export', resume: true },
    ]);
  });
});

/** A host whose `file` requests stay open (the dialog up) until `close` answers the oldest. */
function dialogHost(replies: ViewReply[]) {
  const open: ((r: ViewReply) => void)[] = [];
  const events: BusEvent[] = [];
  const model = DocumentModel.create(sampleInit());
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) =>
        r.op === 'file'
          ? new Promise<ViewReply>((resolve) => open.push(resolve))
          : Promise.resolve<ViewReply>({ ok: true, ids: [] }),
    },
  });
  bus.on((e) => events.push(e));
  // The bus's queue and the command's generator resolve over a few microtasks (engine tests have
  // no timers: `types: []`).
  const settle = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  return {
    bus,
    events,
    settle,
    /** The prompt events since the last call: the prompt the front-ends were last told of. */
    shown: () =>
      events.filter((e) => e.type === 'prompt' || e.type === 'idle' || e.type === 'waiting').at(-1),
    async close() {
      open.shift()!(replies.shift() ?? { ok: true });
      await settle();
    },
  };
}

describe('while a command waits on a dialog (M2-41)', () => {
  it('PLOT shows no prompt while the Plot dialog is open', async () => {
    const h = dialogHost([{ ok: true }]);
    void h.bus.submit('PLOT');
    await h.settle();
    expect(h.bus.command).toBe('PLOT');
    expect(h.shown()).toEqual({ type: 'waiting', command: 'PLOT' });
    expect(h.bus.prompt).toBeUndefined();
    expect(h.bus.promptText).toBe('');
    await h.close();
    expect(h.bus.command).toBeUndefined();
    expect(h.shown()).toEqual({ type: 'idle' });
    expect(h.bus.promptText).toBe('Command:');
  });

  it('shows no corner prompt once Esc at the window corners opens the dialog again', async () => {
    const h = dialogHost([{ ok: true, pickWindow: true }, { ok: true }]);
    void h.bus.submit('PLOT');
    await h.settle();
    await h.close();
    expect(h.bus.prompt?.message).toBe('Specify first corner');
    void h.bus.submit('10,20');
    await h.settle();
    expect(h.bus.prompt?.message).toBe('Specify opposite corner');
    void h.bus.cancel();
    await h.settle();
    expect(h.bus.command).toBe('PLOT');
    expect(h.shown()).toEqual({ type: 'waiting', command: 'PLOT' });
    expect(h.bus.prompt).toBeUndefined();
    expect(h.bus.promptText).toBe('');
    await h.close();
    expect(h.shown()).toEqual({ type: 'idle' });
  });

  it('drops the corner prompt of a window started at Command: when Ctrl+P opens the dialog', async () => {
    const h = dialogHost([{ ok: true }]);
    // A click on nothing at `Command:` starts a selection window.
    void h.bus.pick({ x: 1000, y: 1000 });
    await h.settle();
    expect(h.bus.promptText).toBe('Specify opposite corner:');
    void h.bus.invoke('PLOT');
    await h.settle();
    expect(h.bus.command).toBe('PLOT');
    expect(h.shown()).toEqual({ type: 'waiting', command: 'PLOT' });
    expect(h.bus.promptText).toBe('');
    await h.close();
    expect(h.bus.promptText).toBe('Command:');
  });

  it('a request the canvas answers (ZOOM Extents) is no dialog and hides no prompt', async () => {
    const h = dialogHost([]);
    await h.bus.submit('ZOOM');
    await h.bus.submit('E');
    expect(h.events.some((e) => e.type === 'waiting')).toBe(false);
  });
});
