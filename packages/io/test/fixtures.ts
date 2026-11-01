// In-memory drawings for io tests. M0-03 must not depend on the corpus (M0-04), so these
// are authored with acad-ts itself: one LINE and one extra layer per file.
import {
  ACadVersion,
  CadDocument,
  DwgWriter,
  DxfWriter,
  Layer,
  Line,
  XYZ,
} from '@node-projects/acad-ts';

export { ACadVersion };

export const DWG_VERSIONS = [
  ACadVersion.AC1014,
  ACadVersion.AC1015,
  ACadVersion.AC1018,
  ACadVersion.AC1021,
  ACadVersion.AC1024,
  ACadVersion.AC1027,
  ACadVersion.AC1032,
] as const;

export function sampleDocument(version: ACadVersion): CadDocument {
  const doc = new CadDocument(version);
  doc.layers?.add(new Layer('M0-03'));
  const line = new Line(new XYZ(0, 0, 0), new XYZ(100, 50, 0));
  line.layer = doc.layers?.tryGetValue('M0-03') ?? line.layer;
  doc.entities?.add(line);
  return doc;
}

export function sampleDwg(version: ACadVersion): Uint8Array {
  return DwgWriter.writeToBuffer(sampleDocument(version));
}

export function sampleDxf(version: ACadVersion): Uint8Array {
  const chunks: string[] = [];
  DxfWriter.writeToStream({ write: (s: string) => void chunks.push(s) }, sampleDocument(version));
  return ascii(chunks.join(''));
}

/** Byte-per-char encoding; enough for the ASCII fixtures here (no DOM/Node TextEncoder in io). */
export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
}
