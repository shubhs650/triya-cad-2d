// M7-06: the commands behind AutoCAD's window keys. CLEANSCREENON and CLEANSCREENOFF (Ctrl+0)
// hide and show the ribbon and the palettes; HIDEPALETTES and SHOWPALETTES (Ctrl+Shift+H) the
// palettes; TEXTSCR and GRAPHSCR (F2, Ctrl+F2) open and close the command history; QUIT (EXIT,
// Ctrl+Q) closes every drawing, as a page cannot close its window. The app does each; none edits
// the drawing, and all but QUIT run inside another command too, as AutoCAD's do.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

function setup() {
  const asked: ViewRequest[] = [];
  const model = DocumentModel.create(sampleInit());
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        return Promise.resolve({ ok: true });
      },
    },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { bus, asked, model, log };
}

describe("the window keys' commands", () => {
  it.each([
    ['CLEANSCREENON', { op: 'cleanScreen', on: true }],
    ['CLEANSCREENOFF', { op: 'cleanScreen', on: false }],
    ['HIDEPALETTES', { op: 'palettes', shown: false }],
    ['SHOWPALETTES', { op: 'palettes', shown: true }],
    ['TEXTSCR', { op: 'palette', palette: 'history', open: true }],
    ['GRAPHSCR', { op: 'palette', palette: 'history', open: false }],
  ] as const)('%s asks the app, inside LINE too', async (name, request) => {
    const { bus, asked, model } = setup();
    const version = model.version;
    await bus.submit(name);
    expect(asked).toEqual([request]);
    expect(bus.command).toBeUndefined();
    await bus.submit('LINE');
    await bus.submit(`'${name}`);
    expect(asked).toEqual([request, request]);
    expect(bus.command).toBe('LINE');
    expect(model.version).toBe(version);
  });

  it('QUIT and EXIT close every drawing, as CLOSEALL does', async () => {
    const { bus, asked } = setup();
    await bus.submit('QUIT');
    await bus.submit('EXIT');
    expect(asked).toEqual([
      { op: 'file', action: 'closeall' },
      { op: 'file', action: 'closeall' },
    ]);
  });

  it('keep the selection', async () => {
    const { bus } = setup();
    await bus.selectAll();
    const n = bus.selection.length;
    expect(n).toBeGreaterThan(0);
    for (const c of ['CLEANSCREENON', 'HIDEPALETTES', 'TEXTSCR']) await bus.submit(c);
    expect(bus.selection).toHaveLength(n);
  });
});
