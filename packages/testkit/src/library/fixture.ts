// The user library test drawing (M8-03 part 2), authored here (Rule 0, DEC-047): an AC1032 DXF
// that `pnpm fixtures:library` writes to packages/testkit/fixtures/library/, which the Library
// palette's spec (tests/e2e/ui/library.spec.ts) drops on the palette as a drafter's own symbol
// file; fixture.test.ts keeps the file in step and reads it as the app does.
//
// - valves.dxf, in inches (INSUNITS 1): blocks GATE-VALVE (a bow tie 4 in. across, its stem a
//   circle of radius 0.5 in. on a 2 in. line) and CHECK-VALVE (the bow tie with a 0.75 in.
//   flapper circle), both left unitless, as many symbol files leave them: the library takes them
//   to be in the file's inches (DEC-096). Model space holds one reference of each.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  Circle,
  Insert,
  Line,
  UnitsType,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

export const LIBRARY_VALVES = 'valves.dxf';
export const GATE_VALVE = 'GATE-VALVE';
export const CHECK_VALVE = 'CHECK-VALVE';
/** The largest circle of each block, in inches. */
export const VALVE_RADII = { [GATE_VALVE]: 0.5, [CHECK_VALVE]: 0.75 } as const;

const p = (x: number, y: number) => new XYZ(x, y, 0);

/** A valve's body: two triangles meeting at the origin, 4 in. across and 2 in. high. */
function bowTie(): Entity[] {
  return [
    new Line(p(-2, -1), p(-2, 1)),
    new Line(p(-2, 1), p(2, -1)),
    new Line(p(2, -1), p(2, 1)),
    new Line(p(2, 1), p(-2, -1)),
  ];
}

function block(doc: CadDocument, name: string, entities: Entity[]): BlockRecord {
  const record = new BlockRecord(name);
  for (const e of entities) record.entities.add(e);
  doc.blockRecords!.add(record);
  return record;
}

export function libraryValvesDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  doc.header!.insUnits = UnitsType.Inches;
  const active = [...doc.vPorts!].find((v) => v.name.toUpperCase() === '*ACTIVE')!;
  active.center = new XY(5, 0);
  active.viewHeight = 6;
  active.aspectRatio = 1.6;
  const gate = block(doc, GATE_VALVE, [
    ...bowTie(),
    new Line(p(0, 0), p(0, 2)),
    new Circle(p(0, 2.5), VALVE_RADII[GATE_VALVE]),
  ]);
  const check = block(doc, CHECK_VALVE, [
    ...bowTie(),
    new Circle(p(0, 0), VALVE_RADII[CHECK_VALVE]),
  ]);
  for (const [record, x] of [
    [gate, 0],
    [check, 10],
  ] as const) {
    const i = new Insert(record);
    i.insertPoint = p(x, 0);
    doc.entities!.add(i);
  }
  return writeCadDocument(doc, { format: 'dxf' });
}
