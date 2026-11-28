// AutoCAD's own parametric constraints read from a file (M8-07 part 2): an ACDBASSOC2DCONSTRAINTGROUP
// with a dependency on each constrained object. Triya does not solve them (their DXF form is not
// published), so it keeps them: a save writes them back untouched, and the Health palette's
// Constraints card counts the groups (`healthReport`). The drawing is authored
// (roundtrip/constraint-group-drawing.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UnknownNonGraphicalObject } from '@node-projects/acad-ts';
import { EngineSession } from '@triya/engine';
import { healthReport, openDocument, readCadDocument } from '@triya/io';
import { FontBook } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { roundTrip } from '../roundtrip/roundtrip.ts';
import {
  CONSTRAINT_FIXTURE,
  CONSTRAINT_OBJECT_NAMES,
  constraintGroupDrawing,
} from '../roundtrip/constraint-group-drawing.ts';

const drawing = constraintGroupDrawing();
const FIXTURE = fileURLToPath(new URL(`../../${CONSTRAINT_FIXTURE}`, import.meta.url));

// `TRIYA_UPDATE_FIXTURES=1` rewrites the app spec's copy.
if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, drawing.bytes);
}

/** What a drawing maps to, its header (which carries its save time) aside. */
const mapped = (bytes: Uint8Array) =>
  JSON.stringify({ ...openDocument(readCadDocument(bytes)).init, header: undefined }, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : (v as unknown),
  );

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

  it('its note names Consolas and isocp inline, which the engine finds', () => {
    const s = new EngineSession(openDocument(readCadDocument(drawing.bytes)).init);
    expect(s.healthChecks().inlineFonts).toEqual([
      { code: 'f', value: 'Consolas|b0|i0|c0|p49', objects: 1 },
      { code: 'F', value: 'isocp.shx', objects: 1 },
    ]);
  });

  it("the app spec's copy is the drawing as authored", () => {
    expect(mapped(new Uint8Array(readFileSync(FIXTURE)))).toBe(mapped(drawing.bytes));
  });
});
