// A feature control frame as the Geometric Tolerance dialog edits it (TOLERANCE, M4-11; AutoCAD
// 2024 Help, "Geometric Tolerance Dialog Box"), and the TOLERANCE text (DXF 1) it stands for.
//
// What the text holds, as AutoCAD writes it (the acadsharp corpus samples): one line per row,
// lines split by `^J` (a newline in the model since acad-ts patch 0039). A frame row is six
// compartments split by `%%v`, all six written even when empty: the characteristic symbol, the
// two tolerances and the three datums, e.g. `{\Fgdt;j}%%v{\Fgdt;n}0.1{\Fgdt;m}%%vA%%v%%v%%v`.
// GD&T symbols are letters in the GDT font (`{\Fgdt;x}`): a tolerance opens with the diameter
// symbol (n) when it has one and ends with its material condition (m, l, s), as a datum ends
// with its own. After the rows come the projected tolerance zone, its height followed by the
// zone symbol (p) when chosen, and then the datum identifier. A line with nothing in it is left
// out: the samples hold `{\Fgdt;p}` alone (the zone symbol, no height) and `99^Ja` (a height and
// an identifier, no rows).
//
// Where that is ambiguous we read the common case, which the dialog's own output never meets
// except as noted: lines with `%%v` are rows, in order; of the lines after them, two are the
// height then the identifier, and one is the height when it holds the zone symbol or a number,
// else the identifier. So a frame of a numeric datum identifier alone (`5`) reads back as a
// height of 5. A second row written with an empty first row keeps an empty first row (six
// empty compartments) so that it reads back as the second.

/** A material condition: none, maximum (M), least (L) or regardless of feature size (S). */
export type GdtMaterial = '' | 'm' | 'l' | 's';

/** One of the frame's tolerances: the diameter symbol, the value and a material condition. */
export interface GdtTolerance {
  readonly diameter: boolean;
  readonly value: string;
  readonly material: GdtMaterial;
}

/** One of the frame's datum references and its material condition. */
export interface GdtDatum {
  readonly value: string;
  readonly material: GdtMaterial;
}

/** One row of the frame. `symbol`: the characteristic's GDT font letter, '' for none. */
export interface GdtRow {
  readonly symbol: string;
  readonly tolerance1: GdtTolerance;
  readonly tolerance2: GdtTolerance;
  readonly datum1: GdtDatum;
  readonly datum2: GdtDatum;
  readonly datum3: GdtDatum;
}

/** The Geometric Tolerance dialog's fields. */
export interface GdtFrame {
  readonly rows: readonly [GdtRow, GdtRow];
  /** Height: the projected tolerance zone's value. */
  readonly height: string;
  /** Projected Tolerance Zone: the zone symbol after the height. */
  readonly projectedZone: boolean;
  readonly datumIdentifier: string;
}

/**
 * The geometric characteristics, as the Symbol dialog lays them out (AutoCAD 2024 Help, "Symbol
 * Dialog Box"), with their GDT font letters.
 */
export const GDT_CHARACTERISTICS: readonly { readonly letter: string; readonly name: string }[] = [
  { letter: 'j', name: 'Position' },
  { letter: 'r', name: 'Concentricity' },
  { letter: 'i', name: 'Symmetry' },
  { letter: 'f', name: 'Parallelism' },
  { letter: 'b', name: 'Perpendicularity' },
  { letter: 'a', name: 'Angularity' },
  { letter: 'g', name: 'Cylindricity' },
  { letter: 'c', name: 'Flatness' },
  { letter: 'e', name: 'Circularity or roundness' },
  { letter: 'u', name: 'Straightness' },
  { letter: 'd', name: 'Profile of a surface' },
  { letter: 'k', name: 'Profile of a line' },
  { letter: 'h', name: 'Circular runout' },
  { letter: 't', name: 'Total runout' },
];

/** The Material Condition dialog's choices (AutoCAD 2024 Help, "Material Condition Dialog Box"). */
export const GDT_MATERIALS: readonly { readonly letter: GdtMaterial; readonly name: string }[] = [
  { letter: 'm', name: 'At maximum material condition (MMC)' },
  { letter: 'l', name: 'At least material condition (LMC)' },
  { letter: 's', name: 'Regardless of feature size (RFS)' },
];

/** The GDT font letters for the diameter and projected tolerance zone symbols. */
const DIAMETER = 'n';
const ZONE = 'p';

const NO_TOLERANCE: GdtTolerance = { diameter: false, value: '', material: '' };
const NO_DATUM: GdtDatum = { value: '', material: '' };
const EMPTY_ROW: GdtRow = {
  symbol: '',
  tolerance1: NO_TOLERANCE,
  tolerance2: NO_TOLERANCE,
  datum1: NO_DATUM,
  datum2: NO_DATUM,
  datum3: NO_DATUM,
};

/** The dialog as TOLERANCE opens it: every field empty. */
export const EMPTY_GDT_FRAME: GdtFrame = {
  rows: [EMPTY_ROW, EMPTY_ROW],
  height: '',
  projectedZone: false,
  datumIdentifier: '',
};

/** A GDT font letter as TOLERANCE text writes it. */
const gdt = (letter: string) => `{\\Fgdt;${letter}}`;

function toleranceCode(t: GdtTolerance): string {
  return `${t.diameter ? gdt(DIAMETER) : ''}${t.value}${t.material ? gdt(t.material) : ''}`;
}

const datumCode = (d: GdtDatum): string => `${d.value}${d.material ? gdt(d.material) : ''}`;

function rowCode(r: GdtRow): string {
  return [
    r.symbol ? gdt(r.symbol) : '',
    toleranceCode(r.tolerance1),
    toleranceCode(r.tolerance2),
    datumCode(r.datum1),
    datumCode(r.datum2),
    datumCode(r.datum3),
  ].join('%%v');
}

const EMPTY_ROW_CODE = rowCode(EMPTY_ROW);

/** The TOLERANCE text (DXF 1, rows split by newlines) for `frame`; '' when it is empty. */
export function toleranceText(frame: GdtFrame): string {
  const rows = frame.rows.map(rowCode);
  // Trailing empty rows are left out; an empty first row before a second keeps its place.
  while (rows.length > 0 && rows.at(-1) === EMPTY_ROW_CODE) rows.pop();
  const zone = `${frame.height}${frame.projectedZone ? gdt(ZONE) : ''}`;
  return [...rows, zone, frame.datumIdentifier].filter((l) => l !== '').join('\n');
}

/** A GDT font switch for one letter, braced or not (`{\Fgdt;j}`, `\Fgdt;j`). */
const GDT_CODE = /^\{?\\fgdt;([a-z])\}?/i;
const GDT_CODE_END = /\{?\\fgdt;([a-z])\}?$/i;

/** Splits a leading GDT letter off `s`. */
function leading(s: string): [string, string] {
  const m = GDT_CODE.exec(s);
  return m ? [m[1]!.toLowerCase(), s.slice(m[0].length)] : ['', s];
}

/** Splits a trailing GDT letter off `s`. */
function trailing(s: string): [string, string] {
  const m = GDT_CODE_END.exec(s);
  return m ? [s.slice(0, m.index), m[1]!.toLowerCase()] : [s, ''];
}

const asMaterial = (letter: string): GdtMaterial | undefined =>
  letter === 'm' || letter === 'l' || letter === 's' ? letter : undefined;

function readDatum(code: string): GdtDatum {
  const [value, letter] = trailing(code);
  const material = asMaterial(letter);
  return material ? { value, material } : { value: code, material: '' };
}

function readTolerance(code: string): GdtTolerance {
  const [first, rest] = leading(code);
  const diameter = first === DIAMETER;
  const d = readDatum(diameter ? rest : code);
  return { diameter, value: d.value, material: d.material };
}

function readRow(line: string): GdtRow {
  const c = line.split(/%%v/i);
  const [letter, rest] = leading(c[0] ?? '');
  return {
    symbol: rest === '' ? letter : '',
    tolerance1: readTolerance(c[1] ?? ''),
    tolerance2: readTolerance(c[2] ?? ''),
    datum1: readDatum(c[3] ?? ''),
    datum2: readDatum(c[4] ?? ''),
    datum3: readDatum(c[5] ?? ''),
  };
}

/** A line after the rows that is the zone: it ends with the zone symbol or is a number. */
function isZone(line: string): boolean {
  const [value, letter] = trailing(line);
  return letter === ZONE || (value.trim() !== '' && Number.isFinite(Number(value)));
}

function readZone(line: string): Pick<GdtFrame, 'height' | 'projectedZone'> {
  const [value, letter] = trailing(line);
  return letter === ZONE
    ? { height: value, projectedZone: true }
    : { height: line, projectedZone: false };
}

/** The dialog's fields for a TOLERANCE's text (newlines or `^J` between lines). */
export function toleranceFrame(text: string): GdtFrame {
  const lines = text.split(/\r?\n|\^J/).filter((l) => l !== '');
  const rowLines = lines.filter((l) => /%%v/i.test(l));
  const rest = lines.filter((l) => !/%%v/i.test(l));
  const rows: [GdtRow, GdtRow] = [
    rowLines[0] !== undefined ? readRow(rowLines[0]) : EMPTY_ROW,
    rowLines[1] !== undefined ? readRow(rowLines[1]) : EMPTY_ROW,
  ];
  let zone: Pick<GdtFrame, 'height' | 'projectedZone'> = { height: '', projectedZone: false };
  let datumIdentifier = '';
  if (rest.length >= 2) {
    zone = readZone(rest[0]!);
    datumIdentifier = rest[1]!;
  } else if (rest.length === 1) {
    if (isZone(rest[0]!)) zone = readZone(rest[0]!);
    else datumIdentifier = rest[0]!;
  }
  return { rows, ...zone, datumIdentifier };
}
