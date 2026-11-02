// M1-25 drawing health report v1: the facts a file gives (version, units, text style fonts,
// pattern hatches stored without lines, references, unknown objects, unmapped entities) and
// the report they make against the app's fonts and patterns.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathLine,
  HatchPattern,
  HatchPatternLine,
  MeasurementUnits,
  TextStyle,
  UnitsType,
  XY,
} from '@node-projects/acad-ts';
import { FontBook, loadStrokeFont, type ShxFont } from '@triya/text';
import { PatternLibrary } from '@triya/hatch';
import { describe, expect, it } from 'vitest';
import { healthReport, openDocument, type DrawingFacts } from '../src/index';

function square(h: Hatch): void {
  const path = new HatchBoundaryPath();
  const corners = [new XY(0, 0), new XY(10, 0), new XY(10, 10), new XY(0, 10)];
  corners.forEach((p, i) => {
    const l = new HatchBoundaryPathLine();
    l.start = p;
    l.end = corners[(i + 1) % 4]!;
    path.edges.push(l);
  });
  h.paths.push(path);
}

function hatch(pattern: string, type: number, lines = false): Hatch {
  const h = new Hatch();
  h.pattern = new HatchPattern(pattern);
  h.patternType = type as never;
  h.patternScale = 1;
  if (lines) {
    const l = new HatchPatternLine();
    l.offset = new XY(0, 1);
    h.pattern.lines.push(l);
  }
  square(h);
  return h;
}

function sample(): CadDocument {
  const doc = new CadDocument(ACadVersion.AC1027);
  doc.header!.insUnits = UnitsType.Millimeters;
  doc.header!.measurementUnits = MeasurementUnits.Metric;
  const notes = new TextStyle('Notes');
  notes.filename = 'romans.shx';
  notes.bigFontFilename = 'gbcbig.shx';
  doc.textStyles?.add(notes);
  const shapes = new TextStyle('LTYPESHP');
  shapes.filename = 'ltypeshp.shx';
  shapes.flags = 1 as never;
  doc.textStyles?.add(shapes);
  doc.blockRecords?.add(new BlockRecord('SITE', '..\\site\\survey.dwg'));
  doc.blockRecords?.add(new BlockRecord('GRID', 'grid.dwg', true));
  // Two ANSI31 hatches (different case) and a BRICK hatch stored without their lines, and
  // three that draw from what they store: a solid, a user-defined pattern, ANSI37 with lines.
  const solid = hatch('SOLID', 1);
  solid.isSolid = true;
  for (const h of [
    hatch('ANSI31', 1),
    hatch('ansi31', 1),
    hatch('BRICK', 2),
    solid,
    hatch('_USER', 0),
    hatch('ANSI37', 1, true),
  ])
    doc.entities?.add(h);
  return doc;
}

describe('drawingFacts', () => {
  const facts = openDocument(sample()).facts;

  it('gives the version and units', () => {
    expect(facts).toMatchObject({ version: 'AC1027', insUnits: 4, measurement: 'metric' });
  });

  it('lists each text style with its fonts, shape files marked', () => {
    expect(facts.textStyles).toContainEqual({
      name: 'Notes',
      font: 'romans.shx',
      bigFont: 'gbcbig.shx',
      trueTypeFlags: 0,
      shapeFile: false,
    });
    expect(facts.textStyles.find((s) => s.font === 'ltypeshp.shx')?.shapeFile).toBe(true);
  });

  it('counts the pattern hatches stored without lines, matching names without case', () => {
    expect(facts.patternHatches).toEqual([
      { pattern: 'ANSI31', count: 2 },
      { pattern: 'BRICK', count: 1 },
    ]);
  });

  it('lists xrefs, attached and overlaid, with their stored paths', () => {
    expect(facts.references).toEqual([
      { kind: 'xref', name: 'SITE', path: '..\\site\\survey.dwg' },
      { kind: 'xref', name: 'GRID', path: 'grid.dwg' },
    ]);
  });
});

const stroke = (name: string): ShxFont =>
  loadStrokeFont({
    format: 'triya-stroke-font',
    version: 1,
    name,
    description: name,
    notice: '',
    above: 42,
    below: 0,
    glyphs: { '65': [20, [[0, 0, 10, 0]]] },
  });

function fonts(...loaded: string[]): FontBook {
  const book = new FontBook();
  for (const name of ['oet-simplex', ...loaded]) book.addShx(name, stroke(name));
  return book;
}

const FACTS: DrawingFacts = {
  version: 'AC1032',
  insUnits: 1,
  measurement: 'imperial',
  textStyles: [
    { name: 'Standard', font: 'txt', trueTypeFlags: 0, shapeFile: false },
    {
      name: 'Notes',
      font: 'romans.shx',
      bigFont: 'gbcbig.shx',
      trueTypeFlags: 0,
      shapeFile: false,
    },
    { name: 'Title', font: 'romans.shx', trueTypeFlags: 0, shapeFile: false },
    { name: 'Body', font: 'arial.ttf', trueTypeFlags: 0, shapeFile: false },
    { name: '', font: 'ltypeshp.shx', trueTypeFlags: 0, shapeFile: true },
  ],
  patternHatches: [
    { pattern: 'ANSI31', count: 3 },
    { pattern: 'triya_brick', count: 2 },
  ],
  references: [{ kind: 'image', name: 'logo', path: '.\\logo.png' }],
  unknownObjects: [
    { type: 'ACAD_PROXY_ENTITY', count: 2 },
    { type: 'ACDBDETAILVIEWSTYLE', count: 1 },
  ],
  unmappedEntities: [
    { type: 'AEC_WALL', reason: 'not mapped yet', count: 4 },
    { type: 'CIRCLE', reason: 'tilted plane', count: 1 },
  ],
};

describe('healthReport', () => {
  it('names the release and the units', () => {
    const r = healthReport(FACTS, { fonts: fonts() });
    expect(r.version).toEqual({ code: 'AC1032', release: 'AutoCAD 2018' });
    expect(r.units).toEqual({ insUnits: 1, name: 'Inches', measurement: 'imperial' });
    expect(
      healthReport({ ...FACTS, version: 'AC1009', insUnits: 0 }, { fonts: fonts() }),
    ).toMatchObject({
      version: { code: 'AC1009', release: 'AutoCAD R11/R12' },
      units: { name: 'Unspecified (no units)' },
    });
    expect(
      healthReport({ ...FACTS, version: 'AC9999', insUnits: 24 }, { fonts: fonts() }),
    ).toMatchObject({
      version: { release: undefined },
      units: { name: 'US Survey Miles' },
    });
  });

  it('lists every missing font with what draws it and the styles that name it', () => {
    const r = healthReport(FACTS, { fonts: fonts() });
    expect(r.fonts.missing).toEqual([
      { font: 'arial.ttf', substitute: 'oet-simplex', styles: ['Body'] },
      // A missing big font or shape file has no stand-in: nothing draws its characters.
      { font: 'gbcbig.shx', substitute: undefined, styles: ['Notes'] },
      { font: 'ltypeshp.shx', substitute: undefined, styles: [''] },
      { font: 'romans.shx', substitute: 'oet-simplex', styles: ['Notes', 'Title'] },
      { font: 'txt', substitute: 'oet-simplex', styles: ['Standard'] },
    ]);
  });

  it('leaves out fonts that are loaded', () => {
    const book = fonts('romans', 'txt', 'gbcbig', 'ltypeshp');
    expect(healthReport(FACTS, { fonts: book }).fonts.missing.map((m) => m.font)).toEqual([
      'arial.ttf',
    ]);
  });

  it('adds fonts the drawing already found missing, such as MTEXT \\F fonts', () => {
    const book = fonts('romans', 'txt', 'gbcbig', 'ltypeshp');
    book.face({ name: 'isocp.shx', kind: 'shx', bold: false, italic: false });
    expect(healthReport(FACTS, { fonts: book }).fonts.missing).toContainEqual({
      font: 'isocp.shx',
      substitute: 'oet-simplex',
      styles: [],
    });
  });

  it('lists the stored-without-lines patterns no loaded pattern file defines', () => {
    // The bundled set defines TRIYA_BRICK (names match without case) but not ANSI31.
    expect(healthReport(FACTS, { fonts: fonts() }).patterns.missing).toEqual([
      { pattern: 'ANSI31', hatches: 3 },
    ]);
    // The app's library (bundled and user .pat files) replaces the bundled default.
    const user = new PatternLibrary('*ANSI31, user hatch\n45, 0,0, 0,3.175\n');
    expect(healthReport(FACTS, { fonts: fonts(), patterns: user }).patterns.missing).toEqual([
      { pattern: 'triya_brick', hatches: 2 },
    ]);
  });

  it('counts unknown objects and unmapped entities by type', () => {
    const r = healthReport(FACTS, { fonts: fonts() });
    expect(r.unknownObjects).toEqual({ total: 3, byType: FACTS.unknownObjects });
    expect(r.unmappedEntities).toEqual({ total: 5, byType: FACTS.unmappedEntities });
  });

  it('lists references as found in the file, not yet looked for', () => {
    expect(healthReport(FACTS, { fonts: fonts() }).references).toEqual([
      { kind: 'image', name: 'logo', path: '.\\logo.png', status: 'unchecked' },
    ]);
  });
});
