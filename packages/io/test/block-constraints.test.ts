// M9-13: the constraints an associative array's source block holds are saved as any others
// (DEC-081's records in `TRIYA_CONSTRAINTS`, DEC-087), naming the block's objects, and read back
// onto them: after a save and reopen ARRAYEDIT Source still opens them with the item.
import { ACadVersion, CadDocument, Line, XYZ } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  assocArrayOf,
  builtinCommands,
  geometricConstraints,
  isDimensionalConstraint,
  isGeometricConstraint,
  type EntityId,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { documentInit, exportDocument, readCadDocument, writeCadDocument } from '../src/index';

const hex = (n: number) => n.toString(16).toUpperCase();

/** An L in model space: line a (0,0)-(10,0), line b (10,0)-(10,10). */
function drawing() {
  const doc = new CadDocument(ACadVersion.AC1032);
  const a = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
  const b = new Line(new XYZ(10, 0, 0), new XYZ(10, 10, 0));
  doc.entities!.add(a);
  doc.entities!.add(b);
  return { bytes: writeCadDocument(doc, { format: 'dxf' }), a: hex(a.handle), b: hex(b.handle) };
}

/** A bus on `model` whose picks are the given ids and whose arrays are associative. */
function busOn(model: DocumentModel) {
  let picks: EntityId[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picks });
      if (r.op === 'sysvar' && r.name === 'ARRAYASSOCIATIVITY') {
        return Promise.resolve({ ok: true, value: 1 });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const pick = (...handles: string[]) => {
    picks = handles.map((h) => model.entityByHandle(h)!.id);
  };
  return { bus, pick };
}

const owners = (model: DocumentModel) =>
  [...model.objects.values()]
    .filter((o) => isGeometricConstraint(o) || isDimensionalConstraint(o))
    .flatMap((c) => c.refs.map((r) => model.entityByHandle(r.entity)?.owner));

describe('constraints inside an associative array’s source block (M9-13)', () => {
  it('are saved naming the block’s objects and read back onto them', async () => {
    const src = drawing();
    const model = DocumentModel.create(documentInit(readCadDocument(src.bytes)));
    const root = model.meta.rootDictionary ?? '0';
    const { bus } = busOn(model);
    // Horizontal, Coincident and d1 on the L, as GCHORIZONTAL, GCCOINCIDENT and DCALIGNED file them.
    const builder = new ChangeSetBuilder(model);
    builder.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: root,
      kind: 'horizontal',
      refs: [{ entity: src.a }],
    } as never);
    builder.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: root,
      kind: 'coincident',
      refs: [
        { entity: src.a, point: 'end' },
        { entity: src.b, point: 'start' },
      ],
    } as never);
    builder.addObject({
      type: 'TRIYA_DIMCONSTRAINT',
      owner: root,
      dimension: 'aligned',
      refs: [
        { entity: src.b, point: 'start' },
        { entity: src.b, point: 'end' },
      ],
      parameter: 'd1',
      expression: '10',
      location: { x: 12, y: 5 },
      form: 'dynamic',
    } as never);
    model.apply(builder.build());

    await bus.script(['ARRAYRECT']);
    await bus.answer({
      kind: 'selection',
      ids: [src.a, src.b].map((h) => model.entityByHandle(h)!.id),
    });
    await bus.script(['COU', '2', '1', '']);
    expect(bus.command).toBeUndefined();
    const array = [...model.entities()].find((e) => assocArrayOf(model.objects.values(), e))!;
    const source = assocArrayOf(model.objects.values(), array)!.source;
    expect(owners(model)).toEqual([source, source, source, source, source]);

    const saved = exportDocument(readCadDocument(src.bytes), model, { format: 'dxf' });
    const reopened = DocumentModel.create(documentInit(readCadDocument(saved)));
    const again = [...reopened.entities()].find((e) => assocArrayOf(reopened.objects.values(), e))!;
    const block = assocArrayOf(reopened.objects.values(), again)!.source;
    const strip = (m: DocumentModel) =>
      [...m.objects.values()]
        .filter((o) => isGeometricConstraint(o) || isDimensionalConstraint(o))
        .map((o) => {
          const { raw: _raw, owner: _owner, ...rest } = o as typeof o & { raw?: unknown };
          return rest;
        });
    expect(strip(reopened)).toEqual(strip(model));
    expect(owners(reopened)).toEqual([block, block, block, block, block]);
    expect(geometricConstraints(reopened)).toEqual([]);

    // ARRAYEDIT Source opens them with the item, in the drawing reopened.
    const r = busOn(reopened);
    await r.bus.script(['ARRAYEDIT']);
    await r.bus.answer({ kind: 'selection', ids: [again.id] });
    await r.bus.script(['S', '5,0']);
    expect(geometricConstraints(reopened).map((c) => c.kind)).toEqual(['horizontal', 'coincident']);
  });
});
