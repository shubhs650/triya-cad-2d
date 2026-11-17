// M5-07 part 2: LAYERSTATE (LAS) opens the Layer States Manager, as AutoCAD 2024's does
// (AutoCAD Help, "LAYERSTATE (Command)": "Saves, restores, and manages named layer states").
// The dialog is the app's, so the command asks the host and waits for it to close.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

function setup(answer: (r: ViewRequest) => ViewReply = () => ({ ok: true })) {
  const asked: ViewRequest[] = [];
  const bus = new PromptBus({
    model: DocumentModel.create(sampleInit()),
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        return Promise.resolve(answer(r));
      },
    },
  });
  return { bus, asked };
}

describe('LAYERSTATE (M5-07 part 2)', () => {
  it('LAYERSTATE and LAS open the Layer States Manager and wait for it', async () => {
    const { bus, asked } = setup();
    await bus.submit('LAYERSTATE');
    await bus.submit('las');
    expect(asked).toEqual([
      { op: 'file', action: 'layerstates' },
      { op: 'file', action: 'layerstates' },
    ]);
    expect(bus.command).toBeUndefined();
  });

  it('says why when there is no dialog to open', async () => {
    const { bus } = setup(() => ({ ok: false, message: 'There is no drawing to save.' }));
    await bus.submit('LAYERSTATE');
    expect(bus.history.at(-1)).toBe('There is no drawing to save.');
    expect(bus.command).toBeUndefined();
  });
});
