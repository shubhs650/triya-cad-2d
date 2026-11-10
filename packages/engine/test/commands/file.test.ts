// M2-13: QSAVE, SAVE, SAVEAS and CLOSE hand the file to the app through the host and report its
// refusal; none changes the drawing or becomes an undo step. DRAWINGRECOVERY (M2-14 part 2) asks
// the app to offer the drawings it can recover again. PLOT and PRINT (M2-17) open the app's Plot
// dialog; its Window< button hands back to PLOT, which asks for the window's corners at the command
// line and opens the dialog again with them (part 2), or as it was on Esc there (part 3). PUBLISH
// opens the app's Publish dialog.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
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
    ['DRAWINGRECOVERY', 'recover'],
    ['PLOT', 'plot'],
    ['PRINT', 'plot'],
    ['PUBLISH', 'publish'],
    ['PREVIEW', 'preview'],
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
});
