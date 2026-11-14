// M2-56 part 3: PDFOSNAP snaps only to what of a PDF underlay's page shows. On the committed
// layers drawing, pdf.js reads the page's operator list and optional content (as the app's
// pdf.js worker does); the first underlay keeps the PDF's own visibility, so its Draft square
// (off by default) offers nothing, and the second, with Walls turned off by ULAYERS, offers
// only its Notes square.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  osnap,
  OSNAP,
  SpatialIndex,
  toleranceForSize,
  type UnderlaySnapPage,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { underlaySnapFromOperatorList } from '@triya/render';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { LAYER_SQUARES, LAYERS_DXF_NAME, LAYERS_OFF_AT, LAYERS_PDF_NAME } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/underlay/', import.meta.url));

let page: UnderlaySnapPage;
beforeAll(async () => {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(DIR + LAYERS_PDF_NAME)),
    useWasm: false,
    verbosity: 0,
  }).promise;
  const p = await doc.getPage(1);
  page = underlaySnapFromOperatorList(
    await p.getOperatorList(),
    OPS,
    p.getViewport({ scale: 1 }),
    await doc.getOptionalContentConfig(),
  );
  await doc.cleanup();
});

function source() {
  const tol = toleranceForSize(10);
  const { init } = openDocument(
    readCadDocument(new Uint8Array(readFileSync(DIR + LAYERS_DXF_NAME))),
  );
  const model = DocumentModel.create(init);
  const modelSpace = [...model.blocks.values()].find(
    (b) => b.name.toUpperCase() === '*MODEL_SPACE',
  )!.handle;
  return {
    model,
    index: SpatialIndex.build(model, { tol, underlayPage: () => ({ width: 4, height: 3 }) }),
    block: modelSpace,
    tol,
    underlays: () => page,
  };
}

describe('PDFOSNAP and PDF layers (M2-56 part 3)', () => {
  it("reads each square's optional content group from pdf.js", () => {
    expect(page.layers?.groups.map((g) => [g.name, g.on])).toEqual([
      ['Walls', true],
      ['Notes', true],
      ['Draft', false],
    ]);
    // Four edges per square, each square in its own group.
    expect(new Set(page.layers!.lines).size).toBe(3);
    expect(page.lines.length / 4).toBe(12);
  });

  it('snaps END only to the squares each underlay shows', () => {
    const src = source();
    const ends = (at: { x: number; y: number }) =>
      (Object.keys(LAYER_SQUARES) as (keyof typeof LAYER_SQUARES)[]).filter((name) => {
        // The square's lower-left corner: its centre less half its 1 in side.
        const c = LAYER_SQUARES[name];
        const corner = { x: at.x + c.x - 0.5, y: at.y + c.y - 0.5 };
        const [hit] = osnap(src, {
          point: { x: corner.x + 0.02, y: corner.y + 0.01 },
          aperture: 0.1,
          modes: OSNAP.END,
        });
        return hit && Math.hypot(hit.point.x - corner.x, hit.point.y - corner.y) < 1e-9;
      });
    expect(ends({ x: 0, y: 0 })).toEqual(['Walls', 'Notes']);
    expect(ends(LAYERS_OFF_AT)).toEqual(['Notes']);
  });
});
