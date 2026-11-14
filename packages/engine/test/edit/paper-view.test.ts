// M2-47 part 1: a save writes the view each layout shows into its paper-space viewport (DXF 69
// id 1), as AutoCAD does, so a layout reopens where it was left; a layout shown for the first
// time gets one, as AutoCAD makes it the first time a layout is shown.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PAPER_VIEWPORT_FLAGS,
  paperViewsChange,
  type DocumentInit,
  type ViewportGeometry,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const VIEW = { center: { x: 150, y: 100 }, height: 60, width: 90 };

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 0, y: 0 },
  width: 420,
  height: 297,
  id: 1,
  status: 1,
  flags: 819232,
  viewCenter: { x: 210, y: 148.5 },
  viewHeight: 297,
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

function withViewports(...vps: [string, ViewportGeometry][]): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    entities: [
      ...(init.entities ?? []),
      ...vps.map(([h, g]) => entityInit(h, g, { owner: PAPER_SPACE, layer: LAYER_WALLS })),
    ],
  };
}

describe('paperViewsChange', () => {
  it('writes the view into the layout’s paper-space viewport, frame and view alike', () => {
    const model = DocumentModel.create(withViewports(['30', viewport()]));
    const cs = paperViewsChange(model, [{ block: PAPER_SPACE, view: VIEW }]);
    expect(cs.entities?.added ?? []).toEqual([]);
    const [u] = cs.entities!.updated!;
    expect(u!.before.handle).toBe('30');
    const g = u!.after.geom as ViewportGeometry;
    // AutoCAD's own paper-space viewports hold the window twice: 10/40/41 and 12/45.
    expect(g.center).toEqual({ x: 150, y: 100 });
    expect(g.viewCenter).toEqual({ x: 150, y: 100 });
    expect(g.width).toBe(90);
    expect(g.height).toBe(60);
    expect(g.viewHeight).toBe(60);
    // Everything else is kept as read.
    expect(g.flags).toBe(819232);
    expect(u!.after.layer).toBe(LAYER_WALLS);
    // Not applied: the save writes it, the drawing is not edited by looking around.
    expect((model.entity(u!.before.id)!.geom as ViewportGeometry).viewHeight).toBe(297);
  });

  it('leaves a viewport alone that already shows the view, and views with no size', () => {
    const model = DocumentModel.create(
      withViewports([
        '30',
        viewport({
          center: VIEW.center,
          viewCenter: VIEW.center,
          width: 90,
          height: 60,
          viewHeight: 60,
        }),
      ]),
    );
    expect(paperViewsChange(model, [{ block: PAPER_SPACE, view: VIEW }])).toEqual({});
    const fresh = DocumentModel.create(withViewports(['30', viewport()]));
    for (const bad of [
      { ...VIEW, height: 0 },
      { ...VIEW, width: -1 },
      { ...VIEW, center: { x: Number.NaN, y: 0 } },
    ]) {
      expect(paperViewsChange(fresh, [{ block: PAPER_SPACE, view: bad }])).toEqual({});
    }
  });

  it('takes the viewport with id 1, not the layout’s other viewports', () => {
    const model = DocumentModel.create(
      withViewports(['30', viewport({ id: 2, center: { x: 50, y: 50 } })], ['31', viewport()]),
    );
    const cs = paperViewsChange(model, [{ block: PAPER_SPACE, view: VIEW }]);
    expect(cs.entities!.updated!.map((u) => u.before.handle)).toEqual(['31']);
  });

  it('gives a layout shown for the first time its paper-space viewport, above the seed', () => {
    const model = DocumentModel.create(sampleInit());
    const cs = paperViewsChange(model, [{ block: PAPER_SPACE, view: VIEW }]);
    const e = cs.entities!.added![0]!.entity;
    expect(e.owner).toBe(PAPER_SPACE);
    expect(Number.parseInt(e.handle, 16)).toBeGreaterThanOrEqual(
      Number.parseInt(sampleInit().handSeed, 16),
    );
    // On layer 0, as AutoCAD makes it; on, with the paper space layout current.
    expect(model.tables.layers.get(e.layer)!.name).toBe('0');
    expect(e.geom).toEqual({
      kind: 'VIEWPORT',
      center: { x: 150, y: 100 },
      width: 90,
      height: 60,
      id: 1,
      status: 1,
      flags: PAPER_VIEWPORT_FLAGS,
      viewCenter: { x: 150, y: 100 },
      viewHeight: 60,
      viewDirection: { x: 0, y: 0, z: 1 },
      viewTarget: { x: 0, y: 0, z: 0 },
      twist: 0,
      lensLength: 50,
      frontClip: 0,
      backClip: 0,
      frozenLayers: [],
      plotStyleSheet: '',
      renderMode: 0,
    });
    // The handle is the drawing's from now on: a second save takes another.
    const again = paperViewsChange(model, [{ block: PAPER_SPACE, view: VIEW }]);
    expect(again.entities!.added![0]!.entity.handle).not.toBe(e.handle);
  });

  it('makes a layout that is not current a viewport that is off until it is', () => {
    const init = sampleInit();
    const model = DocumentModel.create({
      ...init,
      tables: {
        ...init.tables,
        blockRecords: [
          ...(init.tables?.blockRecords ?? []),
          { handle: '50', name: '*Paper_Space0', units: 0, explodable: true, scalable: true },
        ],
      },
      blocks: [
        ...(init.blocks ?? []),
        { handle: '50', name: '*Paper_Space0', basePoint: { x: 0, y: 0 } },
      ],
      layouts: [
        ...(init.layouts ?? []),
        { handle: '51', name: 'Layout2', tabOrder: 2, blockRecord: '50' },
      ],
    });
    const cs = paperViewsChange(model, [{ block: '50', view: VIEW }]);
    // DXF 68 is 0 in a layout that is not current (AutoCAD DXF reference, VIEWPORT).
    expect((cs.entities!.added![0]!.entity.geom as ViewportGeometry).status).toBe(0);
  });

  it('adds none where the layout already has floating viewports but none with id 1', () => {
    // Written by another program: which of them AutoCAD would take as the sheet is unclear, so
    // the save leaves the layout as read rather than add a second whole-sheet viewport.
    const model = DocumentModel.create(withViewports(['30', viewport({ id: 2 })]));
    expect(paperViewsChange(model, [{ block: PAPER_SPACE, view: VIEW }])).toEqual({});
  });

  it('ignores model space and blocks that are no layout', () => {
    const model = DocumentModel.create(sampleInit());
    expect(paperViewsChange(model, [{ block: MODEL_SPACE, view: VIEW }])).toEqual({});
    expect(paperViewsChange(model, [{ block: 'FFFF', view: VIEW }])).toEqual({});
  });
});
