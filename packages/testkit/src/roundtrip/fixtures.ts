// Small in-memory drawings for round-trip harness tests, authored with acad-ts itself.
import {
  ACadVersion,
  CadDocument,
  Circle,
  ExtendedDataString,
  Layer,
  Line,
  XYZ,
} from '@node-projects/acad-ts';
import { readCadDocument, writeCadDocument } from '@triya/io';

export { ACadVersion };

export function authoredDocument(version: ACadVersion = ACadVersion.AC1032): CadDocument {
  const doc = new CadDocument(version);
  const layer = new Layer('M0-05');
  doc.layers?.add(layer);
  const line = new Line(new XYZ(0, 0, 0), new XYZ(100, 50, 0));
  line.layer = layer;
  doc.entities?.add(line);
  const circle = new Circle();
  circle.center = new XYZ(10, 10, 0);
  circle.radius = 5;
  doc.entities?.add(circle);
  line.extendedData.addByName('ACAD', undefined);
  line.extendedData.getByName('ACAD').records.push(new ExtendedDataString('note'));
  return doc;
}

/** Bytes of `authoredDocument` as ASCII DXF, so tests can read two independent copies. */
export function authoredDxf(version: ACadVersion = ACadVersion.AC1032): Uint8Array {
  return writeCadDocument(authoredDocument(version), { format: 'dxf' });
}

/** Two documents read from the same bytes: structurally identical, separate object graphs. */
export function twinDocuments(
  version: ACadVersion = ACadVersion.AC1032,
): [CadDocument, CadDocument] {
  const bytes = authoredDxf(version);
  return [readCadDocument(bytes), readCadDocument(bytes)];
}

export function entityOfType<T>(doc: CadDocument, name: string): T {
  const found = [...(doc.entities ?? [])].find((e) => e.objectName === name);
  if (!found) throw new Error(`no ${name} in model space`);
  return found as unknown as T;
}
