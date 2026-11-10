// M2-13: QSAVE, SAVE, SAVEAS and CLOSE hand the file to the app through the host and report its
// refusal; none changes the drawing or becomes an undo step. DRAWINGRECOVERY (M2-14 part 2) asks
// the app to offer the drawings it can recover again. PLOT and PRINT (M2-17) open the app's Plot
// dialog.
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
  ] as const)('%s asks the app to %s', async (name, action) => {
    const { bus, asked, model } = setup();
    const version = model.version;
    await bus.submit(name);
    expect(asked).toEqual([{ op: 'file', action }]);
    expect(bus.command).toBeUndefined();
    expect(model.version).toBe(version);
    expect(bus.undo.state.undoable).toBe(0);
  });

  it('reports what the app could not do', async () => {
    const { bus } = setup(() => ({ ok: false, message: 'Save cancelled.' }));
    await bus.submit('QSAVE');
    expect(bus.history.at(-1)).toBe('Save cancelled.');
  });
});
