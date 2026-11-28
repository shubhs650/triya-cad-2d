// An authored drawing holding AutoCAD's own parametric constraints as AutoCAD keeps them (M8-07
// part 2, DEC-047: threads author their test drawings). AutoCAD files the constraints of a plane
// in an ACDBASSOC2DCONSTRAINTGROUP action of the drawing's ACDBASSOCNETWORK (in the
// `ACAD_ASSOCNETWORK` dictionary of the named-object dictionary), with an ACDBASSOCGEOMDEPENDENCY
// on each constrained object, which lists it in its reactors. ObjectARX publishes the classes, not
// their DXF group codes, so the bodies here are illustrative, of AutoCAD's names and shape: the
// tests need Triya to keep whatever they hold, and the Health palette to say they are there.
import { ACadVersion, CadDocument, Line, XYZ } from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

/** The DXF names of the association objects the drawing holds, in the order written. */
export const CONSTRAINT_OBJECT_NAMES = [
  'DICTIONARY',
  'ACDBASSOCNETWORK',
  'ACDBASSOC2DCONSTRAINTGROUP',
  'ACDBASSOCGEOMDEPENDENCY',
  'ACDBASSOCGEOMDEPENDENCY',
] as const;

export interface ConstraintGroupDrawing {
  readonly bytes: Uint8Array;
  /** The two lines constrained (perpendicular, in AutoCAD's group). */
  readonly lines: readonly [string, string];
  /** Handles of the objects in `CONSTRAINT_OBJECT_NAMES`, in that order. */
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
  ['ACDBASSOC2DCONSTRAINTGROUP', 'AcDbAssoc2dConstraintGroup'],
  ['ACDBASSOCGEOMDEPENDENCY', 'AcDbAssocGeomDependency'],
];

/** The drawing as AC1032 ASCII DXF. */
export function constraintGroupDrawing(): ConstraintGroupDrawing {
  const doc = new CadDocument(ACadVersion.AC1032);
  const a = new Line(new XYZ(0, 0, 0), new XYZ(50, 0, 0));
  const b = new Line(new XYZ(0, 0, 0), new XYZ(0, 30, 0));
  doc.entities!.add(a);
  doc.entities!.add(b);

  let text = new TextDecoder().decode(writeCadDocument(doc, { format: 'dxf' }));
  const seed = Number.parseInt(/\$HANDSEED\r?\n\s*5\r?\n([0-9A-F]+)/i.exec(text)![1]!, 16);
  const [dict, network, group, depA, depB] = [0, 1, 2, 3, 4].map((i) => hex(seed + i)) as [
    string,
    string,
    string,
    string,
    string,
  ];
  const [la, lb] = [hex(a.handle), hex(b.handle)];
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
  // Each line lists the dependency on it in its reactors.
  for (const [line, dep] of [
    [la, depA],
    [lb, depB],
  ] as const) {
    text = text.replace(
      new RegExp(`(  0\\r?\\nLINE\\r?\\n  5\\r?\\n${line}\\r?\\n)`),
      `$1${lines(102, '{ACAD_REACTORS', 330, dep, 102, '}')}`,
    );
  }

  const dependency = (h: string, on: string) =>
    lines(0, 'ACDBASSOCGEOMDEPENDENCY', 5, h, 330, group, 100, 'AcDbAssocDependency') +
    lines(90, 2, 90, 0, 290, 1, 290, 0, 290, 1, 90, 0, 330, group, 330, on, 90, 0) +
    lines(100, 'AcDbAssocGeomDependency', 90, 0, 290, 0);
  const objects =
    lines(0, 'DICTIONARY', 5, dict, 330, '1', 100, 'AcDbDictionary', 280, 0, 281, 1) +
    lines(3, 'ACAD_ASSOCNETWORK', 360, network) +
    lines(0, 'ACDBASSOCNETWORK', 5, network, 102, '{ACAD_REACTORS', 330, dict, 102, '}') +
    lines(330, dict, 100, 'AcDbAssocAction', 90, 2, 90, 0, 330, 0, 360, 0, 90, 0, 90, 0) +
    lines(90, 0, 100, 'AcDbAssocNetwork', 90, 0, 90, 1, 90, 1, 360, group, 90, 0) +
    lines(0, 'ACDBASSOC2DCONSTRAINTGROUP', 5, group, 330, network, 100, 'AcDbAssocAction') +
    lines(90, 2, 90, 0, 330, network, 360, 0, 90, 1, 90, 2, 360, depA, 360, depB, 90, 0) +
    lines(100, 'AcDbAssoc2dConstraintGroup', 90, 2, 70, 0, 10, 0, 20, 0, 30, 0) +
    lines(11, 1, 21, 0, 31, 0, 12, 0, 22, 1, 32, 0, 90, 1, 1, 'AcPerpendicularConstraint') +
    dependency(depA, la) +
    dependency(depB, lb);
  text = text.replace(/( {2}0\r?\nENDSEC\r?\n {2}0\r?\nEOF)/, `${objects}$1`);

  return {
    bytes: Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff),
    lines: [la, lb],
    assoc: [dict, network, group, depA, depB],
  };
}
