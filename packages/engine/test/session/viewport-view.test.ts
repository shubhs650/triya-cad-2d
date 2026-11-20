// M6-02 part 4: ZOOM, PAN and the wheel in a layout viewport made current change the viewport's
// own view (DXF 12 view centre, 45 view height), as AutoCAD's do; the frame stays put. Each is an
// undo step that UNDO Control Combine joins to the zooms and pans next to it (M2-47 part 4), and a
// display-locked viewport keeps its view (AutoCAD zooms paper space then, which the canvas does).
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  FLOATING_VIEWPORT_FLAGS,
  VIEWPORT_LOCKED,
  paperPointOf,
  viewportScale,
  viewportViewOf,
  withViewportView,
  type EntityGeometry,
  type ViewportGeometry,
} from '../../src/index';
import { LAYER_0, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 100, y: 100 },
  width: 40,
  height: 30,
  id: 2,
  status: 2,
  flags: FLOATING_VIEWPORT_FLAGS,
  viewCenter: { x: 0, y: 0 },
  viewHeight: 30,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...over,
});

const VP = '50';

function session(g: ViewportGeometry = viewport()) {
  const init = sampleInit();
  return new EngineSession({
    ...init,
    entities: [
      ...(init.entities ?? []),
      entityInit(VP, g as EntityGeometry, { owner: PAPER_SPACE, layer: LAYER_0 }),
    ],
  });
}

const geomOf = (s: EngineSession): ViewportGeometry => {
  const e = s.model.entity(s.model.ids.idOf(VP)!);
  if (e?.geom.kind !== 'VIEWPORT') throw new Error('no viewport');
  return e.geom;
};

describe("a current viewport's own view", () => {
  it('reads the model point at the middle of the frame and the view height', () => {
    // The target (17) is the display's origin: the view centre (12) is measured from it.
    const g = viewport({ viewTarget: { x: 10, y: 20, z: 0 }, viewCenter: { x: 5, y: -5 } });
    expect(viewportViewOf(g)).toEqual({ center: { x: 15, y: 15 }, height: 30 });
    const moved = withViewportView(g, { center: { x: 40, y: 50 }, height: 15 });
    // Model 40,50 shows at the frame's middle, at twice the scale; the target is kept.
    expect(moved.viewCenter).toEqual({ x: 30, y: 30 });
    expect(moved.viewTarget).toEqual(g.viewTarget);
    expect(paperPointOf(moved, { x: 40, y: 50 })).toEqual(g.center);
    expect(viewportScale(moved)).toBe(2);
    expect(viewportViewOf(moved)).toEqual({ center: { x: 40, y: 50 }, height: 15 });
  });

  it('changes the viewport, frame kept, as one ZOOM undo step U takes back', async () => {
    const s = session();
    const r = s.edit({
      kind: 'viewport-view',
      viewport: VP,
      view: { center: { x: 7, y: 3 }, height: 60 },
      label: 'ZOOM',
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.change.entities?.updated).toHaveLength(1);
    const g = geomOf(s);
    expect(viewportViewOf(g)).toEqual({ center: { x: 7, y: 3 }, height: 60 });
    expect([g.center, g.width, g.height]).toEqual([{ x: 100, y: 100 }, 40, 30]);
    expect(viewportScale(g)).toBe(0.5);
    expect(s.undoState.nextUndo).toBe('ZOOM');
    await s.command({ kind: 'submit', text: 'U' });
    expect(geomOf(s)).toEqual(viewport());
  });

  it('joins consecutive zooms and pans into one step (UNDO Control Combine)', async () => {
    const s = session();
    const to = (x: number, label: 'ZOOM' | 'PAN') =>
      s.edit({
        kind: 'viewport-view',
        viewport: VP,
        view: { center: { x, y: 0 }, height: 30 },
        label,
      });
    to(1, 'ZOOM');
    to(2, 'PAN');
    to(3, 'ZOOM');
    expect(s.undoState.undoable).toBe(1);
    expect(s.undoState.nextUndo).toBe('ZOOM');
    await s.command({ kind: 'submit', text: 'U' });
    expect(geomOf(s)).toEqual(viewport());
    expect(s.undoState.undoable).toBe(0);
  });

  it("keeps one wheel roll one step with Combine off ('join')", async () => {
    const s = session();
    await s.command({ kind: 'submit', text: 'UNDO' });
    await s.command({ kind: 'submit', text: 'C' });
    await s.command({ kind: 'submit', text: 'C' });
    await s.command({ kind: 'submit', text: 'N' });
    expect(s.undoState.undoable).toBe(0);
    const roll = (x: number, join: boolean) =>
      s.edit({
        kind: 'viewport-view',
        viewport: VP,
        view: { center: { x, y: 0 }, height: 30 },
        label: 'ZOOM',
        ...(join && { join }),
      });
    roll(1, false);
    roll(2, true);
    roll(3, true);
    expect(s.undoState.undoable).toBe(1);
    roll(4, false);
    expect(s.undoState.undoable).toBe(2);
    await s.command({ kind: 'submit', text: 'U' });
    expect(viewportViewOf(geomOf(s)).center.x).toBe(3);
  });

  it('refuses a locked viewport, one that is not workable and a view with no height', () => {
    const locked = session(viewport({ flags: FLOATING_VIEWPORT_FLAGS | VIEWPORT_LOCKED }));
    const view = { center: { x: 0, y: 0 }, height: 10 };
    const edit = { kind: 'viewport-view', viewport: VP, view, label: 'ZOOM' } as const;
    expect(locked.edit(edit)).toEqual({ ok: false, message: 'The viewport display is locked.' });
    const twisted = session(viewport({ twist: 0.5 }));
    expect(twisted.edit(edit)).toEqual({ ok: false, message: 'The viewport cannot be worked in.' });
    const s = session();
    expect(s.edit({ ...edit, view: { ...view, height: 0 } })).toEqual({
      ok: false,
      message: 'Invalid view.',
    });
    expect(s.edit({ ...edit, viewport: '24' })).toEqual({ ok: false, message: 'No viewport 24.' });
    expect(s.undoState.undoable).toBe(0);
  });

  it('leaves an unchanged view out of the history', () => {
    const s = session();
    const r = s.edit({
      kind: 'viewport-view',
      viewport: VP,
      view: viewportViewOf(viewport()),
      label: 'PAN',
    });
    expect(r).toEqual({ ok: true, change: {} });
    expect(s.undoState.undoable).toBe(0);
  });
});
