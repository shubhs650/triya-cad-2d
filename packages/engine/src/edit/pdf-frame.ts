// PDFFRAME (M5-04 part 17), as AutoCAD 2024 Help, "PDFFRAME (System Variable)": "Determines
// whether the PDF underlay frame is visible." Saved in the drawing, initially 1:
//
//   0  The frame is not displayed and not plotted (it shows while the underlay is selected or
//      under the pickbox, as the selection's outline)
//   1  Displayed and plotted
//   2  Displayed but not plotted
//
// DXF has no HEADER variable for it (DWFFRAME and DGNFRAME have theirs), so Triya keeps it as
// FIELDEVAL and the CENTER* variables are kept: a DICTIONARYVAR (text) of the drawing's
// AcDbVariableDictionary, which a save writes only when the drawing has that entry (DEC-077).
import type { HeaderValue } from '../model/types';

/** PDFFRAME's name, the drawing's DICTIONARYVAR. */
export const PDFFRAME = 'PDFFRAME';

/** 0 frame hidden, 1 shown and plotted, 2 shown but not plotted. */
export type PdfFrame = 0 | 1 | 2;

/** PDFFRAME's initial value: the frame shown and plotted. */
export const PDFFRAME_INITIAL: PdfFrame = 1;

/** PDFFRAME as the drawing's header holds it; the initial 1 when it holds none, or nonsense. */
export function pdfFrame(header: ReadonlyMap<string, HeaderValue>): PdfFrame {
  const v = header.get(PDFFRAME);
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return n === 0 || n === 1 || n === 2 ? n : PDFFRAME_INITIAL;
}
