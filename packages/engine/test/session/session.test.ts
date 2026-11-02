// M1-67: the engine session, the authoritative document an engine worker holds. It applies the
// app's edits and returns their ChangeSets, which every render replica of the drawing applies
// in turn; the replica must stay in step, edit after edit.
import { describe, expect, it } from 'vitest';
import { DocumentModel, EngineSession, SpatialIndex, toleranceForSize } from '../../src/index';
import { LAYER_0, LAYER_WALLS, sampleInit, snapshot } from '../model/fixtures';

describe('EngineSession', () => {
  it('turns a layer off and on, returning the change for the replicas', () => {
    const s = new EngineSession(sampleInit());
    const off = s.edit({ kind: 'layer', layer: LAYER_0, on: false });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(s.model.tables.layers.get(LAYER_0)?.on).toBe(false);
    const [u] = off.change.tables?.layers?.updated ?? [];
    expect([u?.before.on, u?.after.on]).toEqual([true, false]);
    const on = s.edit({ kind: 'layer', layer: LAYER_0, on: true });
    expect(on.ok && s.model.tables.layers.get(LAYER_0)?.on).toBe(true);
  });

  it('keeps a render replica in step', () => {
    const s = new EngineSession(sampleInit());
    const replica = DocumentModel.create(sampleInit());
    const index = SpatialIndex.build(replica, { tol: toleranceForSize(100) });
    for (const e of [
      { kind: 'layer', layer: LAYER_0, locked: true },
      { kind: 'layer', layer: LAYER_0, frozen: true },
      { kind: 'layer', layer: LAYER_0, frozen: false, on: false },
    ] as const) {
      const r = s.edit(e);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      // What crosses to a worker is a copy (a structured clone), as the render session gets it.
      const cs = JSON.parse(JSON.stringify(r.change)) as typeof r.change;
      const own = replica.tables.layers.get(e.layer)!;
      const rebased = {
        tables: {
          layers: { updated: cs.tables!.layers!.updated!.map((x) => ({ ...x, before: own })) },
        },
      };
      replica.apply(rebased);
      index.apply(rebased);
    }
    expect(snapshot(replica)).toEqual(snapshot(s.model));
  });

  it('refuses to freeze the current layer, as AutoCAD does', () => {
    // $CLAYER is WALLS in the sample. AutoCAD: "Cannot freeze the current layer."
    const s = new EngineSession(sampleInit());
    const r = s.edit({ kind: 'layer', layer: LAYER_WALLS, frozen: true });
    expect(r).toEqual({ ok: false, message: 'Cannot freeze the current layer.' });
    expect(s.model.tables.layers.get(LAYER_WALLS)?.frozen).toBe(false);
    // Turning it off is allowed (AutoCAD only warns).
    expect(s.edit({ kind: 'layer', layer: LAYER_WALLS, on: false }).ok).toBe(true);
  });

  it('refuses an unknown layer and changes nothing for a no-op edit', () => {
    const s = new EngineSession(sampleInit());
    expect(s.edit({ kind: 'layer', layer: 'FFFF', on: false })).toEqual({
      ok: false,
      message: 'No layer FFFF.',
    });
    const same = s.edit({ kind: 'layer', layer: LAYER_0, on: true });
    expect(same).toEqual({ ok: true, change: {} });
  });
});
