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
// Glyphs and hatch pattern lines plot continuous whatever the linetype, as AutoCAD draws them.
// Model space is tessellated by the renderer (`tessellate`, with the bundled fonts, so ROMANS
// text plots as stroke paths) and each object's plot properties come from `PlotResolver`, as
// the PLOT dialog (M2-17) will plot a layout. Block references are the plot job's (M2-17).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Color, DocumentModel, Entity } from '@triya/engine';
import { readCadDocument } from '@triya/io';
import {
  PdfDocument,
  mmToPoints,
  paperSize,
  paperTransform,
  plotItems,
  type PlotItem,
  type PlotPixels,
} from '@triya/pdf';
import {
  CTB_STYLE_COUNT,
  DEFAULT_PLOT_LINEWEIGHTS,
  PlotResolver,
  adjustPixels,
  bundledPlotStyleTable,
  createPaint,
  effectiveLayer,
  mixColors,
  newPlotStyle,
  parseHex,
  resolveLinetype,
  resolveLineweight,
  tessellate,
  tintColor,
  type PlotObject,
  type PlotStyleTable,
  type PrimitiveColor,
  type RenderPrimitive,
} from '@triya/render';
import { bundledFontBook } from '../render/bundled-fonts';
import { corpusDrawing } from '../render/document';

export const SHEET_DIR = fileURLToPath(new URL('../../fixtures/pdf/', import.meta.url));
export const SHEET_DXF = 'plot-sheet.dxf';
export const FILLS_DXF = 'plot-fills.dxf';
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
export function fillsImagePixels(): PlotPixels {
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

const WHITE = [255, 255, 255] as const;

/** A primitive's colour on paper: the foreground (ACI 7) black, the background white. */
function paperRgb(c: PrimitiveColor): readonly [number, number, number] {
  if (c === 'foreground') return [0, 0, 0];
  if (c === 'background') return WHITE;
  const rgb = parseHex(c);
  if (!rgb) throw new Error(`the plot sheet draws no ${c} colour`);
  return rgb;
}

/** A model space as plot items through `resolver`; `images` gives each IMAGEDEF's bitmap. */
export function sheetItems(
  model: DocumentModel,
  resolver: PlotResolver,
  images: (definition: string) => PlotPixels | undefined = () => undefined,
): PlotItem[] {
  const paint = createPaint();
  const text = { fonts: bundledFontBook(), style: (h: string) => model.tables.textStyles.get(h) };
  const space = [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE');
  if (!space) throw new Error('the plot sheet has no model space');
  const items: PlotItem[] = [];
  for (const id of model.blockEntities(space.handle)) {
    const e = model.entity(id)!;
    const p = paint(e, model);
    if (!p) continue;
    const object = plotObject(e, model);
    const props = resolver.resolve(object);
    const solid = { ...props, linetype: { kind: 'object' as const }, fillStyle: 'solid' as const };
    // A gradient's colours plot through the style each colour takes (ours: the help is silent).
    const onPaper = (c: PrimitiveColor) => {
      const [r, g, b] = paperRgb(c);
      const color: Color = { kind: 'rgb', r, g, b };
      return resolver.resolve({ ...object, color }).color;
    };
    for (const prim of tessellate(e.geom, p, { text })) {
      const common = prim.opacity !== undefined ? { opacity: prim.opacity } : {};
      if (prim.kind === 'point') {
        items.push({ kind: 'point', x: prim.x, y: prim.y, paint: props, ...common });
        continue;
      }
      if (prim.kind === 'infinite') {
        items.push({
          kind: 'infinite',
          base: prim.base,
          direction: prim.direction,
          both: prim.both,
          paint: props,
          ...(prim.dashes ? { dashes: prim.dashes } : {}),
          ...common,
        });
        continue;
      }
      items.push(pathItem(prim, props, solid, onPaper, images, common));
    }
  }
  return items;
}

type PathPrimitive = Extract<RenderPrimitive, { kind: 'stroke' | 'fill' }>;

function pathItem(
  prim: PathPrimitive,
  props: ReturnType<PlotResolver['resolve']>,
  solid: ReturnType<PlotResolver['resolve']>,
  onPaper: (c: PrimitiveColor) => readonly [number, number, number],
  images: (definition: string) => PlotPixels | undefined,
  common: { readonly opacity?: number },
): PlotItem {
  if (prim.underlay || prim.missingImage !== undefined) {
    throw new Error('the plot sheet draws no underlays or missing images');
  }
  const base = { kind: prim.kind, ...(prim.evenOdd ? { evenOdd: true } : {}), ...common };
  const g = prim.gradient;
  if (g) {
    const c1 = paperHex(g.colors[0]);
    const c2 = g.tint === undefined ? paperHex(g.colors[1]) : tintColor(c1, g.tint);
    return {
      ...base,
      path: prim.path,
      paint: solid,
      gradient: {
        kind: g.kind,
        frame: g.frame,
        stops: g.stops.map(([offset, mix]) => ({ offset, color: onPaper(mixColors(c1, c2, mix)) })),
      },
    };
  }
  const im = prim.image;
  if (im) {
    const src = images(im.definition);
    if (!src) throw new Error(`the plot sheet has no bitmap for IMAGEDEF ${im.definition}`);
    const data = adjustPixels(
      { width: src.width, height: src.height, data: Uint8ClampedArray.from(src.data) },
      {
        brightness: im.brightness,
        contrast: im.contrast,
        fade: im.fade,
        transparent: im.transparent,
        color: paperRgb(prim.color),
        background: WHITE,
      },
    );
    return {
      ...base,
      path: prim.path,
      paint: solid,
      image: {
        pixels: { width: src.width, height: src.height, data },
        frame: im.frame,
        width: im.width,
        height: im.height,
      },
    };
  }
  const continuous = prim.text !== undefined || prim.hatch !== undefined;
  // A plot style linetype dashes the object's continuous path itself.
  const dashed = props.linetype.kind === 'plot' && !continuous;
  return {
    ...base,
    path: dashed ? (prim.continuous ?? prim.path) : prim.path,
    paint: continuous ? solid : props,
  };
}

/** A gradient colour as hex for mixing, the foreground black. */
function paperHex(c: PrimitiveColor): string {
  const [r, g, b] = paperRgb(c);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A test drawing, read from its committed DXF. */
export function sheetModel(file: string = SHEET_DXF): DocumentModel {
  const bytes = new Uint8Array(readFileSync(`${SHEET_DIR}${file}`));
  return corpusDrawing(readCadDocument(bytes)).model;
}

export const SHEET_PAGES = [
  { label: 'Colour', bookmark: 'Colour (no plot style table)', table: undefined, fills: false },
  {
    label: 'Monochrome',
    bookmark: 'Monochrome (monochrome.ctb)',
    table: 'monochrome',
    fills: false,
  },
  {
    label: 'Plot linetypes',
    bookmark: 'Plot linetypes (screening 40 %)',
    table: 'linetypes',
    fills: false,
  },
  {
    label: 'Fills',
    bookmark: 'Gradients, images, points, XLINE/RAY',
    table: undefined,
    fills: true,
  },
  { label: 'Fill styles', bookmark: 'Fill styles (CTB)', table: 'fillStyles', fills: true },
] as const;

/** The five-page plot of the two drawings, deterministic to the byte. */
export function sheetPdf(
  model: DocumentModel = sheetModel(),
  fills: DocumentModel = sheetModel(FILLS_DXF),
): Uint8Array {
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
    const items = p.fills ? sheetItems(fills, resolver, () => pixels) : sheetItems(model, resolver);
    plotItems(page, items, {
      toPaper: paperTransform(1, { x: 0, y: 0 }, { x: 0, y: 0 }),
      nonIsoScale: table?.applyFactor ? table.scaleFactor : 1,
    });
  }
  return doc.bytes();
}
