// M9-04: geometric constraints saved in the `TRIYA_CONSTRAINTS` dictionary (PRD FR-X5, DEC-081)
// on public corpus files. The acceptance: a drawing holding constraints round-trips with zero
// structural difference, and its save passes ezdxf's audit (DEC-047; audit.py `FIXTURE_SAVES`,
// kind `constraints`). The constraints are added to the drawing as GEOMCONSTRAINT files them
// (the solver is `@triya/constraints`', which the testkit may not reach; its scenarios are in
// packages/constraints/test).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  isGeometricConstraint,
  type ConstraintRef,
  type Entity,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
} from '@triya/engine';
import { TRIYA_CONSTRAINTS, documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { withPinnedClock } from '../roundtrip/clock';
import { roundTrip } from '../roundtrip/roundtrip';

const FILES = [
  'third-party/acadsharp/sample_AC1032_ascii.dxf',
  'third-party/ezdxf/examples_dxf/colors.dxf',
] as const;

const bytesOf = (path: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const constraintsOf = (model: DocumentModel) =>
  [...model.objects.values()]
    .filter(isGeometricConstraint)
    .map(({ handle, kind, refs }) => ({ handle, kind, refs }));

/** Constraints on the drawing's lines, circles, arcs and polylines, as the GC* commands file them. */
function constrain(model: DocumentModel): number {
  const of = (kind: string) =>
    [...model.entities()].filter((e: Entity) => e.geom.kind === kind).map((e) => e.handle);
  const lines = of('LINE');
  const circles = [...of('CIRCLE'), ...of('ARC')];
  const polylines = of('LWPOLYLINE');
  const made: [GeometricConstraintKind, ConstraintRef[]][] = [];
  if (lines.length >= 2) {
    made.push(['parallel', [{ entity: lines[0]! }, { entity: lines[1]! }]]);
    made.push([
      'coincident',
      [
        { entity: lines[0]!, point: 'end' },
        { entity: lines[1]!, point: 'start' },
      ],
    ]);
  }
  if (lines.length >= 3) {
    made.push([
      'symmetric',
      [
        { entity: lines[0]!, point: 'start' },
        { entity: lines[1]!, point: 'end' },
        { entity: lines[2]! },
      ],
    ]);
  }
  if (circles.length >= 2)
    made.push(['concentric', [{ entity: circles[0]! }, { entity: circles[1]! }]]);
  if (circles.length >= 1) made.push(['fix', [{ entity: circles[0]!, point: 'center' }]]);
  if (polylines.length >= 1) {
    made.push(['horizontal', [{ entity: polylines[0]!, segment: 0 }]]);
    made.push(['fix', [{ entity: polylines[0]!, point: 'vertex', index: 1 }]]);
  }
  // A drawing with too few curves still gets one, on whatever two entities it has.
  if (made.length === 0) {
    const any = [...model.entities()].slice(0, 2).map((e) => e.handle);
    made.push(['equal', any.map((entity) => ({ entity }))]);
  }
  const b = new ChangeSetBuilder(model);
  for (const [kind, refs] of made) {
    b.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: model.meta.rootDictionary!,
      kind,
      refs,
    } as Omit<GeometricConstraintObject, 'handle'>);
  }
  model.apply(b.build());
  return made.length;
}

describe('geometric constraints on corpus files (M9-04)', () => {
  for (const path of FILES) {
    it(`${path}: saved, reopened and round-tripped with no difference`, () => {
      const bytes = bytesOf(path);
      const model = open(bytes);
      const count = constrain(model);
      expect(count).toBeGreaterThan(0);
      const save = () => withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      const saved = save();
      writeAuditSave(path, 'constraints', save);

      const doc = readCadDocument(saved);
      expect(doc.rootDictionary!.entryNames).toContain(TRIYA_CONSTRAINTS);
      const reopened = open(saved);
      expect(constraintsOf(reopened)).toEqual(constraintsOf(model));

      // Round trip of the save: zero structural difference with the constraints present.
      const r = roundTrip(saved);
      expect(r.status, JSON.stringify(r.sample)).toBe('clean');
      // And the unchanged drawing saved again keeps every record as it was.
      const again = withPinnedClock(() => saveAc1032Dxf(readCadDocument(saved), reopened));
      expect(constraintsOf(open(again))).toEqual(constraintsOf(model));
    });
  }
});
