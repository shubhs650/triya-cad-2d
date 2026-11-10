// The named page setups test drawing (M2-17 part 6), authored here (Rule 0, DEC-047): an AC1032
// DXF that `pnpm fixtures:page-setups` writes to packages/testkit/fixtures/page-setups/, where the
// app spec (tests/e2e/ui/plot.spec.ts) opens it; fixture.test.ts keeps the committed file in step
// with this generator.
//
// page-setups.dxf: a 400 × 280 frame in model space with a red circle and a blue diagonal in it,
// the Layout1 tab, and three named page setups in ACAD_PLOTSETTINGS, as AutoCAD's Page Setup
// Manager saves them:
// The Model and Layout1 tabs have page setups of their own on ISO A4 (Layout1 landscape at 1:1,
// its Layout area; model space its extents fitted), which the Plot dialog opens on.
// - "A3 Monochrome" (for layouts): ISO A3 edge to edge, landscape, the Layout plot area at 1:1,
//   monochrome.ctb.
// - "Model A1 Fit" (model space, flag 1024): ISO A1 edge to edge, landscape, Extents, fitted and
//   centred, acad.ctb.
// - "Model ANSI B 1:2" (model space): ANSI B in inches, Extents at 1 inch = 2 units (a custom
//   scale), centred, no plot style table.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  Circle,
  Color,
  Layout,
  Line,
  LwPolyline,
  LwPolylineVertex,
  PlotSettings,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

export const PAGE_SETUPS_DXF = 'page-setups.dxf';

/** DXF 70 plot flags. */
const CENTERED = 4;
const STANDARD_SCALE = 16;
const PLOT_STYLES = 32;
const LINEWEIGHTS = 128;
const MODEL_TYPE = 1024;

export interface PageSetupSpec {
  readonly name: string;
  readonly paperSize: string;
  readonly width: number;
  readonly height: number;
  /** DXF 72: 0 inches, 1 millimetres. */
  readonly units: 0 | 1;
  /** DXF 74. */
  readonly plotType: number;
  readonly flags: number;
  /** DXF 75, while flag 16 is on. */
  readonly standardScaleType: number;
  readonly scale: { readonly numerator: number; readonly denominator: number };
  readonly styleSheet: string;
}

export const PAGE_SETUPS: readonly PageSetupSpec[] = [
  {
    name: 'A3 Monochrome',
    paperSize: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
    width: 420,
    height: 297,
    units: 1,
    plotType: 5,
    flags: STANDARD_SCALE | PLOT_STYLES | LINEWEIGHTS,
    standardScaleType: 16,
    scale: { numerator: 1, denominator: 1 },
    styleSheet: 'monochrome.ctb',
  },
  {
    name: 'Model A1 Fit',
    paperSize: 'ISO_full_bleed_A1_(841.00_x_594.00_MM)',
    width: 841,
    height: 594,
    units: 1,
    plotType: 1,
    flags: MODEL_TYPE | CENTERED | STANDARD_SCALE | PLOT_STYLES | LINEWEIGHTS,
    standardScaleType: 0,
    scale: { numerator: 1, denominator: 1 },
    styleSheet: 'acad.ctb',
  },
  {
    name: 'Model ANSI B 1:2',
    paperSize: 'ANSI_full_bleed_B_(17.00_x_11.00_Inches)',
    width: 431.8,
    height: 279.4,
    units: 0,
    plotType: 1,
    flags: MODEL_TYPE | CENTERED | LINEWEIGHTS,
    standardScaleType: 0,
    scale: { numerator: 1, denominator: 2 },
    styleSheet: '',
  },
];

/** The model space frame's corners. */
export const FRAME = { width: 400, height: 280 };

export function pageSetupsDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  const frame = new LwPolyline();
  for (const [x, y] of [
    [0, 0],
    [FRAME.width, 0],
    [FRAME.width, FRAME.height],
    [0, FRAME.height],
  ] as const)
    frame.vertices.push(new LwPolylineVertex(new XY(x, y)));
  frame.isClosed = true;
  const circle = new Circle();
  circle.center = new XYZ(200, 140, 0);
  circle.radius = 100;
  circle.color = Color.red;
  const diagonal = new Line(new XYZ(20, 20, 0), new XYZ(380, 260, 0));
  diagonal.color = Color.blue;
  for (const e of [frame, circle, diagonal]) {
    doc.entities!.add(e);
    e.layer = doc.layers!.tryGetValue('0')!;
  }

  // The tabs, as AutoCAD's own drawings have them (acad-ts adds none to a new document).
  for (const [name, block, tab] of [
    ['Model', doc.modelSpace!, 0],
    ['Layout1', doc.paperSpace!, 1],
  ] as const) {
    const l = new Layout(name);
    l.tabOrder = tab;
    doc.layouts!.add(l);
    l.associatedBlock = block;
    l.pageName = '';
    l.paperSize = 'ISO_full_bleed_A4_(297.00_x_210.00_MM)';
    l.paperWidth = 297;
    l.paperHeight = 210;
    l.paperUnits = 1 as never;
    l.plotType = (tab === 0 ? 1 : 5) as never;
    l.flags = ((tab === 0 ? MODEL_TYPE | CENTERED : 0) |
      STANDARD_SCALE |
      PLOT_STYLES |
      LINEWEIGHTS) as never;
    l.scaledFit = (tab === 0 ? 0 : 16) as never;
  }

  const dict = doc.rootDictionary!.get(CadDictionary.acadPlotSettings) as CadDictionary;
  for (const p of PAGE_SETUPS) {
    const s = new PlotSettings(p.name);
    s.pageName = p.name;
    s.systemPrinterName = 'DWG To PDF.pc3';
    s.paperSize = p.paperSize;
    s.paperWidth = p.width;
    s.paperHeight = p.height;
    s.paperUnits = p.units as never;
    s.plotType = p.plotType as never;
    s.flags = p.flags as never;
    s.scaledFit = p.standardScaleType as never;
    s.numeratorScale = p.scale.numerator;
    s.denominatorScale = p.scale.denominator;
    s.styleSheet = p.styleSheet;
    dict.add(s);
  }
  return writeCadDocument(doc, { format: 'dxf' });
}
