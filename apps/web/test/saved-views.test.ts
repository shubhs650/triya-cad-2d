// M2-29: the drawing's named views as its engine has them (VIEW Save writes the VIEW table), and
// the view each Model tile shows written into its `*Active` VPORT when the drawing is saved.
import type { ChangeSet, DocumentInit, ViewRecord, VportRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { drawingViews, shownPaperViews, shownViewsChange } from '../src/saved-views';

const view = (handle: string, name: string, flags?: number): ViewRecord =>
  ({
    handle,
    name,
    ...(flags !== undefined && { flags }),
    center: { x: 0, y: 0 },
    height: 10,
    width: 10,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    twist: 0,
  }) as ViewRecord;

/** A drawing as opened holding only `tables`. */
const opened = (tables: DocumentInit['tables']): DocumentInit =>
  ({ meta: {}, handSeed: '1000', tables }) as unknown as DocumentInit;

const vport = (handle: string, lowerLeft = { x: 0, y: 0 }, upperRight = { x: 1, y: 1 }) =>
  ({
    handle,
    name: '*Active',
    lowerLeft,
    upperRight,
    center: { x: 0, y: 0 },
    height: 10,
    aspectRatio: 1,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    twist: 0,
  }) as VportRecord;

describe('drawingViews', () => {
  const init = opened({ views: [view('A', 'Front'), view('B', 'Sheet', 1)] });

  it('replays the change log onto the views the drawing opened with', () => {
    const changes: ChangeSet[] = [
      { tables: { views: { added: [view('C', 'Detail')] } } },
      { tables: { views: { removed: [view('A', 'Front')] } } },
      {
        tables: {
          views: { updated: [{ before: view('C', 'Detail'), after: view('C', 'Detail 2') }] },
        },
      },
    ];
    expect(drawingViews(init, changes).map((v) => v.name)).toEqual(['Sheet', 'Detail 2']);
    expect(drawingViews(init, []).map((v) => v.name)).toEqual(['Front', 'Sheet']);
    expect(drawingViews(opened(undefined), [])).toEqual([]);
  });
});

describe('shownViewsChange', () => {
  const shown = (cx: number) => ({
    view: { center: { x: cx, y: 0 }, scale: 2 },
    size: { width: 200, height: 100 },
  });

  it('writes the view each Model tile shows into its *Active VPORT', () => {
    const left = vport('29', { x: 0, y: 0 }, { x: 0.5, y: 1 });
    const right = vport('2A', { x: 0.5, y: 0 }, { x: 1, y: 1 });
    const init = opened({ vports: [left, right] });
    const cs = shownViewsChange(
      init,
      [],
      new Map([
        [0, shown(10)],
        [1, shown(20)],
      ]),
    );
    expect(
      cs.tables?.vports?.updated?.map(({ after: v }) => [
        v.handle,
        v.center.x,
        v.height,
        v.aspectRatio,
      ]),
    ).toEqual([
      ['29', 10, 50, 2],
      ['2A', 20, 50, 2],
    ]);
  });

  it('starts from the VPORT as the session left it, and writes nothing without one', () => {
    const a = vport('29');
    const moved = { ...a, height: 7 };
    const init = opened({ vports: [a] });
    const log: ChangeSet[] = [{ tables: { vports: { updated: [{ before: a, after: moved }] } } }];
    const cs = shownViewsChange(init, log, new Map([[0, shown(10)]]));
    expect(cs.tables?.vports?.updated?.[0]?.before).toEqual(moved);
    // A Model tab never shown, or a drawing without an *Active VPORT (R1–R2.5).
    expect(shownViewsChange(init, [], new Map())).toEqual({});
    expect(shownViewsChange(opened(undefined), [], new Map([[0, shown(1)]]))).toEqual({});
  });

  it('writes nothing for a canvas with no view or size yet', () => {
    const init = opened({ vports: [vport('29')] });
    expect(
      shownViewsChange(
        init,
        [],
        new Map([[0, { view: undefined, size: { width: 1, height: 1 } }]]),
      ),
    ).toEqual({});
    expect(
      shownViewsChange(
        init,
        [],
        new Map([
          [0, { view: { center: { x: 0, y: 0 }, scale: 1 }, size: { width: 0, height: 0 } }],
        ]),
      ),
    ).toEqual({});
  });
});

describe('shownPaperViews (M2-47 part 1)', () => {
  const size = { width: 800, height: 400 };
  const view = { center: { x: 200, y: 150 }, scale: 4 };

  it('takes the window each layout canvas shows, in paper units', () => {
    expect(
      shownPaperViews([
        { block: '1B', isLayout: true, view, size },
        // Model space is saved into its *Active VPORT instead.
        { block: '1F', isLayout: false, view, size },
      ]),
    ).toEqual([{ block: '1B', view: { center: { x: 200, y: 150 }, width: 200, height: 100 } }]);
  });

  it('leaves out a layout not yet drawn, or on a canvas with no size', () => {
    expect(
      shownPaperViews([
        { block: '1B', isLayout: true, view: undefined, size },
        { block: '1C', isLayout: true, view, size: { width: 0, height: 400 } },
        { block: '1D', isLayout: true, view: { ...view, scale: 0 }, size },
      ]),
    ).toEqual([]);
  });
});
