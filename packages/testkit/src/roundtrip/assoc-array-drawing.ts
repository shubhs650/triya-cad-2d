// An authored drawing holding an associative rectangular array shaped as AutoCAD keeps one
// (M3-03 part 2, DEC-047: threads author their test drawings). What the DXF reference documents
// is real: the array is one INSERT of an anonymous `*U` block, whose items are INSERTs of a second
// anonymous block holding the source objects. What it does not document (AutoCAD writes the
// ObjectARX `AcDbAssoc*` classes without publishing their DXF group codes) is stood in for by
// objects of AutoCAD's names and shape: an `ACAD_ASSOCNETWORK` dictionary in the named-object
// dictionary, holding an ACDBASSOCNETWORK, whose ACDBASSOCACTION has an ACDBASSOCARRAYACTIONBODY
// and an ACDBASSOCDEPENDENCY on the array, which lists the dependency in its reactors. Their
// bodies are illustrative; the tests only need Triya to keep whatever codes they hold, as it
// keeps every object it does not map.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  Circle,
  Insert,
  Line,
  XYZ,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

/** Where the array is and how it is laid out: 3 columns 20 apart by 2 rows 15 apart. */
export const ASSOC_ARRAY = {
  position: { x: 100, y: 50 },
  columns: 3,
  rows: 2,
  columnSpacing: 20,
  rowSpacing: 15,
} as const;

/** The DXF names of the association objects the drawing holds, in the order written. */
export const ASSOC_OBJECT_NAMES = [
  'DICTIONARY',
  'ACDBASSOCNETWORK',
  'ACDBASSOCACTION',
  'ACDBASSOCARRAYACTIONBODY',
  'ACDBASSOCDEPENDENCY',
] as const;

export interface AssocArrayDrawing {
  readonly bytes: Uint8Array;
  /** The array's INSERT. */
  readonly insert: string;
  /** The array block (`*U…`) and the source block its items insert. */
  readonly arrayBlock: string;
  readonly sourceBlock: string;
  /** Handles of the objects in `ASSOC_OBJECT_NAMES`, in that order. */
  readonly assoc: readonly string[];
}

const hex = (n: number) => n.toString(16).toUpperCase();
const lines = (...pairs: (string | number)[]): string => {
  let out = '';
  for (let i = 0; i < pairs.length; i += 2) {
    out += `${String(pairs[i]).padStart(3)}\n${pairs[i + 1]}\n`;
  }
  return out;
};

const CLASSES: readonly [string, string][] = [
  ['ACDBASSOCNETWORK', 'AcDbAssocNetwork'],
  ['ACDBASSOCACTION', 'AcDbAssocAction'],
  ['ACDBASSOCARRAYACTIONBODY', 'AcDbAssocArrayActionBody'],
  ['ACDBASSOCDEPENDENCY', 'AcDbAssocDependency'],
];

/** The drawing as AC1032 ASCII DXF. */
export function assocArrayDrawing(): AssocArrayDrawing {
  const doc = new CadDocument(ACadVersion.AC1032);
  const source = new BlockRecord('*U1');
  source.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0)));
  const circle = new Circle();
  circle.center = new XYZ(5, 5, 0);
  circle.radius = 3;
  source.entities.add(circle);
  doc.blockRecords!.add(source);
  const array = new BlockRecord('*U2');
  for (let r = 0; r < ASSOC_ARRAY.rows; r++) {
    for (let c = 0; c < ASSOC_ARRAY.columns; c++) {
      const item = new Insert(source);
      item.insertPoint = new XYZ(c * ASSOC_ARRAY.columnSpacing, r * ASSOC_ARRAY.rowSpacing, 0);
      array.entities.add(item);
    }
  }
  doc.blockRecords!.add(array);
  const insert = new Insert(array);
  insert.insertPoint = new XYZ(ASSOC_ARRAY.position.x, ASSOC_ARRAY.position.y, 0);
  doc.entities!.add(insert);

  let text = new TextDecoder().decode(writeCadDocument(doc, { format: 'dxf' }));
  const seed = Number.parseInt(/\$HANDSEED\r?\n\s*5\r?\n([0-9A-F]+)/i.exec(text)![1]!, 16);
  const [dict, network, action, body, dependency] = [0, 1, 2, 3, 4].map((i) => hex(seed + i)) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const ins = hex(insert.handle);
  text = text.replace(/(\$HANDSEED\r?\n\s*5\r?\n)[0-9A-F]+/i, `$1${hex(seed + 5)}`);

  const classes = CLASSES.map(([dxf, cpp]) =>
    lines(0, 'CLASS', 1, dxf, 2, cpp, 3, 'ObjectDBX Classes', 90, 1025, 91, 1, 280, 0, 281, 0),
  ).join('');
  text = text.replace(/( {2}0\r?\nSECTION\r?\n {2}2\r?\nCLASSES\r?\n)/, `$1${classes}`);

  // The named-object dictionary (handle 1) files the network dictionary.
  text = text.replace(
    /( {2}0\r?\nDICTIONARY\r?\n {2}5\r?\n1\r?\n330\r?\n0\r?\n100\r?\nAcDbDictionary\r?\n280\r?\n0\r?\n281\r?\n[01]\r?\n)/,
    `$1${lines(3, 'ACAD_ASSOCNETWORK', 350, dict)}`,
  );
  // The array lists the dependency on it in its reactors.
  text = text.replace(
    new RegExp(`(  0\\r?\\nINSERT\\r?\\n  5\\r?\\n${ins}\\r?\\n)`),
    `$1${lines(102, '{ACAD_REACTORS', 330, dependency, 102, '}')}`,
  );

  const objects =
    lines(0, 'DICTIONARY', 5, dict, 330, '1', 100, 'AcDbDictionary', 280, 0, 281, 1) +
    lines(3, 'ACAD_ASSOCNETWORK', 360, network) +
    lines(0, 'ACDBASSOCNETWORK', 5, network, 102, '{ACAD_REACTORS', 330, dict, 102, '}') +
    lines(330, dict, 100, 'AcDbAssocAction', 90, 2, 90, 0, 330, 0, 360, 0, 90, 0, 90, 0) +
    lines(90, 0, 100, 'AcDbAssocNetwork', 90, 0, 90, 1, 90, 1, 360, action, 90, 0) +
    lines(0, 'ACDBASSOCACTION', 5, action, 330, network, 100, 'AcDbAssocAction', 90, 2) +
    lines(90, 0, 330, network, 360, body, 90, 1, 90, 1, 90, 1, 360, dependency, 90, 0) +
    lines(0, 'ACDBASSOCARRAYACTIONBODY', 5, body, 330, action, 100, 'AcDbAssocActionBody') +
    lines(90, 1, 100, 'AcDbAssocParamBasedActionBody', 90, 0, 90, 0, 90, 0, 90, 0, 90, 0) +
    lines(100, 'AcDbAssocArrayActionBody', 90, 0, 1, 'AcDbAssocArrayRectangularParameters') +
    lines(90, ASSOC_ARRAY.columns, 90, ASSOC_ARRAY.rows, 40, ASSOC_ARRAY.columnSpacing) +
    lines(40, ASSOC_ARRAY.rowSpacing, 330, ins, 330, hex(source.handle)) +
    lines(0, 'ACDBASSOCDEPENDENCY', 5, dependency, 330, action, 100, 'AcDbAssocDependency') +
    lines(90, 2, 90, 0, 290, 1, 290, 0, 290, 1, 90, 0, 330, action, 330, ins, 90, 0);
  text = text.replace(/( {2}0\r?\nENDSEC\r?\n {2}0\r?\nEOF)/, `${objects}$1`);

  return {
    bytes: Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff),
    insert: ins,
    arrayBlock: hex(array.handle),
    sourceBlock: hex(source.handle),
    assoc: [dict, network, action, body, dependency],
  };
}
