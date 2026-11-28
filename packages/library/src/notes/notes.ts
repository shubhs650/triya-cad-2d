// Standard notes (M8-02 part 3, DEC-094): a drafting office's general notes for vessel and
// piping drawings, chosen from a catalogue and filled in for the drawing, written as one MTEXT
// the drafter goes on editing (a block of notes could only be exploded first).
//
// The wording is Triya's own, in the capitals drawings use. Each note's values (a design code,
// a pressure) default to what is usual for a metric or an imperial drawing; the units note names
// the drawing's INSUNITS. The MTEXT has a heading paragraph and the notes numbered with a
// hanging indent (`\pxi-3,l3,t3;`: wrapped lines line up under the note's text, three text
// heights in, where the tab after its number goes).
import {
  insUnitsOf,
  type ChangeSetBuilder,
  type DocumentModel,
  type Handle,
  type MTextGeometry,
  type Vec2,
} from '@triya/engine';
import { currentTextStyle, oneLine } from '../texts';

export const STANDARD_NOTE_GROUPS = ['general', 'vessel', 'welding', 'finish'] as const;

export type StandardNoteGroup = (typeof STANDARD_NOTE_GROUPS)[number];

/** The units a drawing is in, as the units note names them, and whether they are metric. */
export interface DrawingUnits {
  readonly name: string;
  readonly metric: boolean;
}

export interface StandardNoteField {
  readonly key: string;
  readonly label: string;
  /** The value when the drafter gives none. */
  readonly defaultValue: (units: DrawingUnits) => string;
}

export interface StandardNote {
  readonly id: string;
  readonly group: StandardNoteGroup;
  /** The note, each `{key}` one of its fields. */
  readonly text: string;
  readonly fields: readonly StandardNoteField[];
}

const field = (key: string, label: string, metric: string, imperial = metric) => ({
  key,
  label,
  defaultValue: (u: DrawingUnits) => (u.metric ? metric : imperial),
});

const note = (
  id: string,
  group: StandardNoteGroup,
  text: string,
  ...fields: StandardNoteField[]
): StandardNote => ({ id, group, text, fields });

export const STANDARD_NOTES: readonly StandardNote[] = [
  note('units', 'general', 'ALL DIMENSIONS ARE IN {units} UNLESS OTHERWISE STATED.', {
    key: 'units',
    label: 'units',
    defaultValue: (u) => u.name,
  }),
  note('do-not-scale', 'general', 'DO NOT SCALE FROM THIS DRAWING.'),
  // ISO 5456-2 drawings are first angle, ASME Y14.3 ones third angle.
  note(
    'projection',
    'general',
    '{angle} ANGLE PROJECTION.',
    field('angle', 'projection', 'FIRST', 'THIRD'),
  ),
  note(
    'tolerances',
    'general',
    'UNLESS OTHERWISE STATED, TOLERANCES ARE {tolerances}.',
    field(
      'tolerances',
      'tolerances',
      'TO ISO 2768-m',
      '±0.03 ON LINEAR DIMENSIONS AND ±0.5° ON ANGLES',
    ),
  ),
  note(
    'break-edges',
    'general',
    'REMOVE ALL BURRS AND BREAK SHARP EDGES {edge}.',
    field('edge', 'edge break', '0.5 MAX', '0.02 MAX'),
  ),
  note(
    'design-code',
    'vessel',
    'DESIGNED, FABRICATED, INSPECTED AND TESTED TO {code}.',
    field('code', 'design code', 'ASME BPVC SECTION VIII, DIVISION 1'),
  ),
  note(
    'design-conditions',
    'vessel',
    'DESIGN PRESSURE {pressure} AT {temperature}.',
    field('pressure', 'design pressure', '10 bar(g)', '150 psig'),
    field('temperature', 'design temperature', '150 °C', '300 °F'),
  ),
  note(
    'hydrotest',
    'vessel',
    'HYDROSTATIC TEST PRESSURE {pressure}, MEASURED AT THE TOP OF THE VESSEL.',
    field('pressure', 'test pressure', '13 bar(g)', '195 psig'),
  ),
  note(
    'corrosion-allowance',
    'vessel',
    'CORROSION ALLOWANCE {allowance}.',
    field('allowance', 'corrosion allowance', '3 mm', '1/8 in'),
  ),
  note(
    'flanges',
    'vessel',
    'FLANGES TO {standard} UNLESS OTHERWISE STATED.',
    field('standard', 'flange standard', 'ASME B16.5'),
  ),
  note('bolt-holes', 'vessel', 'FLANGE BOLT HOLES STRADDLE THE PRINCIPAL CENTRE LINES.'),
  note('nameplate', 'vessel', 'NAMEPLATE AND BRACKET LOCATED AS SHOWN.'),
  note(
    'welding-qualification',
    'welding',
    'WELDING PROCEDURES AND WELDERS QUALIFIED TO {code}.',
    field('code', 'qualification code', 'ASME BPVC SECTION IX'),
  ),
  note('butt-welds', 'welding', 'ALL BUTT WELDS ARE FULL PENETRATION.'),
  note(
    'fillet-welds',
    'welding',
    'FILLET WELDS ARE {size} CONTINUOUS UNLESS OTHERWISE STATED.',
    field('size', 'fillet size', '6 mm', '1/4 in'),
  ),
  note('radiography', 'welding', 'RADIOGRAPHY: {extent}.', field('extent', 'extent', 'SPOT')),
  note(
    'pwht',
    'welding',
    'POST-WELD HEAT TREATMENT: {treatment}.',
    field('treatment', 'heat treatment', 'NOT REQUIRED'),
  ),
  note(
    'surface-finish',
    'finish',
    'SURFACE FINISH {finish} UNLESS OTHERWISE STATED.',
    field('finish', 'surface finish', 'Ra 3.2 µm', '125 µin Ra'),
  ),
  note(
    'painting',
    'finish',
    'EXTERNAL SURFACES {treatment}.',
    field(
      'treatment',
      'surface treatment',
      "BLAST CLEANED AND PAINTED TO THE PURCHASER'S SPECIFICATION",
    ),
  ),
  note('gasket-faces', 'finish', 'GASKET FACES ARE NOT TO BE PAINTED.'),
];

export type StandardNoteId = string;

/** A catalogue note with the drafter's values, or a note in the drafter's own words. */
export type StandardNoteItem =
  | { readonly id: StandardNoteId; readonly values?: Readonly<Record<string, string>> }
  | { readonly text: string };

export interface StandardNotesSpec {
  /** The heading paragraph (`NOTES:`); none when empty. */
  readonly heading: string;
  readonly notes: readonly StandardNoteItem[];
  /** The text height, in drawing units. */
  readonly height: number;
  /** The MTEXT's width, which its lines wrap at, in drawing units. */
  readonly width: number;
}

/** Units, scale, burrs and tolerances, in inches (the palette scales by `drawingScale`). */
export const STANDARD_NOTES_DEFAULTS: StandardNotesSpec = {
  heading: 'NOTES:',
  notes: [{ id: 'units' }, { id: 'do-not-scale' }, { id: 'tolerances' }, { id: 'break-edges' }],
  height: 0.125,
  width: 6,
};

/** The defaults with each length multiplied by `scale` (25.4 for a drawing in millimetres). */
export function standardNotesDefaults(scale = 1): StandardNotesSpec {
  const d = STANDARD_NOTES_DEFAULTS;
  return { ...d, height: d.height * scale, width: d.width * scale };
}

/** INSUNITS codes as the units note names them; the metric ones. */
const UNIT_NAMES: Readonly<Record<number, string>> = {
  1: 'INCHES',
  2: 'FEET',
  3: 'MILES',
  4: 'MILLIMETRES',
  5: 'CENTIMETRES',
  6: 'METRES',
  7: 'KILOMETRES',
  8: 'MICROINCHES',
  9: 'MILS',
  10: 'YARDS',
  11: 'ANGSTROMS',
  12: 'NANOMETRES',
  13: 'MICROMETRES',
  14: 'DECIMETRES',
  15: 'DECAMETRES',
  16: 'HECTOMETRES',
  17: 'GIGAMETRES',
  18: 'ASTRONOMICAL UNITS',
  19: 'LIGHT YEARS',
  20: 'PARSECS',
  21: 'US SURVEY FEET',
  22: 'US SURVEY INCHES',
  23: 'US SURVEY YARDS',
  24: 'US SURVEY MILES',
};
const METRIC: ReadonlySet<number> = new Set([4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17]);

/**
 * The drawing's units: its INSUNITS, else for a unitless drawing millimetres or inches by its
 * MEASUREMENT (as `drawingScale` reads them).
 */
export function drawingUnits(model: DocumentModel): DrawingUnits {
  const code = insUnitsOf(model);
  const name = UNIT_NAMES[code];
  if (name) return { name, metric: METRIC.has(code) };
  const m = model.header.get('$MEASUREMENT');
  const metric = typeof m === 'number' ? m === 1 : model.meta.measurement === 'metric';
  return metric ? { name: 'MILLIMETRES', metric } : { name: 'INCHES', metric };
}

const catalogue = new Map(STANDARD_NOTES.map((n) => [n.id, n]));

/** The note `item` says, its fields filled from its values, else their defaults for `units`. */
export function standardNoteText(item: StandardNoteItem, units: DrawingUnits): string {
  if ('text' in item) return item.text;
  const n = catalogue.get(item.id);
  if (!n) return '';
  return n.text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const f = n.fields.find((x) => x.key === key)!;
    return item.values?.[key] ?? f.defaultValue(units);
  });
}

/** Text as MTEXT shows it literally: its backslashes and braces escaped. */
const literal = (s: string) => s.replace(/[\\{}]/g, (c) => `\\${c}`);

/** The MTEXT contents of the notes `spec` for a drawing in `units`. */
export function standardNotesContents(spec: StandardNotesSpec, units: DrawingUnits): string {
  const notes = spec.notes.map(
    (item, i) => `${i + 1}.\\t${literal(standardNoteText(item, units))}`,
  );
  const list = `\\pxi-3,l3,t3;${notes.join('\\P')}`;
  return spec.heading ? `${literal(spec.heading)}\\P${list}` : list;
}

/** Why `spec` is not a set of notes Triya writes, or undefined when it is. */
export function checkStandardNotes(spec: StandardNotesSpec): string | undefined {
  for (const [key, label] of [
    ['height', 'height'],
    ['width', 'width'],
  ] as const) {
    const v = spec[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${label} must be a number`;
    if (v <= 0) return `${label} must be more than 0`;
  }
  if (!oneLine(spec.heading)) return 'heading must be one line';
  if (spec.notes.length === 0) return 'standard notes need at least one note';
  for (const [i, item] of spec.notes.entries()) {
    if ('text' in item) {
      if (!item.text.trim()) return `note ${i + 1} is empty`;
      if (!oneLine(item.text)) return `note ${i + 1} must be one line`;
      continue;
    }
    const n = catalogue.get(item.id);
    if (!n) return `${String(item.id)} is not a standard note`;
    for (const [key, value] of Object.entries(item.values ?? {})) {
      if (!n.fields.some((f) => f.key === key)) return `the ${n.id} note has no ${key}`;
      if (!oneLine(value)) return `note ${i + 1} must be one line`;
    }
  }
  return undefined;
}

/** The MTEXT of the notes `spec`, its top left at `position`, in `style`. */
export function standardNotesGeometry(
  spec: StandardNotesSpec,
  units: DrawingUnits,
  style: Handle,
  position: Vec2,
): MTextGeometry {
  return {
    kind: 'MTEXT',
    contents: standardNotesContents(spec, units),
    style,
    position,
    height: spec.height,
    width: spec.width,
    rotation: 0,
    attachment: 1,
    direction: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  };
}

/** The layer CLAYER names, else 0. */
function currentLayer(model: DocumentModel): Handle {
  const name = model.header.get('$CLAYER');
  const layers = [...model.tables.layers.values()];
  const named = (n: string) => layers.find((l) => l.name.toUpperCase() === n.toUpperCase());
  return ((typeof name === 'string' ? named(name) : undefined) ?? named('0') ?? layers[0]!).handle;
}

/**
 * Adds the notes `spec` to `owner` (a space's block) as one MTEXT with its top left at
 * `position`, on the current layer in the current text style, and returns its handle.
 * Undefined, with nothing added, when `spec` is no set of notes or the drawing has no text
 * style.
 */
export function addStandardNotes(
  b: ChangeSetBuilder,
  model: DocumentModel,
  spec: StandardNotesSpec,
  owner: Handle,
  position: Vec2,
): Handle | undefined {
  if (checkStandardNotes(spec) !== undefined) return undefined;
  const style = currentTextStyle(model);
  if (style === undefined) return undefined;
  return b.addEntity({
    owner,
    layer: currentLayer(model),
    geom: standardNotesGeometry(spec, drawingUnits(model), style, position),
  }).handle;
}
