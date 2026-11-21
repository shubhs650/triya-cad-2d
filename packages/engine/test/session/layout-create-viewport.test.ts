// M6-06: LAYOUTCREATEVIEWPORT and SHOWPAGESETUPFORNEWLAYOUTS (AutoCAD 2024 Help, both "Saved in:
// Registry"). A layout made since the drawing opened, with nothing on its sheet, gets a floating
// viewport the first time it is shown, as AutoCAD initializes a new layout: MVIEW Fit's viewport
// (the printable area) showing model space's extents, after the layout's own paper-space viewport;
// one undo step. With SHOWPAGESETUPFORNEWLAYOUTS on, the Page Setup Manager opens first.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  type CommandOutput,
  type DocumentInit,
  type ViewReply,
  type ViewRequest,
  type ViewportGeometry,
} from '../../src/index';
import { layoutSheet } from '../../src/layout/sheet';
import { MODEL_SPACE, blockRecord, sampleInit } from '../model/fixtures';

/** The sample with an empty layout it opened with, Layout2 on block 50. */
function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('50', '*Paper_Space0')],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: '50', name: '*Paper_Space0', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      ...(base.layouts ?? []),
      { handle: '2E', name: 'Layout2', tabOrder: 2, blockRecord: '50' },
    ],
  };
}

const EXTENTS = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

/**
 * A session whose app answers the two variables as `vars` says (absent: no app keeps them) and
 * model space's extents as the canvas measures them.
 */
function setup(vars?: { LAYOUTCREATEVIEWPORT?: number; SHOWPAGESETUPFORNEWLAYOUTS?: number }) {
  const s = new EngineSession(init());
  const asked: ViewRequest[] = [];
  const out: CommandOutput[] = [];
  s.onCommand((o) => {
    out.push(o);
    if (o.type !== 'view') return;
    asked.push(o.request);
    const r = o.request;
    let reply: ViewReply = { ok: true };
    if (r.op === 'sysvar') {
      const value = vars?.[r.name as keyof typeof vars];
      reply = vars
        ? { ok: true, ...(value !== undefined && { value }) }
        : { ok: false, message: 'No app.' };
    } else if (r.op === 'bounds') reply = { ok: true, box: EXTENTS };
    void s.command({ kind: 'view', id: o.id, reply });
  });
  return { s, asked, out };
}

async function newLayout(s: EngineSession, name: string): Promise<string> {
  await s.command({ kind: 'submit', text: 'LAYOUT' });
  await s.command({ kind: 'submit', text: 'N' });
  await s.command({ kind: 'submit', text: name });
  const layout = s.model.layouts.find((l) => l.name === name);
  if (!layout) throw new Error(`no layout ${name}`);
  return layout.blockRecord;
}

const viewports = (s: EngineSession, block: string): ViewportGeometry[] =>
  s.model
    .blockEntities(block)
    .map((id) => s.model.entity(id)!.geom)
    .filter((g): g is ViewportGeometry => g.kind === 'VIEWPORT');

const frameOf = (g: ViewportGeometry) => ({
  minX: g.center.x - g.width / 2,
  minY: g.center.y - g.height / 2,
  maxX: g.center.x + g.width / 2,
  maxY: g.center.y + g.height / 2,
});

describe('LAYOUTCREATEVIEWPORT', () => {
  it('gives a new layout a viewport filling its printable area the first time it is shown', async () => {
    const { s, asked } = setup({ LAYOUTCREATEVIEWPORT: 1, SHOWPAGESETUPFORNEWLAYOUTS: 0 });
    const block = await newLayout(s, 'Sheet A');
    // LAYOUT New makes no viewport: the layout has none until it is shown.
    expect(viewports(s, block)).toEqual([]);
    const undoable = s.undoState.undoable;

    await s.command({ kind: 'space', block });
    const [own, floating] = viewports(s, block);
    // The layout's own paper-space viewport first (DXF 69 = 1), then the floating one.
    expect(own?.id).toBe(1);
    expect(floating?.id).toBeGreaterThan(1);
    expect(viewports(s, block)).toHaveLength(2);
    const layout = s.model.layouts.find((l) => l.name === 'Sheet A')!;
    const printable = layoutSheet(layout)!.printable;
    expect(frameOf(floating!)).toEqual(printable);
    // Model space's extents, whole and centred, as MVIEW's viewports show them.
    expect(floating?.viewCenter).toEqual({ x: 50, y: 25 });
    const aspect = (printable.maxX - printable.minX) / (printable.maxY - printable.minY);
    expect(floating?.viewHeight).toBeCloseTo(Math.max(50, 100 / aspect));
    // On the current layer, as MVIEW's.
    const vp = s.model
      .blockEntities(block)
      .map((id) => s.model.entity(id)!)
      .find((e) => e.geom === floating);
    expect(s.model.tables.layers.get(vp!.layer)?.name).toBe('WALLS');
    // The variable was asked of the app; one undo step was made.
    expect(asked).toContainEqual({ op: 'sysvar', name: 'LAYOUTCREATEVIEWPORT' });
    expect(s.undoState).toMatchObject({ undoable: undoable + 1, nextUndo: 'LAYOUT' });
  });

  it('makes it once: a layout shown again, or its viewport undone, gets no other', async () => {
    const { s } = setup({ LAYOUTCREATEVIEWPORT: 1 });
    const block = await newLayout(s, 'Sheet A');
    await s.command({ kind: 'space', block });
    await s.command({ kind: 'space', block: MODEL_SPACE });
    await s.command({ kind: 'space', block });
    expect(viewports(s, block)).toHaveLength(2);

    await s.command({ kind: 'submit', text: 'U' });
    expect(viewports(s, block)).toEqual([]);
    await s.command({ kind: 'space', block: MODEL_SPACE });
    await s.command({ kind: 'space', block });
    expect(viewports(s, block)).toEqual([]);
  });

  it('makes none while LAYOUTCREATEVIEWPORT is 0', async () => {
    const { s } = setup({ LAYOUTCREATEVIEWPORT: 0 });
    const block = await newLayout(s, 'Sheet A');
    const undoable = s.undoState.undoable;
    await s.command({ kind: 'space', block });
    expect(viewports(s, block)).toEqual([]);
    expect(s.undoState.undoable).toBe(undoable);
  });

  it('takes AutoCAD’s initial values where no app keeps the variables', async () => {
    const { s, asked } = setup();
    const block = await newLayout(s, 'Sheet A');
    await s.command({ kind: 'space', block });
    expect(viewports(s, block)).toHaveLength(2);
    expect(asked.some((r) => r.op === 'file')).toBe(false);
  });

  it('leaves alone a layout the drawing opened with, empty or not', async () => {
    const { s } = setup({ LAYOUTCREATEVIEWPORT: 1 });
    await s.command({ kind: 'space', block: '50' });
    expect(viewports(s, '50')).toEqual([]);
    expect(s.undoState.undoable).toBe(0);
  });

  it('leaves alone a new layout with objects on its sheet before it is first shown', async () => {
    const { s } = setup({ LAYOUTCREATEVIEWPORT: 1 });
    // LAYOUT Copy copies Layout1's sheet (its line) into the new layout.
    await s.command({ kind: 'submit', text: 'LAYOUT' });
    await s.command({ kind: 'submit', text: 'C' });
    await s.command({ kind: 'submit', text: 'Layout1' });
    await s.command({ kind: 'submit', text: '' });
    const copy = s.model.layouts.find((l) => l.name === 'Layout1 (2)')!;
    expect(s.model.blockEntities(copy.blockRecord)).toHaveLength(1);
    await s.command({ kind: 'space', block: copy.blockRecord });
    expect(viewports(s, copy.blockRecord)).toEqual([]);
  });
});

describe('SHOWPAGESETUPFORNEWLAYOUTS', () => {
  it('opens the Page Setup Manager on a new layout first shown, then makes its viewport', async () => {
    const { s, asked } = setup({ LAYOUTCREATEVIEWPORT: 1, SHOWPAGESETUPFORNEWLAYOUTS: 1 });
    const block = await newLayout(s, 'Sheet A');
    asked.length = 0;
    await s.command({ kind: 'space', block });
    const dialog = asked.findIndex((r) => r.op === 'file' && r.action === 'pagesetup');
    const bounds = asked.findIndex((r) => r.op === 'bounds');
    expect(dialog).toBeGreaterThanOrEqual(0);
    // The viewport fits the sheet the page setup gives it, so it is made after the dialog.
    expect(bounds).toBeGreaterThan(dialog);
    expect(viewports(s, block)).toHaveLength(2);
  });

  it('opens it with LAYOUTCREATEVIEWPORT 0 too, and only for a new layout', async () => {
    const { s, asked } = setup({ LAYOUTCREATEVIEWPORT: 0, SHOWPAGESETUPFORNEWLAYOUTS: 1 });
    await s.command({ kind: 'space', block: '50' });
    expect(asked.some((r) => r.op === 'file')).toBe(false);
    const block = await newLayout(s, 'Sheet A');
    await s.command({ kind: 'space', block });
    expect(asked.filter((r) => r.op === 'file')).toEqual([{ op: 'file', action: 'pagesetup' }]);
    expect(viewports(s, block)).toEqual([]);
  });
});
