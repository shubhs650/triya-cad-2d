// The title-block test drawing (M2-12), authored here (Rule 0, DEC-047): an AC1032 DXF that
// `pnpm fixtures:attributes` writes to packages/testkit/fixtures/attributes/, where the
// revision-table scenario (scenario.test.ts) and the app spec (tests/e2e/ui/attributes.spec.ts)
// read it; fixture.test.ts keeps the committed file in step with this generator.
//
// title-block.dxf: an A3 sheet border (420 × 297) on BORDER and, at (230, 10), the block
// TITLE-BLOCK (180 × 60, drawn on layer 0): its frame and a revision table of three rows
// (number, date, description, by) under the title fields. The block's ATTDEFs: TITLE, DWG_NO,
// SCALE, DRAWN, REV<n>_NO / _DATE / _DESC / _BY for rows 1–3, a multiline NOTES and a constant
// COMPANY. The reference fills the title, number, scale, drafter, revision row 1 and two lines
// of notes; rows 2 and 3 are empty, as a sheet issued once leaves them.
import {
  ACadVersion,
  AttachmentPointType,
  AttributeDefinition,
  AttributeEntity,
  AttributeFlags,
  AttributeType,
  BlockRecord,
  CadDocument,
  Color,
  Insert,
  Layer,
  Line,
  LwPolyline,
  MText,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

export const TITLE_BLOCK_DXF = 'title-block.dxf';
export const TITLE_BLOCK = 'TITLE-BLOCK';
/** Where the sheet places the title block. */
export const TITLE_BLOCK_AT = { x: 230, y: 10 };
/** Rows of the revision table. */
export const REVISION_ROWS = 3;

/** One attribute of the block: its tag, prompt, place in the block, height, and the sheet's value. */
interface Field {
  readonly tag: string;
  readonly prompt: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly height: number;
  readonly value: string;
}

/** The revision table's columns: tag suffix, prompt, x in the block, the sheet's row 1 value. */
const COLUMNS = [
  ['NO', 'Revision', 2, 'A'],
  ['DATE', 'Revision date', 12, '2026-10-01'],
  ['DESC', 'Revision description', 40, 'FIRST ISSUE'],
  ['BY', 'Revised by', 160, 'SP'],
] as const;

/** Row n's baseline in the block: row 1 lowest, as revision tables grow upwards. */
const rowY = (n: number) => 2 + (n - 1) * 6;

export const FIELDS: readonly Field[] = [
  {
    tag: 'TITLE',
    prompt: 'Drawing title',
    at: { x: 42, y: 48 },
    height: 5,
    value: 'PUMP HOUSE GA',
  },
  { tag: 'DWG_NO', prompt: 'Drawing number', at: { x: 42, y: 38 }, height: 3.5, value: 'OET-1001' },
  { tag: 'SCALE', prompt: 'Scale', at: { x: 120, y: 38 }, height: 2.5, value: '1:50' },
  { tag: 'DRAWN', prompt: 'Drawn by', at: { x: 150, y: 38 }, height: 2.5, value: 'SP' },
  ...Array.from({ length: REVISION_ROWS }, (_, i) =>
    COLUMNS.map(([suffix, prompt, x, first]) => ({
      tag: `REV${i + 1}_${suffix}`,
      prompt: `${prompt} ${i + 1}`,
      at: { x, y: rowY(i + 1) },
      height: 2.5,
      value: i === 0 ? first : '',
    })),
  ).flat(),
];

/** The multiline NOTES attribute: its place (top left of its box) and the sheet's value. */
export const NOTES = {
  tag: 'NOTES',
  prompt: 'General notes',
  at: { x: 2, y: 56 },
  height: 2.5,
  value: 'ALL DIMENSIONS IN MM\\PDO NOT SCALE',
};

/** The constant attribute: drawn by every reference, never an ATTRIB. */
export const COMPANY = { tag: 'COMPANY', value: 'OPEN ENGINEERING TOOLS', at: { x: 2, y: 30 } };

function rectangle(x: number, y: number, w: number, h: number): LwPolyline {
  const p = new LwPolyline([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ] as unknown as XY[]);
  p.isClosed = true;
  return p;
}

const line = (x1: number, y1: number, x2: number, y2: number) =>
  new Line(new XYZ(x1, y1, 0), new XYZ(x2, y2, 0));

function definition(tag: string, prompt: string, at: { x: number; y: number }, height: number) {
  const d = new AttributeDefinition();
  d.tag = tag;
  d.prompt = prompt;
  d.insertPoint = new XYZ(at.x, at.y, 0);
  d.height = height;
  return d;
}

function notesText(at: { x: number; y: number }, value: string): MText {
  const m = new MText();
  m.insertPoint = new XYZ(at.x, at.y, 0);
  m.height = NOTES.height;
  m.rectangleWidth = 36;
  m.attachmentPoint = AttachmentPointType.TopLeft;
  m.value = value;
  return m;
}

export function titleBlockDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  // Saved zoomed to the title block, as a drafter filling it in leaves it.
  const active = [...doc.vPorts!].find((v) => v.name.toUpperCase() === '*ACTIVE')!;
  active.center = new XY(TITLE_BLOCK_AT.x + 90, TITLE_BLOCK_AT.y + 30);
  active.viewHeight = 80;
  active.aspectRatio = 1.6;

  const border = new Layer('BORDER');
  border.color = new Color(7);
  doc.layers!.add(border);
  const sheet = rectangle(0, 0, 420, 297);
  doc.entities!.add(sheet);
  sheet.layer = doc.layers!.tryGetValue('BORDER')!;

  const block = new BlockRecord(TITLE_BLOCK);
  doc.blockRecords!.add(block);
  const ref = new Insert(block);
  ref.insertPoint = new XYZ(TITLE_BLOCK_AT.x, TITLE_BLOCK_AT.y, 0);

  const geometry: Entity[] = [
    rectangle(0, 0, 180, 60),
    line(0, 34, 180, 34),
    line(40, 34, 40, 60),
    line(0, 26, 180, 26),
    ...Array.from({ length: REVISION_ROWS - 1 }, (_, i) =>
      line(0, rowY(i + 2) - 2, 180, rowY(i + 2) - 2),
    ),
    ...COLUMNS.slice(1).map(([, , x]) => line(x - 2, 0, x - 2, 26)),
  ];
  for (const e of geometry) block.entities.add(e);

  for (const f of FIELDS) {
    const d = definition(f.tag, f.prompt, f.at, f.height);
    block.entities.add(d);
    const a = new AttributeEntity(d);
    a.insertPoint = new XYZ(f.at.x + TITLE_BLOCK_AT.x, f.at.y + TITLE_BLOCK_AT.y, 0);
    a.value = f.value;
    ref.attributes.push(a);
  }

  const notes = definition(NOTES.tag, NOTES.prompt, NOTES.at, NOTES.height);
  notes.attributeType = AttributeType.MultiLine;
  notes.mText = notesText(NOTES.at, '');
  block.entities.add(notes);
  const notesAt = { x: NOTES.at.x + TITLE_BLOCK_AT.x, y: NOTES.at.y + TITLE_BLOCK_AT.y };
  const notesAttribute = new AttributeEntity(notes);
  notesAttribute.insertPoint = new XYZ(notesAt.x, notesAt.y, 0);
  notesAttribute.attributeType = AttributeType.MultiLine;
  notesAttribute.mText = notesText(notesAt, NOTES.value);
  ref.attributes.push(notesAttribute);

  const company = definition(COMPANY.tag, 'Company', COMPANY.at, 2.5);
  company.flags = AttributeFlags.Constant;
  company.value = COMPANY.value;
  block.entities.add(company);

  doc.entities!.add(ref);
  ref.layer = doc.layers!.tryGetValue('0')!;
  // A reference holds its ATTRIBs without registering them: number them above the seed, as a
  // save from AutoCAD has them.
  for (const a of ref.attributes) a.handle = doc.header!.handleSeed++;
  return writeCadDocument(doc, { format: 'dxf' });
}
