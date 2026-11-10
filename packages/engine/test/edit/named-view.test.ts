// M2-29: named views and the current view kept in the drawing. VIEW Save writes a VIEW record
// (an undo step, so it is in the change log the app saves), and the save writes the view each
// model-space tile shows into its `*Active` VPORT, as AutoCAD saves both.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  activeViewsChange,
  saveNamedView,
  type VportRecord,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const PLAN = { center: { x: 50, y: 25 }, height: 40, width: 80, paper: false };

describe('saveNamedView', () => {
  it('adds a plan view of the window with AutoCAD’s defaults', () => {
    const model = DocumentModel.create(sampleInit());
    const b = new ChangeSetBuilder(model);
    const v = saveNamedView(b, model, 'Plan 2', PLAN);
    model.apply(b.build());
    expect(model.tables.views.get(v.handle)).toEqual({
      handle: v.handle,
      name: 'Plan 2',
      center: { x: 50, y: 25 },
      height: 40,
      width: 80,
      direction: { x: 0, y: 0, z: 1 },
      target: { x: 0, y: 0, z: 0 },
      lensLength: 50,
      frontClip: 0,
      backClip: 0,
      twist: 0,
      viewMode: 0,
      renderMode: 0,
    });
    // Above the seed: handles are never renumbered.
    expect(Number.parseInt(v.handle, 16)).toBeGreaterThanOrEqual(
      Number.parseInt(sampleInit().handSeed, 16),
    );
  });

  it('marks a paper-space view and replaces a view of the same name in place', () => {
    const model = DocumentModel.create(sampleInit());
    let b = new ChangeSetBuilder(model);
    const first = saveNamedView(b, model, 'Sheet', PLAN);
    model.apply(b.build());
    b = new ChangeSetBuilder(model);
    const again = saveNamedView(b, model, 'SHEET', {
      ...PLAN,
      center: { x: 1, y: 2 },
      paper: true,
    });
    const cs = b.build();
    model.apply(cs);
    expect(again.handle).toBe(first.handle);
    expect(cs.tables?.views?.updated).toHaveLength(1);
    expect(model.tables.views.size).toBe(1);
    const v = model.tables.views.get(first.handle)!;
    // The name keeps its spelling; the flag says paper space.
    expect([v.name, v.flags, v.center]).toEqual(['Sheet', 1, { x: 1, y: 2 }]);
  });
});

describe('activeViewsChange', () => {
  const vport = (o: Partial<VportRecord>): VportRecord =>
    ({
      handle: '29',
      name: '*Active',
      center: { x: 0, y: 0 },
      height: 10,
      aspectRatio: 1,
      direction: { x: 0, y: 0, z: 1 },
      target: { x: 0, y: 0, z: 0 },
      twist: 0,
      ...o,
    }) as VportRecord;

  it('writes each tile’s view into its VPORT, centre in display coordinates', () => {
    const a = vport({});
    const b = vport({ handle: '2A', target: { x: 5, y: 5, z: 0 } });
    const cs = activeViewsChange([
      { vport: a, view: { center: { x: 50, y: 25 }, height: 40, width: 80 } },
      { vport: b, view: { center: { x: 10, y: 10 }, height: 4, width: 2 } },
    ]);
    expect(cs.tables?.vports?.updated?.map((u) => u.before)).toEqual([a, b]);
    expect(
      cs.tables?.vports?.updated?.map(({ after: v }) => [v.center, v.height, v.aspectRatio]),
    ).toEqual([
      [{ x: 50, y: 25 }, 40, 2],
      [{ x: 5, y: 5 }, 4, 0.5],
    ]);
  });

  it('leaves a VPORT showing the view already, and a 3D or twisted one, as read', () => {
    const same = vport({ center: { x: 50, y: 25 }, height: 40, aspectRatio: 2 });
    const iso = vport({ handle: '2B', direction: { x: 1, y: -1, z: 1 } });
    const twisted = vport({ handle: '2C', twist: 0.5 });
    const view = { center: { x: 50, y: 25 }, height: 40, width: 80 };
    expect(activeViewsChange([same, iso, twisted].map((v) => ({ vport: v, view })))).toEqual({});
    // A view with no size (a canvas not laid out yet) is not written.
    expect(activeViewsChange([{ vport: vport({}), view: { ...view, height: 0 } }])).toEqual({});
  });
});
