// M3-06 part 1: DSETTINGS (DS, SE) and OSNAP (OS) open the Drafting Settings dialog (AutoCAD
// 2024 Help, "DSETTINGS (Command)": "Sets grid and snap, polar and object snap tracking, object
// snap modes, Dynamic Input, Quick Properties, and Selection Cycling"; "OSNAP (Command)": opens
// it on the Object Snap tab). The settings are the app's per-user ones, which the dialog sets
// itself, so the command only waits while it is open. POLARMODE and POLARADDANG are app
// variables SETVAR asks the app for.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

function setup(view?: ViewHost) {
  const model = DocumentModel.create(sampleInit());
  const bus = new PromptBus({ model, registry: builtinCommands(), ...(view && { view }) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { model, bus, log };
}

describe('DSETTINGS and OSNAP', () => {
  it('open the Drafting Settings dialog, OSNAP on its Object Snap tab', async () => {
    for (const [typed, tab] of [
      ['DSETTINGS', undefined],
      ['DS', undefined],
      ['SE', undefined],
      ['OSNAP', 'osnap'],
      ['OS', 'osnap'],
    ] as const) {
      const { bus, model } = setup();
      const version = model.version;
      await bus.submit(typed);
      expect(bus.prompt).toMatchObject({
        kind: 'dialog',
        message: 'Drafting Settings',
        dialog: { type: 'dsettings' },
      });
      const dialog = bus.prompt?.kind === 'dialog' ? bus.prompt.dialog : undefined;
      expect(dialog && 'tab' in dialog ? dialog.tab : undefined).toBe(tab);
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.command).toBeUndefined();
      // The drawing is not edited: the settings are the app's, not the file's.
      expect(model.version).toBe(version);
      expect(bus.undo.state.undoable).toBe(0);
    }
  });

  it('closes on Cancel, and opens transparently inside another command', async () => {
    const { bus } = setup();
    await bus.submit('DSETTINGS');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    await bus.submit('LINE');
    await bus.submit("'OSNAP");
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      dialog: { type: 'dsettings', tab: 'osnap' },
    });
    await bus.answer({ kind: 'dialog', action: 'ok' });
    expect(bus.promptText).toBe('Specify first point:');
    await bus.cancel();
  });
});

describe('POLARMODE and POLARADDANG', () => {
  /** The app's side: what it keeps, set as asked (`sysvar`). */
  function app(values: Record<string, number | string>) {
    const view: ViewHost = {
      request: (r): Promise<ViewReply> => {
        if (r.op !== 'sysvar') return Promise.resolve({ ok: false, message: 'no' });
        if (r.text !== undefined && /x/.test(r.text))
          return Promise.resolve({ ok: false, message: 'Invalid angle list.' });
        const value = r.text ?? r.value;
        if (value !== undefined) values[r.name] = value;
        return Promise.resolve({ ok: true, value: values[r.name]! });
      },
    };
    return view;
  }

  it('are set at the command line, POLARMODE 0 to 15 and POLARADDANG as text', async () => {
    // AutoCAD 2024 Help, "POLARMODE": bits 1 relative to the last segment, 2 object snap
    // tracking along the polar angles, 4 the additional angles, 8 Shift to acquire; initially 0.
    // "POLARADDANG": up to 10 angles separated by semicolons; initially "".
    const values: Record<string, number | string> = { POLARMODE: 0, POLARADDANG: '' };
    const { bus, log } = setup(app(values));
    await bus.submit('POLARMODE');
    expect(bus.promptText).toBe('Enter new value for POLARMODE <0>:');
    await bus.submit('16');
    expect(log.at(-1)).toBe('Value must be between 0 and 15.');
    await bus.submit('6');
    expect(values['POLARMODE']).toBe(6);
    await bus.submit('POLARADDANG');
    expect(bus.promptText).toBe('Enter new value for POLARADDANG <"">:');
    await bus.submit('12.5;80');
    expect(values['POLARADDANG']).toBe('12.5;80');
    // The app refuses a list it cannot read, and says why.
    await bus.submit('POLARADDANG');
    await bus.submit('x');
    expect(log.at(-1)).toBe('Invalid angle list.');
    expect(values['POLARADDANG']).toBe('12.5;80');
    expect(bus.undo.state.undoable).toBe(0);
  });
  it('are joined by SNAPTYPE (0 or 1) and POLARDIST (0 or more), M3-06 part 3', async () => {
    // AutoCAD 2024 Help, "SNAPTYPE": 0 grid snap, 1 PolarSnap; "POLARDIST": the PolarSnap
    // increment, a real, initially 0. Both are kept in the registry, so the app keeps them.
    const values: Record<string, number | string> = { SNAPTYPE: 0, POLARDIST: 0 };
    const { bus, log } = setup(app(values));
    await bus.submit('SNAPTYPE');
    expect(bus.promptText).toBe('Enter new value for SNAPTYPE <0>:');
    await bus.submit('2');
    expect(log.at(-1)).toBe('Value must be between 0 and 1.');
    await bus.submit('1');
    expect(values['SNAPTYPE']).toBe(1);
    await bus.submit('POLARDIST');
    expect(bus.promptText).toBe('Enter new value for POLARDIST <0.0000>:');
    await bus.submit('-1');
    expect(values['POLARDIST']).toBe(0);
    await bus.cancel();
    await bus.submit('POLARDIST');
    await bus.submit('2.5');
    expect(values['POLARDIST']).toBe(2.5);
  });
});
