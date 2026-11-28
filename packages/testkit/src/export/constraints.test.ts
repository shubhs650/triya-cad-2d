// M9-04 and M9-03 part 3: geometric and dimensional constraints saved in the `TRIYA_CONSTRAINTS` dictionary (PRD FR-X5, DEC-081)
// on public corpus files. The acceptance: a drawing holding constraints round-trips with zero
// structural difference, and its save passes ezdxf's audit (DEC-047; audit.py `FIXTURE_SAVES`,
// kind `constraints`). The constraints are added to the drawing as GEOMCONSTRAINT files them
// (the solver is `@triya/constraints`', which the testkit may not reach; its scenarios are in
// packages/constraints/test). Dimensional constraints (DEC-082) are added beside them, as
// DIMCONSTRAINT files them, and user parameters (M9-03 part 6, DEC-083) as the Parameters
// Manager's New files them, and a group filter (M9-03 part 12, DEC-086) holding a user parameter
// and a dimensional constraint, as its New Group Filter and drag file them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  isGeometricConstraint,
  isParameterGroup,
  isParameterObject,
  type ConstraintRef,
  type DimensionalConstraintObject,
  type Entity,
  type GeometricConstraintKind,
  type GeometricConstraintObject,
  type ParameterGroupObject,
  type ParameterObject,
  type UserParameterObject,
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

const constraintsOf = (model: DocumentModel) => [
  ...[...model.objects.values()]
    .filter(isGeometricConstraint)
    .map(({ handle, kind, refs }) => ({ handle, kind, refs })),
  ...[...model.objects.values()].filter(isParameterObject).map((d) => {
    const {
      raw: _raw,
      owner: _owner,
      ...rest
    } = d as ParameterObject & {
      raw?: unknown;
    };
    return rest;
  }),
  ...[...model.objects.values()]
    .filter(isParameterGroup)
    .map(({ handle, name, members }) => ({ handle, name, members })),
];

type Dim = Omit<DimensionalConstraintObject, 'handle' | 'type' | 'owner'>;

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
  const dims: Dim[] = [];
  const style = [...model.tables.dimStyles.keys()][0];
  if (lines.length >= 1) {
    dims.push({
      dimension: 'aligned',
      refs: [{ entity: lines[0]! }],
      parameter: 'd1',
      expression: '10',
      description: 'Length of the first line',
      location: { x: 1, y: 2 },
      form: 'dynamic',
    });
  }
  if (lines.length >= 2) {
    dims.push({
      dimension: 'angular',
      refs: [{ entity: lines[0]! }, { entity: lines[1]! }],
      parameter: 'ang1',
      expression: '30',
      reference: true,
      location: { x: 3, y: 4 },
      form: 'annotational',
      // Its dimension style and own DIMVARs (M9-03 part 15, DEC-088): 340, 304/140 in its record.
      ...(style !== undefined && { style }),
      dimvars: { DIMTXT: 0.25, DIMSCALE: 2 },
    });
  }
  if (circles.length >= 1) {
    dims.push({
      dimension: 'radial',
      refs: [{ entity: circles[0]! }],
      parameter: 'rad1',
      expression: 'd1/4',
      location: { x: 5, y: 6 },
      form: 'dynamic',
      // DCDISPLAY's Hide (M9-03 part 7, DEC-084): 282 1 in its record.
      hidden: true,
    });
  }
  const b = new ChangeSetBuilder(model);
  // User parameters (M9-03 part 6, DEC-083): one plain, one naming a constraint's parameter.
  const users = [
    { parameter: 'user1', expression: '2.5', description: 'Bolt pitch' },
    { parameter: 'user2', expression: dims.length > 0 ? `${dims[0]!.parameter}*2` : 'user1*2' },
  ];
  const members: string[] = [];
  for (const u of users) {
    const made = b.addObject({
      type: 'TRIYA_USERPARAMETER',
      owner: model.meta.rootDictionary!,
      ...u,
    } as Omit<UserParameterObject, 'handle'>);
    if (members.length === 0) members.push(made.handle);
  }
  for (const d of dims) {
    const made = b.addObject({
      type: 'TRIYA_DIMCONSTRAINT',
      owner: model.meta.rootDictionary!,
      ...d,
    } as Omit<DimensionalConstraintObject, 'handle'>);
    if (members.length === 1) members.push(made.handle);
  }
  // A group filter (M9-03 part 12, DEC-086) naming a user parameter and a dimensional constraint.
  b.addObject({
    type: 'TRIYA_PARAMETERGROUP',
    owner: model.meta.rootDictionary!,
    name: 'Group Filter1',
    members,
  } as Omit<ParameterGroupObject, 'handle'>);
  for (const [kind, refs] of made) {
    b.addObject({
      type: 'TRIYA_GEOMCONSTRAINT',
      owner: model.meta.rootDictionary!,
      kind,
      refs,
    } as Omit<GeometricConstraintObject, 'handle'>);
  }
  model.apply(b.build());
  return made.length + dims.length + users.length;
}

describe('constraints, user parameters and group filters on corpus files (M9-04, M9-03 parts 3, 6, 12 and 15)', () => {
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
