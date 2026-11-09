// applyToReplica (M2-13): a change set the engine applied, cloned as postMessage clones it, applies
// to a replica built from the same init, which then holds what the engine holds.
import { describe, expect, it } from 'vitest';
import { ChangeSetBuilder, DocumentModel, applyToReplica } from '../../src/model/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  circleGeom,
  lineGeom,
  sampleInit,
  snapshot,
} from './fixtures';

// Engine tests compile without DOM or Node types; Node has structuredClone at runtime.
declare function structuredClone<T>(value: T): T;

/** The engine's three edits: add two entities, change one, remove one, and a header change. */
function engineEdits(engine: DocumentModel) {
  const out = [];
  let b = new ChangeSetBuilder(engine);
  const c = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: circleGeom(0, 0, 3) });
  b.addEntity({ owner: MODEL_SPACE, layer: LAYER_WALLS, geom: lineGeom(0, 0, 5, 5) });
  out.push(b.build());
  engine.apply(out[0]!);
  b = new ChangeSetBuilder(engine);
  b.updateEntity(c.id, { geom: circleGeom(1, 1, 4) });
  b.removeEntity(engine.blockEntities(MODEL_SPACE)[0]!);
  b.setHeader('$LTSCALE', 2);
  out.push(b.build());
  engine.apply(out[1]!);
  return out;
}

describe('applyToReplica', () => {
  it('brings a replica of the opened document to what the engine holds', () => {
    const engine = DocumentModel.create(sampleInit());
    const changes = engineEdits(engine).map((cs) => structuredClone(cs));
    const replica = DocumentModel.create(sampleInit());
    for (const cs of changes) applyToReplica(replica, cs);
    expect(snapshot(replica)).toEqual(snapshot(engine));
    expect(replica.handSeed).toBe(engine.handSeed);
    expect(replica.header.get('$LTSCALE')).toBe(2);
  });

  it('returns the change set as applied, with the replica’s own objects on the before side', () => {
    const engine = DocumentModel.create(sampleInit());
    const [first, second] = engineEdits(engine).map((cs) => structuredClone(cs));
    const replica = DocumentModel.create(sampleInit());
    applyToReplica(replica, first!);
    const before = replica.entity(second!.entities!.updated![0]!.before.id);
    const local = applyToReplica(replica, second!);
    expect(local.entities!.updated![0]!.before).toBe(before);
  });

  it('says so when the replica missed a change', () => {
    const engine = DocumentModel.create(sampleInit());
    const [, second] = engineEdits(engine).map((cs) => structuredClone(cs));
    const later = new ChangeSetBuilder(engine);
    later.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom: circleGeom(9, 9, 1) });
    const third = structuredClone(later.build());
    const replica = DocumentModel.create(sampleInit());
    expect(() => applyToReplica(replica, second!)).toThrow(/not in the model/);
    expect(() => applyToReplica(replica, third, 'saved document')).toThrow(
      /^saved document out of step: handle \w+ is id \d+ here, \d+ in the engine$/,
    );
  });
});
