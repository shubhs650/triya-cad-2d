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
  const model = DocumentModel.create(sampleInit());
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        return Promise.resolve(r.op === 'views' ? { ok: true, views } : answer(r));
      },
    },
  });
  return { bus, asked, model };
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
        '[All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
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
        '[All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>: E',
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
    expect(bus.promptText).toBe('Enter an option [?/Delete/Restore/Save/Window]:');
    await bus.script(['?', '']);
    expect(bus.history.slice(-4)).toEqual([
      'Saved views:',
      '  Front',
      '  Iso  (not a plan view)',
      '  Detail A  (this session)',
    ]);
    await bus.script(['-V', '?', 'f*']);
    expect(bus.history.slice(-2)).toEqual(['Saved views:', '  Front']);
    await bus.script(['-VIEW', '?', 'zz']);
    expect(bus.history.at(-1)).toBe('No matching views found.');
  });

  it('restores by name, with spaces', async () => {
    const { bus, asked } = setup();
    await bus.script(['-V', 'R', 'Detail A']);
    expect(asked).toEqual([{ op: 'restore', name: 'Detail A' }]);
  });

  /** The drawing's views as [name, flags, centre x, centre y, height, width]. */
  const viewsOf = (model: DocumentModel) =>
    [...model.tables.views.values()].map((v) => [
      v.name,
      v.flags ?? 0,
      v.center.x,
      v.center.y,
      v.height,
      v.width,
    ]);

  it('saves the current view in the drawing as one undo step (M2-29)', async () => {
    const { bus, asked, model } = setup();
    await bus.script(['-V', 'S', 'Plan 2']);
    expect(asked).toEqual([{ op: 'get' }]);
    expect(viewsOf(model)).toEqual([['Plan 2', 0, 50, 25, 40, 80]]);
    expect([bus.undo.state.undoable, bus.undo.state.nextUndo]).toEqual([1, 'VIEW']);
    // Saved again under the name, it replaces the view.
    await bus.script(['-V', 'S', 'plan 2']);
    expect(viewsOf(model)).toEqual([['Plan 2', 0, 50, 25, 40, 80]]);
    await bus.script(['U']);
    await bus.script(['U']);
    expect(viewsOf(model)).toEqual([]);
  });

  it('saves a paper-space view with its flag', async () => {
    const { bus, model } = setup(() => ({ ok: true, view: { ...VIEW, paper: true } }));
    await bus.script(['-V', 'S', 'Sheet']);
    expect(viewsOf(model)).toEqual([['Sheet', 1, 50, 25, 40, 80]]);
  });

  it('says so when the canvas cannot tell the view', async () => {
    const { bus, model } = setup(() => ({ ok: false, message: 'There is no view to change.' }));
    await bus.script(['-V', 'S', 'Plan']);
    expect(bus.history.at(-1)).toBe('There is no view to change.');
    expect(viewsOf(model)).toEqual([]);
  });

  it('saves a window as a view, without asking the canvas', async () => {
    const { bus, asked, model } = setup();
    await bus.script(['-V', 'W', 'Corner', '0,0', '10,5']);
    expect(asked).toEqual([]);
    expect(viewsOf(model)).toEqual([['Corner', 0, 5, 2.5, 5, 10]]);
    await bus.script(['-V', 'W', 'Flat', '0,0', '10,0']);
    expect(bus.history.at(-1)).toBe('The window has no area.');
    expect(viewsOf(model)).toHaveLength(1);
  });

  it('deletes the views a pattern names', async () => {
    const { bus, model } = setup();
    for (const n of ['Front', 'Back', 'Detail A']) await bus.script(['-V', 'S', n]);
    await bus.submit('-VIEW');
    await bus.submit('D');
    expect(bus.promptText).toBe('Enter view name(s) to delete:');
    await bus.submit('f*,DETAIL ?');
    expect(viewsOf(model).map((v) => v[0])).toEqual(['Back']);
    expect(bus.undo.state.nextUndo).toBe('VIEW');
    await bus.script(['-V', 'D', 'zz']);
    expect(bus.history.at(-1)).toBe('No matching views found.');
    await bus.script(['U']);
    expect(
      viewsOf(model)
        .map((v) => v[0] as string)
        .sort(),
    ).toEqual(['Back', 'Detail A', 'Front']);
  });

  it('refuses names AutoCAD refuses', async () => {
    const { bus, asked, model } = setup();
    await bus.script(['-V', 'S', 'a<b']);
    expect(bus.history.at(-1)).toBe('Invalid view name.');
    expect(bus.command).toBe('VIEW');
    await bus.cancel();
    expect(asked).toEqual([]);
    expect(model.tables.views.size).toBe(0);
  });

  // M2-47 part 2: VIEW without the dash opens the View Manager, as AutoCAD's does; its New View
  // dialog's Define window hands back to VIEW for the corners, then shows the dialogs again.
  it('VIEW and V open the View Manager and wait for it', async () => {
    const { bus, asked } = setup(() => ({ ok: true }));
    await bus.submit('VIEW');
    await bus.submit('V');
    expect(asked).toEqual([
      { op: 'file', action: 'views' },
      { op: 'file', action: 'views' },
    ]);
    expect(bus.command).toBeUndefined();
  });

  it("asks for the New View dialog's window at the command line and shows it again", async () => {
    let n = 0;
    // The dialog asks for a window twice (Esc at the second corner the second time), then closes.
    const { bus, asked } = setup((r) =>
      r.op === 'file' && n++ < 2 ? { ok: true, pickWindow: true } : { ok: true },
    );
    await bus.submit('VIEW');
    expect(bus.command).toBe('VIEW');
    expect(bus.prompt?.message).toBe('Specify first corner');
    await bus.submit('0,0');
    expect(bus.prompt?.message).toBe('Specify opposite corner');
    await bus.submit('40,20');
    expect(bus.prompt?.message).toBe('Specify first corner');
    await bus.submit('1,1');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(asked).toEqual([
      { op: 'file', action: 'views' },
      {
        op: 'file',
        action: 'views',
        resume: true,
        window: { a: { x: 0, y: 0 }, b: { x: 40, y: 20 } },
      },
      { op: 'file', action: 'views', resume: true },
    ]);
  });

  // Part 5: the View Manager's Edit Boundaries... hands VIEW the selected view's window.
  const BOUNDARY = { a: { x: 0, y: 0 }, b: { x: 40, y: 20 } };
  const editing = () => {
    let n = 0;
    const previews: (readonly unknown[])[] = [];
    const s = setup((r) =>
      r.op === 'file'
        ? n++ === 0
          ? { ok: true, pickWindow: true, boundary: BOUNDARY }
          : { ok: true }
        : { ok: true, view: VIEW },
    );
    s.bus.on((e) => (e.type === 'preview' ? previews.push(e.geometry) : undefined));
    return { ...s, previews };
  };
  const box = (a: { x: number; y: number }, b: { x: number; y: number }) => [
    {
      kind: 'LWPOLYLINE',
      closed: true,
      vertices: [
        { x: a.x, y: a.y, bulge: 0 },
        { x: b.x, y: a.y, bulge: 0 },
        { x: b.x, y: b.y, bulge: 0 },
        { x: a.x, y: b.y, bulge: 0 },
      ],
    },
  ];

  it('Edit Boundaries shows the view, takes windows until Enter and hands the last back', async () => {
    const { bus, asked, previews } = editing();
    await bus.submit('VIEW');
    // The view and a quarter of its size around it, fitted to the canvas (twice as wide as high),
    // its boundary drawn.
    expect(asked.slice(1, 3)).toEqual([
      { op: 'get' },
      { op: 'glance', view: { center: { x: 20, y: 10 }, height: 30 } },
    ]);
    expect(previews.at(-1)).toEqual(box({ x: 0, y: 0 }, { x: 40, y: 20 }));
    expect(bus.promptText).toBe('Specify first corner (or press ENTER to accept):');
    await bus.submit('5,5');
    expect(bus.prompt).toMatchObject({
      message: 'Specify opposite corner',
      rubberBand: { from: { x: 5, y: 5 }, box: true },
    });
    await bus.submit('30,15');
    // The new boundary is drawn and another may be picked.
    expect(previews.at(-1)).toEqual(box({ x: 5, y: 5 }, { x: 30, y: 15 }));
    expect(bus.promptText).toBe('Specify first corner (or press ENTER to accept):');
    await bus.submit('2,2');
    await bus.submit('35,18');
    await bus.submit('');
    expect(previews.at(-1)).toEqual([]);
    expect(asked.slice(3)).toEqual([
      // The display it was asked from comes back before the dialogs do.
      { op: 'glance', view: { center: VIEW.center, height: VIEW.height } },
      {
        op: 'file',
        action: 'views',
        resume: true,
        window: { a: { x: 2, y: 2 }, b: { x: 35, y: 18 } },
      },
    ]);
    expect(bus.command).toBeUndefined();
  });

  it('Edit Boundaries goes back to the dialog unchanged on Esc or an Enter before a window', async () => {
    for (const keys of [['ESC'], ['5,5', 'ESC'], ['']]) {
      const { bus, asked } = editing();
      await bus.submit('VIEW');
      for (const k of keys) await (k === 'ESC' ? bus.cancel() : bus.submit(k));
      expect(asked.slice(3)).toEqual([
        { op: 'glance', view: { center: VIEW.center, height: VIEW.height } },
        { op: 'file', action: 'views', resume: true },
      ]);
      expect(bus.command).toBeUndefined();
    }
  });

  it('Edit Boundaries keeps the display when the canvas cannot say what it shows', async () => {
    let n = 0;
    const { bus, asked } = setup((r) =>
      r.op === 'file'
        ? n++ === 0
          ? { ok: true, pickWindow: true, boundary: BOUNDARY }
          : { ok: true }
        : r.op === 'get'
          ? { ok: false, message: 'no canvas' }
          : { ok: true },
    );
    await bus.submit('VIEW');
    await bus.submit('');
    expect(asked).toEqual([
      { op: 'file', action: 'views' },
      { op: 'get' },
      { op: 'file', action: 'views', resume: true },
    ]);
    expect(bus.history).not.toContain('no canvas');
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

  it('saves a named view the navigation bar asks for as a VIEW undo step (M2-29)', async () => {
    const session = new EngineSession(sampleInit());
    const r = session.edit({ kind: 'view', name: 'Bar', view: VIEW });
    expect(r.ok).toBe(true);
    const added = r.ok ? (r.change.tables?.views?.added ?? []) : [];
    expect(added.map((v) => [v.name, v.center, v.height, v.width])).toEqual([
      ['Bar', VIEW.center, 40, 80],
    ]);
    expect(session.undoState.nextUndo).toBe('VIEW');
    expect(session.edit({ kind: 'view', name: 'a|b', view: VIEW })).toEqual({
      ok: false,
      message: 'Invalid view name.',
    });
  });

  // M2-47 part 2: the View Manager's Delete and its Name row.
  it('deletes and renames a named view, each a VIEW undo step', async () => {
    const session = new EngineSession(sampleInit());
    session.edit({ kind: 'view', name: 'Front', view: VIEW });
    session.edit({ kind: 'view', name: 'Back', view: { ...VIEW, paper: true } });
    const names = () => [...session.model.tables.views.values()].map((v) => v.name).sort();

    const renamed = session.edit({ kind: 'view-rename', name: 'front', newName: ' Elevation ' });
    expect(renamed.ok).toBe(true);
    expect(names()).toEqual(['Back', 'Elevation']);
    expect(session.undoState.nextUndo).toBe('VIEW');
    // Another case of its own name is a rename; another view's name and AutoCAD's bad
    // characters are refused, as is a view that is not there.
    expect(session.edit({ kind: 'view-rename', name: 'Elevation', newName: 'ELEVATION' }).ok).toBe(
      true,
    );
    // Its own name as it is changes nothing and adds no undo step.
    expect(session.edit({ kind: 'view-rename', name: 'elevation', newName: 'ELEVATION' })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.edit({ kind: 'view-rename', name: 'ELEVATION', newName: 'back' })).toEqual({
      ok: false,
      message: 'A view named "Back" already exists.',
    });
    expect(session.edit({ kind: 'view-rename', name: 'ELEVATION', newName: 'a|b' })).toEqual({
      ok: false,
      message: 'Invalid view name.',
    });
    expect(session.edit({ kind: 'view-delete', name: 'Side' })).toEqual({
      ok: false,
      message: 'Cannot find view "Side".',
    });

    const deleted = session.edit({ kind: 'view-delete', name: 'BACK' });
    expect(deleted.ok && deleted.change.tables?.views?.removed?.map((v) => v.name)).toEqual([
      'Back',
    ]);
    expect(names()).toEqual(['ELEVATION']);
    expect(session.undoState.nextUndo).toBe('VIEW');
    await session.command({ kind: 'submit', text: 'U' });
    expect(names()).toEqual(['Back', 'ELEVATION']);
  });
});
