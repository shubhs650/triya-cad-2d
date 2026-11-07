// M1-97: layout edits in the engine session (LAYOUT Rename, dragging a layout tab and PAGESETUP
// will be their front ends, M6). The session builds the layout change set the app's tabs and
// the renderers' sheets follow, and refuses what AutoCAD refuses.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  invertChangeSet,
  type ChangeSet,
  type DocumentInit,
  type LayoutPlot,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, blockRecord, sampleInit } from '../model/fixtures';

const PLOT: LayoutPlot = {
  paperSize: 'ISO_A4_(297.00_x_210.00_MM)',
  paperWidth: 297,
  paperHeight: 210,
  margins: { left: 5, bottom: 5, right: 5, top: 5 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 0,
};

/** The sample with three layouts: Layout1 (1E), Layout2 (2E) and Layout3 (3E). */
function init(): DocumentInit {
  const base = sampleInit();
  const extra = ['2E', '3E'].map((h, i) => ({ handle: h, record: `${i + 5}0` }));
  return {
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        ...extra.map((x, i) => blockRecord(x.record, `*Paper_Space${i}`)),
      ],
    },
    blocks: [
      ...(base.blocks ?? []),
      ...extra.map((x, i) => ({
        handle: x.record,
        name: `*Paper_Space${i}`,
        basePoint: { x: 0, y: 0 },
      })),
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE },
      { handle: '1E', name: 'Layout1', tabOrder: 1, blockRecord: PAPER_SPACE, plot: PLOT },
      ...extra.map((x, i) => ({
        handle: x.handle,
        name: `Layout${i + 2}`,
        tabOrder: i + 2,
        blockRecord: x.record,
      })),
    ],
  };
}

const tabs = (m: DocumentModel) => m.layouts.map((l) => `${l.tabOrder}:${l.name}`);

describe('layout edits', () => {
  it('renames a layout', () => {
    const s = new EngineSession(init());
    const r = s.edit({ kind: 'layout', layout: '2E', name: 'Plan' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.change.layouts?.map((u) => [u.before.name, u.after.name])).toEqual([
      ['Layout2', 'Plan'],
    ]);
    expect(tabs(s.model)).toEqual(['0:Model', '1:Layout1', '2:Plan', '3:Layout3']);
  });

  it('moves a layout tab, renumbering the tabs between', () => {
    const s = new EngineSession(init());
    const r = s.edit({ kind: 'layout', layout: '3E', tabOrder: 1 });
    expect(r.ok).toBe(true);
    expect(tabs(s.model)).toEqual(['0:Model', '1:Layout3', '2:Layout1', '3:Layout2']);
    if (r.ok) expect(r.change.layouts).toHaveLength(3);
    // Past the end goes last, as dropping a tab after the last one.
    s.edit({ kind: 'layout', layout: '3E', tabOrder: 99 });
    expect(tabs(s.model)).toEqual(['0:Model', '1:Layout1', '2:Layout2', '3:Layout3']);
  });

  it('numbers the tabs 1 to N when the drawing had gaps', () => {
    const base = init();
    const s = new EngineSession({
      ...base,
      layouts: base.layouts!.map((l) => (l.tabOrder ? { ...l, tabOrder: l.tabOrder * 2 } : l)),
    });
    s.edit({ kind: 'layout', layout: '1E', tabOrder: 2 });
    expect(tabs(s.model)).toEqual(['0:Model', '1:Layout2', '2:Layout1', '3:Layout3']);
  });

  it('gives a layout a new page setup', () => {
    const s = new EngineSession(init());
    const plot = { ...PLOT, rotation: 1 as const, paperSize: 'ISO_A3_(420.00_x_297.00_MM)' };
    const r = s.edit({ kind: 'layout', layout: '1E', plot });
    expect(r.ok).toBe(true);
    expect(s.model.layouts[1]?.plot).toEqual(plot);
  });

  it('is undone by its inverse change set, which a replica applies too', () => {
    const s = new EngineSession(init());
    const replica = DocumentModel.create(init());
    const r = s.edit({ kind: 'layout', layout: '3E', name: 'Detail', tabOrder: 1 });
    if (!r.ok) throw new Error(r.message);
    // What crosses to a worker is a copy, so the replica swaps in its own layouts, as the
    // render session does.
    const rebased = (cs: ChangeSet): ChangeSet => ({
      layouts: (JSON.parse(JSON.stringify(cs)) as ChangeSet).layouts!.map((u) => ({
        before: replica.layouts.find((l) => l.handle === u.before.handle)!,
        after: u.after,
      })),
    });
    replica.apply(rebased(r.change));
    expect(tabs(replica)).toEqual(['0:Model', '1:Detail', '2:Layout1', '3:Layout2']);
    const undo = invertChangeSet(r.change);
    s.model.apply(undo);
    replica.apply(rebased(undo));
    expect(tabs(s.model)).toEqual(['0:Model', '1:Layout1', '2:Layout2', '3:Layout3']);
    expect(tabs(replica)).toEqual(tabs(s.model));
  });

  it('changes nothing for a no-op edit', () => {
    const s = new EngineSession(init());
    expect(s.edit({ kind: 'layout', layout: '2E', name: 'Layout2', tabOrder: 2 })).toEqual({
      ok: true,
      change: {},
    });
    // A case-only rename is a rename.
    expect(s.edit({ kind: 'layout', layout: '2E', name: 'LAYOUT2' }).ok).toBe(true);
    expect(s.model.layouts[2]?.name).toBe('LAYOUT2');
  });

  it('refuses what AutoCAD refuses', () => {
    const s = new EngineSession(init());
    const refused = (e: Parameters<EngineSession['edit']>[0]) => {
      const r = s.edit(e);
      return r.ok ? 'accepted' : r.message;
    };
    expect(refused({ kind: 'layout', layout: 'FFFF', name: 'X' })).toBe('No layout FFFF.');
    expect(refused({ kind: 'layout', layout: '22', name: 'Sheet' })).toBe(
      'The Model tab cannot be renamed or moved.',
    );
    expect(refused({ kind: 'layout', layout: '22', tabOrder: 2 })).toBe(
      'The Model tab cannot be renamed or moved.',
    );
    expect(refused({ kind: 'layout', layout: '2E', name: 'layout1' })).toBe(
      'A layout named "layout1" already exists.',
    );
    expect(refused({ kind: 'layout', layout: '2E', name: 'model' })).toBe(
      'A layout named "model" already exists.',
    );
    expect(refused({ kind: 'layout', layout: '2E', name: '' })).toBe('Invalid layout name.');
    expect(refused({ kind: 'layout', layout: '2E', name: 'A/B' })).toBe('Invalid layout name.');
    expect(refused({ kind: 'layout', layout: '2E', name: 'x'.repeat(256) })).toBe(
      'Invalid layout name.',
    );
    expect(refused({ kind: 'layout', layout: '2E', tabOrder: 1.5 })).toBe(
      'Invalid tab position 1.5.',
    );
    expect(refused({ kind: 'layout', layout: '1E', plot: { ...PLOT, paperWidth: 0 } })).toBe(
      'Invalid page setup: the paper size must be greater than 0.',
    );
    expect(
      refused({
        kind: 'layout',
        layout: '1E',
        plot: { ...PLOT, margins: { ...PLOT.margins, left: -1 } },
      }),
    ).toBe('Invalid page setup: margins cannot be negative.');
    expect(
      refused({
        kind: 'layout',
        layout: '1E',
        plot: { ...PLOT, margins: { ...PLOT.margins, left: 150, right: 150 } },
      }),
    ).toBe('Invalid page setup: the margins leave no printable area.');
    expect(
      refused({
        kind: 'layout',
        layout: '1E',
        plot: { ...PLOT, scale: { numerator: 1, denominator: 0 } },
      }),
    ).toBe('Invalid page setup: the plot scale must be greater than 0.');
    expect(tabs(s.model)).toEqual(['0:Model', '1:Layout1', '2:Layout2', '3:Layout3']);
  });
});
