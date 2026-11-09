// The PDF writer's test plot (M2-16): the plot sheet drawing (`scripts/pdf/plot-sheet.py`,
// fixtures/pdf/plot-sheet.dxf) plotted 1:1 on A4 landscape three times, as PUBLISH would plot
// three page setups into one PDF, each page labelled and bookmarked:
// 1. "Colour": no plot style table, objects plot with their own colours and lineweights;
// 2. "Monochrome": the bundled monochrome.ctb, everything black;
// 3. "Plot linetypes": a CTB made here whose styles 10–39 plot black with plot style linetypes
//    1–30 (the ladder on the right), and colour 150 (the hatch with the hole) screened to 40 %.
// Glyphs and hatch pattern lines plot continuous whatever the linetype, as AutoCAD draws them.
// Model space is tessellated by the renderer (`tessellate`, with the bundled fonts, so ROMANS
// text plots as stroke paths) and each object's plot properties come from `PlotResolver`, as
// the PLOT dialog (M2-17) will plot a layout. Only what this drawing holds is handled: points,
// XLINEs and block references are the plot job's (M2-17).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocumentModel, Entity } from '@triya/engine';
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
  createPaint,
  effectiveLayer,
  newPlotStyle,
  resolveLinetype,
  resolveLineweight,
  tessellate,
  type PlotObject,
  type PlotStyleTable,
} from '@triya/render';
import { bundledFontBook } from '../render/bundled-fonts';
import { corpusDrawing } from '../render/document';

export const SHEET_DIR = fileURLToPath(new URL('../../fixtures/pdf/', import.meta.url));
export const SHEET_DXF = 'plot-sheet.dxf';
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

/** What an entity plots with before the table: ByLayer resolved (no block references here). */
function plotObject(e: Entity, model: DocumentModel): PlotObject {
  const src = { layers: model.tables.layers, lwDefault: 25 };
  const color =
    e.color.kind === 'byLayer'
      ? (effectiveLayer(e, src)?.color ?? { kind: 'aci' as const, index: 7 })
      : e.color;
  const linetype = resolveLinetype(e, src);
  return {
    color: color.kind === 'aci' ? { kind: 'aci', index: Math.abs(color.index) } : color,
    lineweight: resolveLineweight(e, src),
    ...(linetype ? { linetype } : {}),
  };
}

/** The sheet's model space as plot items through `resolver`. */
export function sheetItems(model: DocumentModel, resolver: PlotResolver): PlotItem[] {
  const paint = createPaint();
  const text = { fonts: bundledFontBook(), style: (h: string) => model.tables.textStyles.get(h) };
  const space = [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE');
  if (!space) throw new Error('the plot sheet has no model space');
  const items: PlotItem[] = [];
  for (const id of model.blockEntities(space.handle)) {
    const e = model.entity(id)!;
    const p = paint(e, model);
    if (!p) continue;
    const props = resolver.resolve(plotObject(e, model));
    const solid = { ...props, linetype: { kind: 'object' as const } };
    for (const prim of tessellate(e.geom, p, { text })) {
      if (prim.kind !== 'stroke' && prim.kind !== 'fill') {
        throw new Error(`the plot sheet draws no ${prim.kind} primitives`);
      }
      const continuous = prim.text !== undefined || prim.hatch !== undefined;
      // A plot style linetype dashes the object's continuous path itself.
      const dashed = props.linetype.kind === 'plot' && !continuous;
      items.push({
        kind: prim.kind,
        path: dashed ? (prim.continuous ?? prim.path) : prim.path,
        paint: continuous ? solid : props,
        ...(prim.evenOdd ? { evenOdd: true } : {}),
        ...(prim.opacity !== undefined ? { opacity: prim.opacity } : {}),
      });
    }
  }
  return items;
}

/** The sheet drawing, read from its committed DXF. */
export function sheetModel(): DocumentModel {
  const bytes = new Uint8Array(readFileSync(`${SHEET_DIR}${SHEET_DXF}`));
  return corpusDrawing(readCadDocument(bytes)).model;
}

export const SHEET_PAGES = [
  { label: 'Colour', bookmark: 'Colour (no plot style table)', table: undefined },
  { label: 'Monochrome', bookmark: 'Monochrome (monochrome.ctb)', table: 'monochrome' },
  { label: 'Plot linetypes', bookmark: 'Plot linetypes (screening 40 %)', table: 'linetypes' },
] as const;

/** The three-page plot of the sheet, deterministic to the byte. */
export function sheetPdf(model: DocumentModel = sheetModel()): Uint8Array {
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
          : undefined;
    const page = doc.addPage(width, height, { label: p.label, bookmark: p.bookmark });
    plotItems(page, sheetItems(model, new PlotResolver(table)), {
      toPaper: paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 }),
      nonIsoScale: table?.applyFactor ? table.scaleFactor : 1,
    });
  }
  return doc.bytes();
}
