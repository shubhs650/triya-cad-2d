// PDF layers an underlay turns off (ULAYERS, M2-38 part 2), plotted end to end: the committed
// layers drawing through the plot job (`plotParts`) and the PDF writer, read back by pdf.js,
// whose optional content configuration is what a viewer (and the plot preview) shows. The
// first underlay's page keeps the PDF's own visibility (Draft off by default); the second's
// has Walls off as well, in copies of the groups of its own.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import { PdfDocument, paperTransform, plotItems } from '@triya/pdf';
import { PlotResolver, plotParts } from '@triya/render';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { corpusDrawing } from '../render/document';
import { LAYERS_DXF_NAME, LAYERS_PDF_NAME } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/underlay/', import.meta.url));

describe('plotting the PDF underlay layers drawing (M2-38 part 2)', () => {
  it('plots the second underlay with Walls off and both with Draft off, as pdf.js reads it', async () => {
    const { model } = corpusDrawing(
      readCadDocument(new Uint8Array(readFileSync(DIR + LAYERS_DXF_NAME))),
    );
    const space = [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')!;
    const items = plotParts(model, space.handle, { resolver: new PlotResolver(undefined) });
    const source = new Uint8Array(readFileSync(DIR + LAYERS_PDF_NAME));
    const doc = new PdfDocument();
    plotItems(doc.addPage(595, 842), items, {
      toPaper: paperTransform(1, { x: 0, y: 0 }, { x: -100, y: -200 }),
      underlays: (u) => (u.fileName.endsWith(LAYERS_PDF_NAME) ? source : undefined),
    });
    const pdf = await getDocument({ data: doc.bytes(), useWasm: false }).promise;
    const config = await pdf.getOptionalContentConfig();
    const groups = [...config].map(([, g]) => [g.name, g.visible]);
    expect(groups).toEqual([
      ['Walls', true],
      ['Notes', true],
      ['Draft', false],
      ['Walls', false],
      ['Notes', true],
      ['Draft', false],
    ]);
    await pdf.cleanup();
  });

  // M2-60: Save As PDF's "Include layer information": the drawing's layers come first, on, and
  // the underlays' own PDF layers keep their place and visibility after them.
  it('lists the drawing’s layers before the underlays’ when layer information is included', async () => {
    const { model } = corpusDrawing(
      readCadDocument(new Uint8Array(readFileSync(DIR + LAYERS_DXF_NAME))),
    );
    const space = [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')!;
    const items = plotParts(model, space.handle, { resolver: new PlotResolver(undefined) });
    const named = [...new Set(items.map((i) => i.layer))].filter((l) => l !== undefined);
    expect(named.length).toBeGreaterThan(0);
    const source = new Uint8Array(readFileSync(DIR + LAYERS_PDF_NAME));
    const doc = new PdfDocument();
    plotItems(doc.addPage(595, 842), items, {
      toPaper: paperTransform(1, { x: 0, y: 0 }, { x: -100, y: -200 }),
      underlays: (u) => (u.fileName.endsWith(LAYERS_PDF_NAME) ? source : undefined),
      layers: true,
    });
    const pdf = await getDocument({ data: doc.bytes(), useWasm: false }).promise;
    const config = await pdf.getOptionalContentConfig();
    const groups = [...config].map(([, g]) => [g.name, g.visible]);
    const sorted = [...named].sort((a, b) =>
      a.toUpperCase() === b.toUpperCase()
        ? a < b
          ? -1
          : 1
        : a.toUpperCase() < b.toUpperCase()
          ? -1
          : 1,
    );
    expect(groups).toEqual([
      ...sorted.map((n) => [n, true]),
      ['Walls', true],
      ['Notes', true],
      ['Draft', false],
      ['Walls', false],
      ['Notes', true],
      ['Draft', false],
    ]);
    // The viewer's layer list follows the written order.
    expect(config.getOrder()).toHaveLength(groups.length);
    await pdf.cleanup();
  });
});
