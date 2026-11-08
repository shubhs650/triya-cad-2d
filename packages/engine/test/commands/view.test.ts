// M2-02 part 2: ZOOM, PAN, REGEN/REGENALL and VIEW on the PromptBus, against a view host that
// records what the commands asked of the canvas. AutoCAD 2024's prompts and options: ZOOM's
// window corner, nX/nXP/n scales, All, Center, Dynamic (a window here), Extents, Previous, Scale,
// Window and <real time>; PAN real time and -PAN; transparent 'Z and 'P inside LINE; -VIEW's ?,
// Restore, Save and Window.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  parseZoomScale,
  viewNameMatches,
  type CommandOutput,
  type NamedViewInfo,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const VIEW = { center: { x: 50, y: 25 }, height: 40, width: 80, paper: false };

function setup(
  answer: (r: ViewRequest) => ViewReply = () => ({ ok: true, view: VIEW }),
  views: NamedViewInfo[] = [],
) {
  const asked: ViewRequest[] = [];
  const bus = new PromptBus({
    model: DocumentModel.create(sampleInit()),
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        return Promise.resolve(r.op === 'views' ? { ok: true, views } : answer(r));
      },
    },
  });
  return { bus, asked };
}

describe('parseZoomScale', () => {
  it('reads n, nX and nXP', () => {
    expect(parseZoomScale('2')).toEqual({ factor: 2, relativeTo: 'limits' });
    expect(parseZoomScale('0.5X')).toEqual({ factor: 0.5, relativeTo: 'view' });
    expect(parseZoomScale(' .25 xp')).toEqual({ factor: 0.25, relativeTo: 'paper' });
    expect(parseZoomScale('1e1x')).toEqual({ factor: 10, relativeTo: 'view' });
    expect(parseZoomScale('2y')).toBeUndefined();
    expect(parseZoomScale('x')).toBeUndefined();
  });
});

describe('ZOOM', () => {
  it("shows AutoCAD's prompt with <real time>", async () => {
    const { bus } = setup();
    await bus.submit('Z');
    expect(bus.promptText).toBe(
      'Specify corner of window, enter a scale factor (nX or nXP), or ' +
        '[All/Center/Dynamic/Extents/Previous/Scale/Window] <real time>:',
    );
  });

  it('zooms to a window from a corner picked at the first prompt', async () => {
    const { bus, asked } = setup();
    await bus.script(['ZOOM', '0,0']);
    expect(bus.promptText).toBe('Specify opposite corner:');
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 0, y: 0 }, box: true } });
    await bus.submit('100,50');
    expect(asked).toEqual([{ op: 'window', a: { x: 0, y: 0 }, b: { x: 100, y: 50 } }]);
    expect(bus.command).toBeUndefined();
  });

  it('scales by n, nX and nXP typed at the first prompt', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', '2', 'Z', '0.5x', 'Z', '1xp']);
    expect(asked).toEqual([
      { op: 'scale', factor: 2, relativeTo: 'limits' },
      { op: 'scale', factor: 0.5, relativeTo: 'view' },
      { op: 'scale', factor: 1, relativeTo: 'paper' },
    ]);
  });

  it('refuses what it cannot read and asks again', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', 'banana']);
    expect(bus.history.at(-1)).toBe('Requires a distance, numberX, or option keyword.');
    expect(bus.command).toBe('ZOOM');
    await bus.submit('0x');
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    expect(asked).toEqual([]);
  });

  it('All, Extents and Previous each ask the canvas once', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', 'A', 'Z', 'E', 'Z', 'P']);
    expect(asked.map((r) => r.op)).toEqual(['all', 'extents', 'previous']);
  });

  it('says why the canvas refused (no previous view)', async () => {
    const { bus } = setup((r) =>
      r.op === 'previous' ? { ok: false, message: 'No previous view saved.' } : { ok: true },
    );
    await bus.script(['Z', 'P']);
    expect(bus.history.at(-1)).toBe('No previous view saved.');
  });

  it('Window and Dynamic pick two corners', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', 'W', '1,1']);
    expect(bus.promptText).toBe('Specify opposite corner:');
    await bus.script(['5,5', 'Z', 'D', '2,2', '3,4']);
    expect(asked).toEqual([
      { op: 'window', a: { x: 1, y: 1 }, b: { x: 5, y: 5 } },
      { op: 'window', a: { x: 2, y: 2 }, b: { x: 3, y: 4 } },
    ]);
    await bus.script(['Z', 'W', '']);
    expect(bus.command).toBeUndefined();
  });

  it('Center takes a height, nX of the current height, or nXP', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', 'C', '10,10']);
    expect(bus.promptText).toBe('Enter magnification or height <40.0000>:');
    await bus.script(['', 'Z', 'C', '10,10', '20', 'Z', 'C', '0,0', '2x', 'Z', 'C', '0,0', '3xp']);
    const centre = asked.filter((r) => r.op !== 'get');
    expect(centre).toEqual([
      { op: 'center', center: { x: 10, y: 10 }, height: 40 },
      { op: 'center', center: { x: 10, y: 10 }, height: 20 },
      { op: 'center', center: { x: 0, y: 0 }, height: 20 },
      { op: 'center', center: { x: 0, y: 0 }, height: 40 },
      { op: 'scale', factor: 3, relativeTo: 'paper' },
    ]);
  });

  it('Center refuses a zero height and a scale it cannot read', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', 'C', '0,0', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.submit('what');
    expect(bus.history.at(-1)).toBe('Requires a distance, numberX, or option keyword.');
    await bus.submit('-2x');
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.submit('@0,10');
    expect(asked.at(-1)).toEqual({ op: 'center', center: { x: 0, y: 0 }, height: 10 });
  });

  it('Center without a canvas says so and ends', async () => {
    const bus = new PromptBus({
      model: DocumentModel.create(sampleInit()),
      registry: builtinCommands(),
    });
    await bus.script(['Z', 'C', '0,0']);
    expect(bus.history.at(-1)).toBe('There is no view to change.');
    expect(bus.command).toBeUndefined();
  });

  it('Scale asks for nX or nXP until it can read one', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', 'S']);
    expect(bus.promptText).toBe('Enter a scale factor (nX or nXP):');
    await bus.submit('lots');
    expect(bus.history.at(-1)).toBe('Requires a distance, numberX, or option keyword.');
    await bus.submit('2x');
    expect(asked).toEqual([{ op: 'scale', factor: 2, relativeTo: 'view' }]);
    await bus.script(['Z', 'S', '']);
    expect(bus.command).toBeUndefined();
  });

  it('Enter zooms in real time until Enter or Esc', async () => {
    const { bus, asked } = setup();
    await bus.script(['Z', '']);
    expect(bus.promptText).toBe('Press ESC or ENTER to exit:');
    await bus.submit('');
    await bus.script(['Z', '']);
    await bus.cancel();
    expect(asked).toEqual([
      { op: 'realtime', mode: 'zoom' },
      { op: 'realtime', mode: 'none' },
      { op: 'realtime', mode: 'zoom' },
      { op: 'realtime', mode: 'none' },
    ]);
  });

  it("runs transparently inside LINE ('Z) and resumes it", async () => {
    const { bus, asked } = setup();
    await bus.script(['LINE', '0,0', "'Z", 'E']);
    expect(asked).toEqual([{ op: 'extents' }]);
    expect(bus.history.slice(-2)).toEqual([
      '>>Specify corner of window, enter a scale factor (nX or nXP), or ' +
        '[All/Center/Dynamic/Extents/Previous/Scale/Window] <real time>: E',
      'Resuming LINE command.',
    ]);
    expect(bus.promptText).toBe('Specify next point or [Undo]:');
  });
});

describe('PAN', () => {
  it('pans in real time until Enter', async () => {
    const { bus, asked } = setup();
    await bus.script(['P', '']);
    expect(asked).toEqual([
      { op: 'realtime', mode: 'pan' },
      { op: 'realtime', mode: 'none' },
    ]);
  });

  it('does not wait when the canvas refuses real time', async () => {
    const { bus } = setup(() => ({ ok: false, message: 'There is no view to change.' }));
    await bus.submit('PAN');
    expect(bus.command).toBeUndefined();
  });

  it('-PAN moves by two points, or by a displacement with Enter', async () => {
    const { bus, asked } = setup();
    await bus.script(['-P', '10,10', '15,20', '-PAN', '3,4', '']);
    expect(asked).toEqual([
      { op: 'pan', by: { x: 5, y: 10 } },
      { op: 'pan', by: { x: 3, y: 4 } },
    ]);
    await bus.script(['-PAN', '']);
    expect(bus.command).toBeUndefined();
  });

  it("'P runs inside LINE", async () => {
    const { bus } = setup();
    await bus.script(['L', '0,0', "'P"]);
    expect(bus.promptText).toBe('>>Press ESC or ENTER to exit:');
    await bus.submit('');
    expect(bus.command).toBe('LINE');
  });
});

describe('REGEN and REGENALL', () => {
  it('regenerate the space shown and say which', async () => {
    const { bus, asked } = setup((r) =>
      r.op === 'regen' && r.all
        ? { ok: true, view: { ...VIEW, paper: true } }
        : { ok: true, view: VIEW },
    );
    await bus.script(['RE', 'REA']);
    expect(asked).toEqual([
      { op: 'regen', all: false },
      { op: 'regen', all: true },
    ]);
    expect(bus.history.filter((l) => l.startsWith('Regenerating'))).toEqual([
      'Regenerating model.',
      'Regenerating layout.',
    ]);
  });
});

describe('VIEW', () => {
  const views: NamedViewInfo[] = [
    { name: 'Front', inDrawing: true, restorable: true },
    { name: 'Iso', inDrawing: true, restorable: false },
    { name: 'Detail A', inDrawing: false, restorable: true },
  ];

  it('lists views matching the pattern', async () => {
    const { bus } = setup(undefined, views);
    await bus.submit('-VIEW');
    expect(bus.promptText).toBe('Enter an option [?/Restore/Save/Window]:');
    await bus.script(['?', '']);
    expect(bus.history.slice(-4)).toEqual([
      'Saved views:',
      '  Front',
      '  Iso  (not a plan view)',
      '  Detail A  (this session)',
    ]);
    await bus.script(['-V', '?', 'f*']);
    expect(bus.history.slice(-2)).toEqual(['Saved views:', '  Front']);
    await bus.script(['VIEW', '?', 'zz']);
    expect(bus.history.at(-1)).toBe('No matching views found.');
  });

  it('restores and saves by name, with spaces', async () => {
    const { bus, asked } = setup();
    await bus.script(['V', 'R', 'Detail A', 'V', 'S', 'Plan 2']);
    expect(asked).toEqual([
      { op: 'restore', name: 'Detail A' },
      { op: 'save', name: 'Plan 2' },
    ]);
  });

  it('saves a window as a view', async () => {
    const { bus, asked } = setup();
    await bus.script(['V', 'W', 'Corner', '0,0', '10,5']);
    expect(asked).toEqual([
      { op: 'save', name: 'Corner', window: { a: { x: 0, y: 0 }, b: { x: 10, y: 5 } } },
    ]);
  });

  it('refuses names AutoCAD refuses', async () => {
    const { bus, asked } = setup();
    await bus.script(['V', 'S', 'a<b']);
    expect(bus.history.at(-1)).toBe('Invalid view name.');
    expect(bus.command).toBe('VIEW');
    await bus.cancel();
    expect(asked).toEqual([]);
  });

  it('matches ? patterns with * and ?, case ignored, comma separated', () => {
    expect(viewNameMatches('Front', 'FR*')).toBe(true);
    expect(viewNameMatches('Front', 'fr?nt')).toBe(true);
    expect(viewNameMatches('Front', 'back,front')).toBe(true);
    expect(viewNameMatches('Front.1', 'front?1')).toBe(true);
    expect(viewNameMatches('Front', 'Fr')).toBe(false);
    expect(viewNameMatches('Front', '')).toBe(false);
  });
});

describe('EngineSession view requests', () => {
  it('carries a request out and the reply back while the command waits', async () => {
    const session = new EngineSession(sampleInit());
    const out: CommandOutput[] = [];
    session.onCommand((o) => {
      out.push(o);
      if (o.type === 'view') {
        void session.command({ kind: 'view', id: o.id, reply: { ok: true, view: VIEW } });
      }
    });
    await session.command({ kind: 'submit', text: 'ZOOM' });
    await session.command({ kind: 'submit', text: 'E' });
    const view = out.filter((o) => o.type === 'view');
    expect(view).toEqual([{ type: 'view', id: 1, request: { op: 'extents' } }]);
    // A reply nobody waits for is dropped.
    await session.command({ kind: 'view', id: 99, reply: { ok: true } });
    expect(out.at(-1)).toEqual({ type: 'idle' });
  });
});
