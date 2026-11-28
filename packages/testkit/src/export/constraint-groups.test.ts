// AutoCAD's own parametric constraints read from a file (M8-07 part 2): an ACDBASSOC2DCONSTRAINTGROUP
// with a dependency on each constrained object. Triya does not solve them (their DXF form is not
// published), so it keeps them: a save writes them back untouched, and the Health palette's
// Constraints card counts the groups (`healthReport`). The drawing is authored
// (roundtrip/constraint-group-drawing.ts).
import { UnknownNonGraphicalObject } from '@node-projects/acad-ts';
import { healthReport, openDocument, readCadDocument } from '@triya/io';
import { FontBook } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { roundTrip } from '../roundtrip/roundtrip.ts';
import {
  CONSTRAINT_OBJECT_NAMES,
  constraintGroupDrawing,
} from '../roundtrip/constraint-group-drawing.ts';

const drawing = constraintGroupDrawing();

describe("AutoCAD's constraint groups read from a file", () => {
  it('reads them as objects kept unchanged, with the lines listing their dependencies', () => {
    const doc = readCadDocument(drawing.bytes);
    const names = drawing.assoc.map((h) => doc.getCadObject(Number.parseInt(h, 16))?.objectName);
    expect(names).toEqual([...CONSTRAINT_OBJECT_NAMES]);
    const group = doc.getCadObject(Number.parseInt(drawing.assoc[2]!, 16));
    expect(group).toBeInstanceOf(UnknownNonGraphicalObject);
  });

  it('saves back with zero structural difference', () => {
    const r = roundTrip(drawing.bytes);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
  });

  it('the health report counts the group', () => {
    const opened = openDocument(readCadDocument(drawing.bytes));
    expect(opened.facts.unknownObjects).toContainEqual({
      type: 'ACDBASSOC2DCONSTRAINTGROUP',
      count: 1,
    });
    expect(healthReport(opened.facts, { fonts: new FontBook() }).autocadConstraintGroups).toBe(1);
  });
});
