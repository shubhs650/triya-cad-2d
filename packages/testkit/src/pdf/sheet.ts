// The PDF writer's test plot (M2-16): the plot sheet drawing (`scripts/pdf/plot-sheet.py`,
// fixtures/pdf/plot-sheet.dxf) plotted 1:1 on A4 landscape three times, as PUBLISH would plot
// three page setups into one PDF, each page labelled and bookmarked:
// 1. "Colour": no plot style table, objects plot with their own colours and lineweights;
// 2. "Monochrome": the bundled monochrome.ctb, everything black;
// 3. "Plot linetypes": a CTB made here whose styles 10–39 plot black with plot style linetypes
//    1–30 (the ladder on the right), and colour 150 (the hatch with the hole) screened to 40 %.
// Then the fills drawing (M2-16 part 2, `scripts/pdf/plot-fills.py`, fixtures/pdf/plot-fills.dxf)
// twice more:
// 4. "Fills": no plot style table: gradients, a clipped transparent raster image, points and
//    XLINE/RAY in their own colours;
// 5. "Fill styles": a CTB that keeps object colours but plots ACI 40–47 with the eight
//    patterned fill styles, and the XLINE and RAY with plot style linetypes.
// Then the text drawing (M2-16 part 3, `scripts/pdf/plot-text.py`, fixtures/pdf/plot-text.dxf):
// 6. "TrueType text": TEXT and MTEXT in the test TrueType font (fonts/truetype.ts), written as
//    text in an embedded subset font, and in its restricted-licence twin, plotted as outlines.
// Then the OpenType drawing (M2-16 part 4, `scripts/pdf/plot-otf.py`, fixtures/pdf/plot-otf.dxf):
// 7. "OpenType text": TEXT and MTEXT in the test font's CFF twins (plain and CID-keyed) and in
//    both faces of a TrueType collection, embedded as CFF and TrueType subsets, and in a CFF font
//    whose licence forbids embedding, plotted as outlines.
// Glyphs and hatch pattern lines plot continuous whatever the linetype, as AutoCAD draws them.
// Model space is turned into plot items by the plot job (`plotParts`, M2-17: the renderer's
// tessellation with the bundled fonts, so ROMANS text plots as stroke paths, and each object's
// plot properties from `PlotResolver`), as the PLOT dialog plots a drawing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocumentModel } from '@triya/engine';
import { readCadDocument } from '@triya/io';
import {
  PdfDocument,
  mmToPoints,
  paperSize,
  paperTransform,
  plotItems,
  type PlotItem,
} from '@triya/pdf';
import {
  CTB_STYLE_COUNT,
  DEFAULT_PLOT_LINEWEIGHTS,
  PlotResolver,
  bundledPlotStyleTable,
  newPlotStyle,
  plotParts,
  type PlotStyleTable,
  type RasterPixels,
} from '@triya/render';
import { parseTtf, parseTtfCollection, type FontBook } from '@triya/text';
import { testCollection } from '../fonts/collection';
import { testTrueType, type TestTrueTypeOptions } from '../fonts/truetype';
import { bundledFontBook } from '../render/bundled-fonts';
import { corpusDrawing } from '../render/document';

export const SHEET_DIR = fileURLToPath(new URL('../../fixtures/pdf/', import.meta.url));
export const SHEET_DXF = 'plot-sheet.dxf';
export const FILLS_DXF = 'plot-fills.dxf';
export const TEXT_DXF = 'plot-text.dxf';
export const OTF_DXF = 'plot-otf.dxf';
export const SHEET_PDF = 'plot-sheet.pdf';

/** The CTB of page 3: colour 9 + k plots black with plot style linetype k; colour 150 at 40 %. */
export function linetypeTable(): PlotStyleTable {
  const styles = Array.from({ length: CTB_STYLE_COUNT }, (_, i) => newPlotStyle(`Color_${i + 1}`));
  for (let k = 1; k <= 30; k++) {
    styles[k + 8] = { ...styles[k + 8]!, color: [0, 0, 0], linetype: k };
  }
  styles[149] = { ...styles[149]!, screening: 40 };
  return {
    kind: 'ctb',
    description: 'M2-16 plot style linetypes',
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: DEFAULT_PLOT_LINEWEIGHTS,
    styles,
  };
}

/**
 * The CTB of page 5: object colours kept; ACI 40 + i plots with fill style i + 1 (Checkerboard
 * … Vertical Bars, `fill_style` 65–72), the dashed XLINE (ACI 3) with plot style linetype 3
 * (Dash Dot) and the RAY (ACI 6) with 6 (Long Dash).
 */
export function fillStyleTable(): PlotStyleTable {
  const styles = Array.from({ length: CTB_STYLE_COUNT }, (_, i) => newPlotStyle(`Color_${i + 1}`));
  for (let i = 0; i < 8; i++) styles[39 + i] = { ...styles[39 + i]!, fillStyle: 65 + i };
  styles[2] = { ...styles[2]!, linetype: 3 };
  styles[5] = { ...styles[5]!, linetype: 6 };
  return {
    kind: 'ctb',
    description: 'M2-16 fill styles',
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: DEFAULT_PLOT_LINEWEIGHTS,
    styles,
  };
}

/**
 * The fills drawing's raster image, made here (its IMAGEDEF names a file that is never read):
 * 64 × 32 pixels, hue across and darker down, with a clear disc and a half-clear band so the
 * line beneath shows through.
 */
export function fillsImagePixels(): RasterPixels {
  const width = 64;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const h = (x / width) * 6;
      const k = 1 - (0.6 * y) / height;
      const ch = (n: number) => {
        const t = (n + h) % 6;
        return Math.round(255 * k * (t < 1 ? t : t < 3 ? 1 : t < 4 ? 4 - t : 0));
      };
      data[i] = ch(0);
      data[i + 1] = ch(4);
      data[i + 2] = ch(2);
      const disc = Math.hypot(x - 46, y - 15) < 8;
      data[i + 3] = disc ? 0 : y >= 12 && y < 18 ? 128 : 255;
    }
  }
  return { width, height, data };
}

/**
 * The bundled stroke fonts and the fonts the text drawings' styles name: the test font as
 * triya-pixel.ttf and its restricted-licence twin as triya-locked.ttf (page 6); its CFF twins,
 * plain, CID-keyed and restricted, and a two-face collection (page 7), read as the app reads a
 * user's font files (`fontBookOf`: a collection's first face by its file name, every face by
 * its family).
 */
export function sheetFontBook(): FontBook {
  const book = bundledFontBook();
  book.addTtf(parseTtf(testTrueType()), 'triya-pixel.ttf');
  book.addTtf(parseTtf(testTrueType({ family: 'Triya Locked', fsType: 2 })), 'triya-locked.ttf');
  const otf = (family: string, o: TestTrueTypeOptions) => testTrueType({ family, ...o });
  const files = [
    { name: 'triya-pixel-cff.otf', bytes: otf('Triya Pixel CFF', { outlines: 'cff' }) },
    { name: 'triya-pixel-cid.otf', bytes: otf('Triya Pixel CID', { outlines: 'cid', dots: true }) },
    {
      name: 'triya-locked-cff.otf',
      bytes: otf('Triya Locked CFF', { outlines: 'cff', fsType: 2 }),
    },
    {
      name: 'triya-pair.ttc',
      bytes: testCollection([
        otf('Triya Pair', { dots: true }),
        otf('Triya Pair Sans', { outlines: 'cff' }),
      ]),
    },
  ];
  for (const { name, bytes } of files) {
    parseTtfCollection(bytes).forEach((face, i) => book.addTtf(face, i === 0 ? name : undefined));
  }
  return book;
}

/**
 * A model space as plot items through `resolver` (the plot job, M2-17); `images` gives each
 * IMAGEDEF's bitmap.
 */
export function sheetItems(
  model: DocumentModel,
  resolver: PlotResolver,
  images: (definition: string) => RasterPixels | undefined = () => undefined,
  fonts: FontBook = sheetFontBook(),
): PlotItem[] {
  const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
  const space = [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE');
  if (!space) throw new Error('the plot sheet has no model space');
  return plotParts(model, space.handle, { resolver, tessellate: { text }, images });
}

/** A test drawing, read from its committed DXF. */
export function sheetModel(file: string = SHEET_DXF): DocumentModel {
  const bytes = new Uint8Array(readFileSync(`${SHEET_DIR}${file}`));
  return corpusDrawing(readCadDocument(bytes)).model;
}

export const SHEET_PAGES = [
  { label: 'Colour', bookmark: 'Colour (no plot style table)', table: undefined, drawing: 'sheet' },
  {
    label: 'Monochrome',
    bookmark: 'Monochrome (monochrome.ctb)',
    table: 'monochrome',
    drawing: 'sheet',
  },
  {
    label: 'Plot linetypes',
    bookmark: 'Plot linetypes (screening 40 %)',
    table: 'linetypes',
    drawing: 'sheet',
  },
  {
    label: 'Fills',
    bookmark: 'Gradients, images, points, XLINE/RAY',
    table: undefined,
    drawing: 'fills',
  },
  { label: 'Fill styles', bookmark: 'Fill styles (CTB)', table: 'fillStyles', drawing: 'fills' },
  {
    label: 'TrueType text',
    bookmark: 'TrueType text (embedded subset fonts)',
    table: undefined,
    drawing: 'text',
  },
  {
    label: 'OpenType text',
    bookmark: 'CFF OpenType and collection text',
    table: undefined,
    drawing: 'otf',
  },
] as const;

/** The seven-page plot of the four drawings, deterministic to the byte. */
export function sheetPdf(
  model: DocumentModel = sheetModel(),
  fills: DocumentModel = sheetModel(FILLS_DXF),
  text: DocumentModel = sheetModel(TEXT_DXF),
  otf: DocumentModel = sheetModel(OTF_DXF),
): Uint8Array {
  const fonts = sheetFontBook();
  const pixels = fillsImagePixels();
  const a4 = paperSize('ISO A4')!;
  // Landscape: the sheet's 297 × 210 mm drawing fills the paper at 1:1.
  const width = mmToPoints(a4.height);
  const height = mmToPoints(a4.width);
  const doc = new PdfDocument({ title: 'Triya plot sheet', creator: 'Triya CAD 2D (M2-16 test)' });
  for (const p of SHEET_PAGES) {
    const table =
      p.table === 'monochrome'
        ? bundledPlotStyleTable('monochrome.ctb')
        : p.table === 'linetypes'
          ? linetypeTable()
          : p.table === 'fillStyles'
            ? fillStyleTable()
            : undefined;
    const page = doc.addPage(width, height, { label: p.label, bookmark: p.bookmark });
    const resolver = new PlotResolver(table);
    const items =
      p.drawing === 'fills'
        ? sheetItems(fills, resolver, () => pixels, fonts)
        : sheetItems(
            p.drawing === 'text' ? text : p.drawing === 'otf' ? otf : model,
            resolver,
            undefined,
            fonts,
          );
    plotItems(page, items, {
      toPaper: paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 }),
      nonIsoScale: table?.applyFactor ? table.scaleFactor : 1,
    });
  }
  return doc.bytes();
}
