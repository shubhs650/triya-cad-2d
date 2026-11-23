// M9-05 part 1: geometric constraints are drawing objects for the session only. Their storage
// (`TRIYA_CONSTRAINTS`, PRD FR-X5) is M9-04's, so until then a save leaves them out and writes
// the geometry they moved, rather than refusing the save as it does an object it cannot write.
import { ACadVersion, CadDocument, Line, XYZ } from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, isGeometricConstraint } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { documentInit, exportDocument, readCadDocument, writeCadDocument } from '../src/index';

function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.entities!.add(new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0)));
  doc.entities!.add(new Line(new XYZ(0, 5, 0), new XYZ(10, 8, 0)));
  return writeCadDocument(doc, { format: 'dxf' });
}

describe('saving a drawing with geometric constraints', () => {
  it('writes the geometry a constraint moved and leaves the constraint out', () => {
    const file = drawing();
    const model = DocumentModel.create(documentInit(readCadDocument(file)));
    const [a, b] = [...model.entities()].filter((e) => e.geom.kind === 'LINE');
    const builder = new ChangeSetBuilder(model);
    builder.updateEntity(b!.id, {
      geom: { kind: 'LINE', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
    });
    const constraint = builder.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: model.meta.rootDictionary ?? '0',
      kind: 'parallel',
      refs: [{ entity: a!.handle }, { entity: b!.handle }],
    } as never);
    model.apply(builder.build());
    expect(isGeometricConstraint(model.objects.get(constraint.handle))).toBe(true);

    const saved = exportDocument(readCadDocument(file), model, { format: 'dxf' });
    const back = readCadDocument(saved);
    expect(back.getCadObject(Number.parseInt(constraint.handle, 16))).toBeFalsy();
    const line = documentInit(back).entities!.find((e) => e.handle === b!.handle)!;
    expect(line.geom).toMatchObject({ start: { x: 0, y: 5 }, end: { x: 10, y: 5 } });
  });
});
