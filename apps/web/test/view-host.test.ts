// M2-02 part 2: the app's answers to the view commands, against a recording canvas, and the view
// maths they add (ZOOM n relative to the limits, real-time ZOOM's drag factor).
import type { MTextGeometry, TextGeometry, Vec2, ViewReply, ViewRequest } from '@triya/engine';
import type { ViewTransform } from '@triya/render';
import { describe, expect, it } from 'vitest';
import type { CanvasMode } from '../src/canvas/controller';
import { realtimeZoomFactor } from '../src/canvas/navigate';
import {
  NO_CANVAS,
  NO_CLIPBOARD,
  answerView,
  NO_FILE,
  stateOf,
  type NamedView,
  type ViewContext,
  type ViewTarget,
} from '../src/canvas/view-host';
import { limitsView } from '../src/canvas/views';

class Target implements ViewTarget {
  calls: string[] = [];
  view: ViewTransform | undefined = { center: { x: 10, y: 20 }, scale: 4 };
  size = { width: 800, height: 400 };
  mode: CanvasMode = 'none';
  previous = true;
  constructor(readonly isLayout = false) {}
  /** The view ZOOM Extents lands on once the renderer has measured (undefined: unchanged). */
  measured: ViewTransform | undefined;
  zoomExtents = async () => {
    this.calls.push('extents');
    await Promise.resolve();
    if (this.measured) this.view = this.measured;
  };
  zoomAll = async () => void this.calls.push('all');
  zoomPrevious = () => (this.calls.push('previous'), this.previous);
  zoomScale = (f: number) => void this.calls.push(`scale ${f}`);
  zoomLimits = (f: number) => void this.calls.push(`limits ${f}`);
  zoomWindow = (a: Vec2, b: Vec2) => void this.calls.push(`window ${a.x},${a.y} ${b.x},${b.y}`);
  zoomCenter = (c: Vec2, h: number) => void this.calls.push(`center ${c.x},${c.y} ${h}`);
  panWorld = (by: Vec2) => void this.calls.push(`pan ${by.x},${by.y}`);
  show = (v: ViewTransform) => void this.calls.push(`show ${v.center.x},${v.center.y} ${v.scale}`);
  setMode = (m: CanvasMode) => void this.calls.push(`mode ${m}`);
  regen = () => void this.calls.push('regen');
  pick = (p: Vec2) => (this.calls.push(`pick ${p.x},${p.y}`), Promise.resolve([7]));
  selectWindow = (a: Vec2, b: Vec2, crossing: boolean) => (
    this.calls.push(`select ${a.x},${a.y} ${b.x},${b.y}${crossing ? ' crossing' : ''}`),
    Promise.resolve([7, 8])
  );
  objectsKnown = true;
  zoomObjects = (ids: readonly number[]) => (
    this.calls.push(`objects ${ids.join(',')}`),
    Promise.resolve(this.objectsKnown)
  );
  textKnown = true;
  textBox = (t: MTextGeometry) => (
    this.calls.push(`text ${t.contents}`),
    Promise.resolve(this.textKnown ? { minX: 0, minY: 0, maxX: 2, maxY: 1 } : undefined)
  );
  textWidths = (texts: readonly MTextGeometry[]) => (
    this.calls.push(`widths ${texts.map((t) => t.contents).join(',')}`),
    Promise.resolve(texts.map((t) => (this.textKnown ? t.contents.length : null)))
  );
  columnCounts = (texts: readonly MTextGeometry[]) => (
    this.calls.push(`counts ${texts.map((t) => t.contents).join(',')}`),
    Promise.resolve(texts.map((t) => (this.textKnown ? t.contents.length : null)))
  );
  pickbox = 0.75;
  textOutlines = (texts: readonly (TextGeometry | MTextGeometry)[]) => (
    this.calls.push(`outlines ${texts.length}`),
    Promise.resolve(
      texts.map((t) =>
        this.textKnown
          ? { corners: [t.position, t.position, t.position, t.position], width: 2, below: 0.5 }
          : null,
      ),
    )
  );
  /** The first view, which a just-opened canvas shows once the renderer has measured it. */
  firstView: ViewTransform | undefined;
  whenViewed = () => {
    this.calls.push('when viewed');
    if (this.view) return Promise.resolve(true);
    if (this.firstView) this.view = this.firstView;
    return Promise.resolve(this.view !== undefined);
  };
  boundsOf = (ids: readonly number[]) => (
    this.calls.push(`bounds ${ids.join(',')}`),
    Promise.resolve(this.objectsKnown ? { minX: 1, minY: 2, maxX: 3, maxY: 4 } : undefined)
  );
}

/** The view requests answer at once; only selection's wait for the renderer. */
const now = (r: ViewReply | Promise<ViewReply>): ViewReply => {
  if (r instanceof Promise) throw new Error('expected an immediate reply');
  return r;
};

const VIEWS: NamedView[] = [
  { name: 'Front', inDrawing: true, view: { center: { x: 1, y: 2 }, scale: 3 } },
  { name: 'Iso', inDrawing: true, view: undefined },
];

function context(target: Target | undefined, others: Target[] = []) {
  const ctx: ViewContext = {
    target,
    all: () => [...(target ? [target] : []), ...others],
    views: () => VIEWS,
  };
  return { ctx };
}

describe('answerView', () => {
  it('hands the file commands to the app, with or without a canvas (M2-13)', async () => {
    const { ctx } = context(undefined);
    expect(await answerView({ op: 'file', action: 'qsave' }, ctx)).toEqual({
      ok: false,
      message: NO_FILE,
    });
    const asked: string[] = [];
    const file = (action: string) => {
      asked.push(action);
      return Promise.resolve({ ok: true as const, file: 'a.dxf' });
    };
    expect(await answerView({ op: 'file', action: 'saveas' }, { ...ctx, file })).toEqual({
      ok: true,
      file: 'a.dxf',
    });
    expect(asked).toEqual(['saveas']);
  });

  it('hands the Clipboard to the app, with or without a canvas (M2-14 part 2)', () => {
    const { ctx } = context(undefined);
    expect(now(answerView({ op: 'clipboard' }, ctx))).toEqual({ ok: false, message: NO_CLIPBOARD });
    const asked: unknown[] = [];
    const clipboard = (content: unknown): ViewReply => {
      asked.push(content);
      return { ok: true };
    };
    const content = {
      base: { x: 0, y: 0 },
      entities: [],
      blockEntities: [],
      tables: {},
      blocks: [],
    };
    expect(now(answerView({ op: 'clipboard', content }, { ...ctx, clipboard }))).toEqual({
      ok: true,
    });
    now(answerView({ op: 'clipboard' }, { ...ctx, clipboard }));
    expect(asked).toEqual([content, undefined]);
  });

  it("measures objects' extents with the renderer (M2-14 part 2, COPYCLIP)", async () => {
    const t = new Target();
    const { ctx } = context(t);
    expect(await answerView({ op: 'bounds', ids: [3, 4] }, ctx)).toEqual({
      ok: true,
      box: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    });
    t.objectsKnown = false;
    expect(await answerView({ op: 'bounds', ids: [3] }, ctx)).toEqual({
      ok: false,
      message: 'The objects have no extents.',
    });
    expect(t.calls).toEqual(['bounds 3,4', 'bounds 3']);
  });

  it('answers selection from the renderer (M2-03): picks, windows and ZOOM Object', async () => {
    const t = new Target();
    const { ctx } = context(t);
    expect(await answerView({ op: 'pick', point: { x: 1, y: 2 } }, ctx)).toEqual({
      ok: true,
      ids: [7],
    });
    expect(
      await answerView({ op: 'select', a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, crossing: true }, ctx),
    ).toEqual({ ok: true, ids: [7, 8] });
    expect(await answerView({ op: 'objects', ids: [7, 8] }, ctx)).toMatchObject({ ok: true });
    t.objectsKnown = false;
    expect(await answerView({ op: 'objects', ids: [9] }, ctx)).toEqual({
      ok: false,
      message: 'The objects have no extents.',
    });
    expect(t.calls).toEqual(['pick 1,2', 'select 0,0 5,5 crossing', 'objects 7,8', 'objects 9']);
  });

  it('measures text with the renderer (M2-09, MLEADEREDIT)', async () => {
    const t = new Target();
    const { ctx } = context(t);
    const text: MTextGeometry = {
      kind: 'MTEXT',
      contents: 'NOTE',
      style: '11',
      position: { x: 0, y: 0 },
      height: 1,
      width: 0,
      rotation: 0,
      attachment: 1,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    };
    expect(await answerView({ op: 'textBox', text }, ctx)).toEqual({
      ok: true,
      box: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    });
    t.textKnown = false;
    expect(await answerView({ op: 'textBox', text }, ctx)).toEqual({
      ok: false,
      message: 'The text cannot be measured.',
    });
    expect(t.calls).toEqual(['text NOTE', 'text NOTE']);
  });

  it('measures the widths of texts for dimension regeneration (M2-10 part 3)', async () => {
    const t = new Target(true);
    const ctx = context(t).ctx;
    const text: MTextGeometry = {
      kind: 'MTEXT',
      contents: '12.5',
      style: '11',
      position: { x: 0, y: 0 },
      height: 1,
      width: 0,
      rotation: 0,
      attachment: 5,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    };
    const texts = [text, { ...text, contents: 'R4' }];
    expect(await answerView({ op: 'textWidths', texts }, ctx)).toEqual({
      ok: true,
      widths: [4, 2],
    });
    t.textKnown = false;
    expect(await answerView({ op: 'textWidths', texts }, ctx)).toEqual({
      ok: true,
      widths: [null, null],
    });
    expect(t.calls).toEqual(['widths 12.5,R4', 'widths 12.5,R4']);
  });

  it('counts the dynamic columns of texts for column grips (M2-26 part 2)', async () => {
    const t = new Target(true);
    const ctx = context(t).ctx;
    const text: MTextGeometry = {
      kind: 'MTEXT',
      contents: 'one',
      style: '11',
      position: { x: 0, y: 0 },
      height: 1,
      width: 10,
      rotation: 0,
      attachment: 1,
      direction: 1,
      lineSpacingStyle: 1,
      lineSpacing: 1,
    };
    expect(await answerView({ op: 'columnCounts', texts: [text] }, ctx)).toEqual({
      ok: true,
      counts: [3],
    });
    t.textKnown = false;
    expect(await answerView({ op: 'columnCounts', texts: [text] }, ctx)).toEqual({
      ok: true,
      counts: [null],
    });
    expect(t.calls).toEqual(['counts one', 'counts one']);
  });

  it('answers where texts lie as drawn, with the pickbox in drawing units (M2-27)', async () => {
    const t = new Target();
    const { ctx } = context(t);
    const text = {
      kind: 'TEXT' as const,
      value: 'A',
      style: '11',
      position: { x: 1, y: 2 },
      height: 1,
      rotation: 0,
      widthFactor: 1,
      oblique: 0,
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: false,
    };
    const corners = [text.position, text.position, text.position, text.position];
    expect(await answerView({ op: 'textOutlines', texts: [text] }, ctx)).toEqual({
      ok: true,
      outlines: [{ corners, width: 2, below: 0.5 }],
      pickbox: 0.75,
    });
    t.textKnown = false;
    expect(await answerView({ op: 'textOutlines', texts: [text] }, ctx)).toEqual({
      ok: true,
      outlines: [null],
      pickbox: 0.75,
    });
    expect(t.calls).toEqual(['outlines 1', 'outlines 1']);
  });

  it('answers the view as VIEWSIZE and width, and whether paper space shows', () => {
    const t = new Target(true);
    expect(answerView({ op: 'get' }, context(t).ctx)).toEqual({
      ok: true,
      view: { center: { x: 10, y: 20 }, height: 100, width: 200, paper: true },
    });
  });

  it('refuses everything without a sized canvas', () => {
    expect(answerView({ op: 'extents' }, context(undefined).ctx)).toEqual({
      ok: false,
      message: NO_CANVAS,
    });
    const t = new Target();
    t.size = { width: 0, height: 0 };
    expect(now(answerView({ op: 'get' }, context(t).ctx)).ok).toBe(false);
  });

  it('waits for a just-opened canvas to show its first view (M2-35 part 2)', async () => {
    // ZOOM typed as the drawing opens reached the canvas before its first view, sized but not
    // yet measured, and failed "There is no view to change." (text-columns.spec.ts in CI).
    const t = new Target();
    t.view = undefined;
    t.firstView = { center: { x: 1, y: 2 }, scale: 4 };
    const r = answerView(
      { op: 'window', a: { x: 0, y: 0 }, b: { x: 160, y: 100 } },
      context(t).ctx,
    );
    expect(r).toBeInstanceOf(Promise);
    expect(await r).toMatchObject({ ok: true });
    expect(t.calls).toEqual(['when viewed', 'window 0,0 160,100']);
    // A canvas that never shows a view still refuses.
    const blank = new Target();
    blank.view = undefined;
    expect(await answerView({ op: 'extents' }, context(blank).ctx)).toEqual({
      ok: false,
      message: NO_CANVAS,
    });
    expect(blank.calls).toEqual(['when viewed']);
  });

  it("answers ZOOM Extents with the view it lands on after the renderer's measure (M2-37)", async () => {
    // Before the renderer first measured the drawing the canvas waits for it, so the reply
    // carries the view the zoom ended on, not the one it started from.
    const t = new Target();
    t.measured = { center: { x: 5, y: -7 }, scale: 2 };
    const r = answerView({ op: 'extents' }, context(t).ctx);
    expect(r).toBeInstanceOf(Promise);
    expect(await r).toEqual({
      ok: true,
      view: { center: { x: 5, y: -7 }, height: 200, width: 400, paper: false },
    });
  });

  it('calls the canvas as the navigation bar does', async () => {
    const t = new Target(true);
    const { ctx } = context(t);
    const requests: ViewRequest[] = [
      { op: 'extents' },
      { op: 'all' },
      { op: 'previous' },
      { op: 'scale', factor: 2, relativeTo: 'view' },
      { op: 'scale', factor: 3, relativeTo: 'limits' },
      { op: 'scale', factor: 4, relativeTo: 'paper' },
      { op: 'window', a: { x: 0, y: 0 }, b: { x: 5, y: 5 } },
      { op: 'center', center: { x: 1, y: 1 }, height: 9 },
      { op: 'pan', by: { x: 2, y: -1 } },
      { op: 'realtime', mode: 'zoom' },
      { op: 'realtime', mode: 'none' },
      { op: 'restore', name: 'front' },
    ];
    for (const r of requests) expect((await answerView(r, ctx)).ok).toBe(true);
    expect(t.calls).toEqual([
      'extents',
      'all',
      'previous',
      'scale 2',
      'limits 3',
      'limits 4',
      'window 0,0 5,5',
      'center 1,1 9',
      'pan 2,-1',
      'mode zoom',
      'mode none',
      'show 1,2 3',
    ]);
  });

  it('says when there is no previous view', () => {
    const t = new Target();
    t.previous = false;
    expect(answerView({ op: 'previous' }, context(t).ctx)).toEqual({
      ok: false,
      message: 'No previous view saved.',
    });
  });

  it('refuses nXP on the Model tab', () => {
    const t = new Target(false);
    const r = now(answerView({ op: 'scale', factor: 1, relativeTo: 'paper' }, context(t).ctx));
    expect(r.ok).toBe(false);
    expect(t.calls).toEqual([]);
  });

  it('REGEN regenerates the current viewport, REGENALL every one', () => {
    const t = new Target();
    const other = new Target();
    const { ctx } = context(t, [other]);
    answerView({ op: 'regen', all: false }, ctx);
    expect([t.calls, other.calls]).toEqual([['regen'], []]);
    answerView({ op: 'regen', all: true }, ctx);
    expect([t.calls, other.calls]).toEqual([['regen', 'regen'], ['regen']]);
  });

  it('lists and restores named views, and tells the view VIEW Save keeps (M2-29)', () => {
    const t = new Target();
    const { ctx } = context(t);
    expect(answerView({ op: 'views' }, ctx)).toEqual({
      ok: true,
      views: [
        { name: 'Front', inDrawing: true, restorable: true },
        { name: 'Iso', inDrawing: true, restorable: false },
      ],
    });
    expect(answerView({ op: 'restore', name: 'Back' }, ctx)).toEqual({
      ok: false,
      message: 'Cannot find view "Back".',
    });
    expect(now(answerView({ op: 'restore', name: 'ISO' }, ctx)).ok).toBe(false);
    expect(t.calls).toEqual([]);
    expect(now(answerView({ op: 'get' }, ctx))).toEqual({ ok: true, view: stateOf(t) });
  });
});

describe('limitsView (ZOOM n)', () => {
  const limits = { minX: 0, minY: 0, maxX: 420, maxY: 297 };
  const size = { width: 840, height: 594 };
  it('1 fits the limits, 2 shows half as much, about the current centre', () => {
    const current = { center: { x: 5, y: 5 }, scale: 1 };
    expect(limitsView(limits, size, 1, current)).toEqual({ center: { x: 5, y: 5 }, scale: 2 });
    expect(limitsView(limits, size, 2, current)?.scale).toBe(4);
    expect(limitsView(limits, size, 1, undefined)?.center).toEqual({ x: 210, y: 148.5 });
  });
  it('needs limits and a positive factor', () => {
    expect(limitsView(undefined, size, 1, undefined)).toBeUndefined();
    expect(limitsView(limits, size, 0, undefined)).toBeUndefined();
  });
});

describe('realtimeZoomFactor', () => {
  it('zooms in 2x dragging half the window up, out 2x down', () => {
    expect(realtimeZoomFactor(-200, 400)).toBe(2);
    expect(realtimeZoomFactor(200, 400)).toBe(0.5);
    expect(realtimeZoomFactor(0, 400)).toBe(1);
    expect(realtimeZoomFactor(10, 0)).toBe(1);
  });
});
