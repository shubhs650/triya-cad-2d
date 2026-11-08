// IMAGEDEF, RASTERVARIABLES and WIPEOUTVARIABLES to Triya (M1-19): an IMAGE's file and pixel
// size, and the IMAGEFRAME / IMAGEQUALITY / WIPEOUTFRAME settings the renderer draws with; and
// PDFDEFINITION (M1-20), the file and page a PDF underlay shows. None has a writer: the save
// refuses an edited one (export.ts `unwritten`) and keeps the original untouched.

import {
  ImageDefinition as AcadImageDefinition,
  PdfUnderlayDefinition as AcadPdfDefinition,
  RasterVariables as AcadRasterVariables,
  WipeoutVariables as AcadWipeoutVariables,
  type CadDocument,
} from '@node-projects/acad-ts';
import type {
  ImageDefinition,
  PdfDefinition,
  RasterVariables,
  WipeoutVariables,
} from '@triya/engine';
import { common, ref, vec2 } from './common';

export type ImageObject = ImageDefinition | RasterVariables | WipeoutVariables | PdfDefinition;

/** The drawing's image definitions and image display settings, by handle. */
export function mapImageObjects(doc: CadDocument): ImageObject[] {
  const out: ImageObject[] = [];
  for (const o of doc.getCadObjects()) {
    const owner = ref(o.owner) ?? '0';
    if (o instanceof AcadImageDefinition) {
      out.push({
        ...common(o),
        type: 'IMAGEDEF',
        owner,
        name: o.name,
        fileName: o.fileName,
        size: vec2(o.size),
        pixelSize: vec2(o.defaultSize),
        loaded: o.isLoaded,
        units: o.units as number,
      });
    } else if (o instanceof AcadRasterVariables) {
      out.push({
        ...common(o),
        type: 'RASTERVARIABLES',
        owner,
        frame: o.isDisplayFrameShown,
        quality: (o.displayQuality as number) === 0 ? 'draft' : 'high',
        units: o.units,
      });
    } else if (o instanceof AcadWipeoutVariables) {
      out.push({ ...common(o), type: 'WIPEOUTVARIABLES', owner, frame: o.displayImageFrame });
    } else if (o instanceof AcadPdfDefinition) {
      out.push({
        ...common(o),
        type: 'PDFDEFINITION',
        owner,
        name: o.name,
        fileName: o.file,
        page: o.page,
      });
    }
  }
  return out.sort((a, b) => parseInt(a.handle, 16) - parseInt(b.handle, 16));
}
