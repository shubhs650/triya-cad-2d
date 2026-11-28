// M8-02 part 3: standard notes. The catalogue's wording in a metric and an imperial drawing and
// the MTEXT a set of notes makes are pinned by snapshots under notes-snapshots/; rewrite with
// `pnpm vitest run packages/library/test/notes -u` and review the diff.
import { describe, expect, it } from 'vitest';
import { ChangeSetBuilder, type MTextGeometry } from '@triya/engine';
import {
  STANDARD_NOTES,
  STANDARD_NOTES_DEFAULTS,
  STANDARD_NOTE_GROUPS,
  addStandardNotes,
  checkStandardNotes,
  drawingUnits,
  standardNoteText,
  standardNotesContents,
  standardNotesDefaults,
  type StandardNotesSpec,
} from '../src/index';
import { MODEL_SPACE, NOTES_STYLE, STYLE, drawing } from './fixtures';

const MM = { name: 'MILLIMETRES', metric: true } as const;
const INCHES = { name: 'INCHES', metric: false } as const;

const spec = (change: Partial<StandardNotesSpec> = {}): StandardNotesSpec => ({
  ...STANDARD_NOTES_DEFAULTS,
  ...change,
});

describe('standard notes (M8-02)', () => {
  it('names the units the drawing is in, or its measurement when it has none', () => {
    expect(drawingUnits(drawing({ insUnits: 4 }))).toEqual(MM);
    expect(drawingUnits(drawing({ insUnits: 1, measurement: 'imperial' }))).toEqual(INCHES);
    expect(drawingUnits(drawing({ insUnits: 2 }))).toEqual({ name: 'FEET', metric: false });
    expect(drawingUnits(drawing({ insUnits: 6, measurement: 'imperial' }))).toEqual({
      name: 'METRES',
      metric: true,
    });
    expect(drawingUnits(drawing({ insUnits: 0, measurement: 'imperial' }))).toEqual(INCHES);
    expect(drawingUnits(drawing({ insUnits: 0, measurement: 'metric' }))).toEqual(MM);
    // SETVAR's INSUNITS and MEASUREMENT win over what the drawing opened with.
    expect(drawingUnits(drawing({ insUnits: 4, header: [['$INSUNITS', 1]] }))).toEqual(INCHES);
    expect(
      drawingUnits(drawing({ insUnits: 0, measurement: 'metric', header: [['$MEASUREMENT', 0]] })),
    ).toEqual(INCHES);
  });

  it('fills a note from its values, else from its defaults for the drawing', () => {
    expect(standardNoteText({ id: 'units' }, MM)).toBe(
      'ALL DIMENSIONS ARE IN MILLIMETRES UNLESS OTHERWISE STATED.',
    );
    expect(standardNoteText({ id: 'units' }, INCHES)).toBe(
      'ALL DIMENSIONS ARE IN INCHES UNLESS OTHERWISE STATED.',
    );
    expect(standardNoteText({ id: 'projection' }, MM)).toBe('FIRST ANGLE PROJECTION.');
    expect(standardNoteText({ id: 'projection' }, INCHES)).toBe('THIRD ANGLE PROJECTION.');
    expect(
      standardNoteText({ id: 'design-conditions', values: { pressure: '16 bar(g)' } }, MM),
    ).toBe('DESIGN PRESSURE 16 bar(g) AT 150 °C.');
    expect(standardNoteText({ text: 'PAINT RED.' }, MM)).toBe('PAINT RED.');
  });

  it('keeps every note one line, each placeholder a field, each field used', () => {
    const ids = new Set<string>();
    for (const n of STANDARD_NOTES) {
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
      expect(STANDARD_NOTE_GROUPS).toContain(n.group);
      expect(n.text).not.toMatch(/[\r\n\\]/);
      const placeholders = [...n.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(placeholders.sort()).toEqual(n.fields.map((f) => f.key).sort());
      for (const u of [MM, INCHES]) expect(standardNoteText({ id: n.id }, u)).not.toMatch(/[{}]/);
    }
  });

  it('writes a heading and the notes numbered with a hanging indent, escaping MTEXT codes', () => {
    const s = spec({
      notes: [{ id: 'do-not-scale' }, { text: 'SEE C:\\SPECS {REV 2}.' }],
    });
    expect(standardNotesContents(s, MM)).toBe(
      'NOTES:\\P\\pxi-3,l3,t3;1.\\tDO NOT SCALE FROM THIS DRAWING.\\P2.\\tSEE C:\\\\SPECS \\{REV 2\\}.',
    );
    expect(standardNotesContents({ ...s, heading: '' }, MM)).toBe(
      '\\pxi-3,l3,t3;1.\\tDO NOT SCALE FROM THIS DRAWING.\\P2.\\tSEE C:\\\\SPECS \\{REV 2\\}.',
    );
  });

  it('refuses notes it cannot write', () => {
    expect(checkStandardNotes(spec())).toBeUndefined();
    expect(checkStandardNotes(spec({ notes: [] }))).toBe('standard notes need at least one note');
    expect(checkStandardNotes(spec({ notes: [{ id: 'nope' as never }] }))).toBe(
      'nope is not a standard note',
    );
    expect(checkStandardNotes(spec({ notes: [{ id: 'units', values: { colour: 'RED' } }] }))).toBe(
      'the units note has no colour',
    );
    expect(checkStandardNotes(spec({ notes: [{ text: ' ' }] }))).toBe('note 1 is empty');
    expect(
      checkStandardNotes(spec({ notes: [{ id: 'flanges', values: { standard: 'A\nB' } }] })),
    ).toBe('note 1 must be one line');
    expect(checkStandardNotes(spec({ heading: 'A\nB' }))).toBe('heading must be one line');
    expect(checkStandardNotes(spec({ height: -1 }))).toBe('height must be more than 0');
    expect(checkStandardNotes(spec({ width: 0 }))).toBe('width must be more than 0');
  });

  it('scales the defaults to the drawing', () => {
    expect(standardNotesDefaults()).toEqual(STANDARD_NOTES_DEFAULTS);
    const mm = standardNotesDefaults(25.4);
    expect(mm.height).toBeCloseTo(3.175, 12);
    expect(mm.width).toBeCloseTo(STANDARD_NOTES_DEFAULTS.width * 25.4, 12);
    expect(mm.notes).toEqual(STANDARD_NOTES_DEFAULTS.notes);
  });

  it('adds the notes as one MTEXT on the current layer in the current text style', () => {
    const model = drawing({
      header: [
        ['$CLAYER', 'NOTES'],
        ['$TEXTSTYLE', 'Notes'],
      ],
    });
    const s = standardNotesDefaults(25.4);
    const b = new ChangeSetBuilder(model);
    const at = { x: 10, y: 200 };
    const made = addStandardNotes(b, model, s, MODEL_SPACE, at)!;
    expect(addStandardNotes(b, model, { ...s, notes: [] }, MODEL_SPACE, at)).toBeUndefined();
    model.apply(b.build());
    const e = [...model.entities()].find((x) => x.handle === made)!;
    expect(model.tables.layers.get(e.layer)?.name).toBe('NOTES');
    expect(e.owner).toBe(MODEL_SPACE);
    expect(e.geom).toMatchObject({
      kind: 'MTEXT',
      contents: standardNotesContents(s, MM),
      style: NOTES_STYLE,
      position: at,
      height: s.height,
      width: s.width,
      rotation: 0,
      attachment: 1,
      direction: 1,
    } satisfies Partial<MTextGeometry>);
    // Without a current layer or style: layer 0 and Standard.
    const plain = drawing();
    const b2 = new ChangeSetBuilder(plain);
    const h2 = addStandardNotes(b2, plain, s, MODEL_SPACE, at)!;
    plain.apply(b2.build());
    const e2 = [...plain.entities()].find((x) => x.handle === h2)!;
    expect(plain.tables.layers.get(e2.layer)?.name).toBe('0');
    expect((e2.geom as MTextGeometry).style).toBe(STYLE);
  });
});

describe('standard notes snapshots (M8-02)', () => {
  for (const [file, units] of [
    ['catalogue-metric', MM],
    ['catalogue-imperial', INCHES],
  ] as const)
    it(`pins ${file}`, async () => {
      const text = STANDARD_NOTES.map(
        (n) => `${n.group.padEnd(8)} ${n.id.padEnd(22)} ${standardNoteText({ id: n.id }, units)}`,
      ).join('\n');
      await expect(`${text}\n`).toMatchFileSnapshot(`notes-snapshots/${file}.txt`);
    });
  it('pins the default notes', async () => {
    await expect(`${standardNotesContents(STANDARD_NOTES_DEFAULTS, MM)}\n`).toMatchFileSnapshot(
      'notes-snapshots/defaults-metric.txt',
    );
  });
});
