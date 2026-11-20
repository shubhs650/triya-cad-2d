// M6-05: the Publish dialog's sheet list and output. AutoCAD 2024 Help, "Publish Dialog Box":
// "Include When Adding Sheets" (Model tab, Layout tabs) decides which spaces a drawing's sheets
// are added for; Rename Sheet names a sheet (its bookmark and, as a single-sheet file, its file);
// Publish Options' Type writes one multi-sheet PDF, under the name given, or a PDF a sheet; the
// PDF Options' Create bookmarks puts an outline of the sheets in the file. Each page is labelled
// with its layout's name.
//
// The acceptance's multi-layout PDF structure test plots a drawing of model space and two layouts
// through the render session's plot job, as the dialog does, reorders and leaves out sheets as
// the list says, and reads the published file back with pdf.js: its pages in order, their paper,
// labels and drawings, and its outline.
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { POINTS_PER_MM, RenderSession } from '@triya/render';
import { toleranceForSize, type EntityInit, type Layout } from '@triya/engine';
import {
  drawingInit,
  entity,
  line,
  MODEL,
  PAPER,
  surface,
} from '../../../packages/render/test/fixtures';
import { defaultPlotSettings, PLOT_PDF_OPTIONS } from '../src/plot';
import { plotRequest } from '../src/plot-preview';
import {
  INCLUDE_ALL,
  PUBLISH_FILE_TYPES,
  movedSheet,
  multiSheetFileName,
  publishPdf,
  publishPdfFiles,
  publishSheets,
  renamedSheet,
  sheetSpace,
  withOpenDrawings,
  type PlottedSheet,
  type PublishSheet,
} from '../src/publish';

const PAPER2 = '2A';

const spaces = [
  { name: 'Model', block: MODEL },
  { name: 'Layout1', block: PAPER },
  { name: 'Layout2', block: PAPER2 },
];

describe('Include When Adding Sheets (M6-05)', () => {
  it('adds every space by default, or only the layouts or model space as the checks say', () => {
    const names = (s: readonly PublishSheet[]) => s.map((x) => x.sheet);
    expect(INCLUDE_ALL).toEqual({ model: true, layouts: true });
    expect(names(publishSheets('plan.dxf', spaces))).toEqual([
      'plan-Model',
      'plan-Layout1',
      'plan-Layout2',
    ]);
    expect(names(publishSheets('plan.dxf', spaces, 1, { model: false, layouts: true }))).toEqual([
      'plan-Layout1',
      'plan-Layout2',
    ]);
    expect(names(publishSheets('plan.dxf', spaces, 1, { model: true, layouts: false }))).toEqual([
      'plan-Model',
    ]);
    // Load All Open Drawings adds by the same checks, keeping the sheets listed.
    const listed = publishSheets('plan.dxf', spaces, 1, { model: true, layouts: false });
    const site = { doc: 2, drawing: 'site.dxf', spaces: spaces.slice(0, 2) };
    expect(names(withOpenDrawings(listed, [site], { model: false, layouts: true }))).toEqual([
      'plan-Model',
      'site-Layout1',
    ]);
  });
});

describe('Rename Sheet (M6-05)', () => {
  const sheets = publishSheets('plan.dxf', spaces, 1);

  it('renames the sheet, its name trimmed', () => {
    const out = renamedSheet(sheets, 1, '  A-101 Ground floor ');
    expect(Array.isArray(out) && out.map((s) => s.sheet)).toEqual([
      'plan-Model',
      'A-101 Ground floor',
      'plan-Layout2',
    ]);
    // The sheet keeps its drawing, layout and check.
    expect(Array.isArray(out) && out[1]).toMatchObject({ name: 'Layout1', block: PAPER });
    // Its own name again is no change.
    expect(renamedSheet(sheets, 1, 'plan-Layout1')).toEqual(sheets);
  });

  it('refuses an empty name, a name another sheet has (any case) and a file name’s characters', () => {
    expect(renamedSheet(sheets, 1, '  ')).toBe('A sheet name cannot be empty.');
    expect(renamedSheet(sheets, 1, 'PLAN-layout2')).toBe(
      'A sheet named PLAN-layout2 is listed already.',
    );
    for (const c of ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '[', ']']) {
      expect(renamedSheet(sheets, 0, `A${c}1`)).toBe(
        'A sheet name cannot contain \\ / : * ? " < > | [ or ].',
      );
    }
  });
});

describe('Publish Options: the multi-sheet file name (M6-05)', () => {
  it('offers a single-sheet file and a multi-sheet file', () => {
    expect(PUBLISH_FILE_TYPES.map((t) => t.name)).toEqual([
      'Single-sheet file',
      'Multi-sheet file',
    ]);
  });

  it('names the PDF as given, .pdf added, else after the drawing', () => {
    expect(multiSheetFileName('Job 12 issue', 'plan.dxf')).toBe('Job 12 issue.pdf');
    expect(multiSheetFileName('Job 12.PDF', 'plan.dxf')).toBe('Job 12.PDF');
    expect(multiSheetFileName('a/b:c', 'plan.dxf')).toBe('a_b_c.pdf');
    expect(multiSheetFileName('  ', 'plan.dxf')).toBe('plan.pdf');
  });
});

// The multi-layout PDF structure test (M6-05's acceptance).
describe('a published multi-layout PDF (M6-05)', () => {
  /** Model space's red line; Layout1's blue line; Layout2's green line. */
  const entities: EntityInit[] = [
    entity('50', line(0, 0, 100, 50), { color: { kind: 'aci', index: 1 } }),
    entity('70', line(10, 10, 200, 10), { owner: PAPER, color: { kind: 'aci', index: 5 } }),
    entity('80', line(10, 10, 150, 100), { owner: PAPER2, color: { kind: 'aci', index: 3 } }),
  ];
  const init = drawingInit(entities, { blocks: [{ handle: PAPER2, name: '*Paper_Space0' }] });
  const session = new RenderSession({
    now: () => 0,
    document: {
      init: {
        ...init,
        layouts: [
          ...init.layouts!,
          { handle: 'AC', name: 'Layout2', tabOrder: 2, blockRecord: PAPER2 },
        ],
      },
      block: MODEL,
      tol: toleranceForSize(1000),
    },
    surface: surface('visible'),
    createLayer: () => surface('scene'),
    requestIdle: () => {},
  });

  /** A layout in millimetres on ISO paper of `w` × `h`, 1:1. */
  const layout = (name: string, blockRecord: string, w: number, h: number): Layout =>
    ({
      handle: name,
      name,
      blockRecord,
      tabOrder: 1,
      plot: {
        paperSize: `ISO_(${w}_x_${h}_MM)`,
        paperWidth: w,
        paperHeight: h,
        margins: { left: 0, bottom: 0, right: 0, top: 0 },
        paperUnits: 'millimeters',
        rotation: 0,
        origin: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 },
      },
    }) as unknown as Layout;

  const spaceOf = {
    Model: sheetSpace({ name: 'Model', extents: { minX: 0, minY: 0, maxX: 100, maxY: 50 } }),
    Layout1: sheetSpace({ name: 'Layout1', layout: layout('Layout1', PAPER, 420, 297) }),
    Layout2: sheetSpace({ name: 'Layout2', layout: layout('Layout2', PAPER2, 297, 210) }),
  };

  /** The list's included sheets plotted as the dialog plots them, in its order. */
  const plotted = (list: readonly PublishSheet[]): PlottedSheet[] =>
    list
      .filter((s) => s.include)
      .map((s) => {
        const space = spaceOf[s.name as keyof typeof spaceOf];
        const parts = session.plot({
          block: s.block,
          ...plotRequest(defaultPlotSettings(space), space),
        });
        return { sheet: s.sheet, space, parts };
      });

  /** Each page's paper (mm), label, and the colours it strokes. */
  async function structure(bytes: Uint8Array) {
    const pdf = await getDocument({ data: bytes }).promise;
    const pages: { paper: number[]; colors: string[] }[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const [, , w, h] = page.view as number[];
      const list = await page.getOperatorList();
      const colors = new Set<string>();
      list.fnArray.forEach((fn, k) => {
        if (fn === OPS.setStrokeRGBColor) colors.add((list.argsArray[k] as string[])[0]!);
      });
      pages.push({
        paper: [w!, h!].map((v) => Math.round(v / POINTS_PER_MM)),
        colors: [...colors].filter((c) => c !== '#000000'),
      });
    }
    const outline = await pdf.getOutline();
    const targets = outline
      ? await Promise.all(
          outline.map(async (o) => {
            const dest = (o.dest as unknown[] | null)!;
            return (await pdf.getPageIndex(dest[0] as never)) + 1;
          }),
        )
      : undefined;
    return {
      pages,
      labels: await pdf.getPageLabels(),
      bookmarks: outline?.map((o, i) => [o.title, targets![i]]),
      title: (await pdf.getMetadata()).info as { Title?: string },
    };
  }

  // Layout2 moved before Layout1, Layout1 renamed, model space left out.
  const list = (() => {
    let s = publishSheets('plan.dxf', spaces, 1);
    s = movedSheet(s, 2, -1);
    s = s.map((x) => (x.name === 'Model' ? { ...x, include: false } : x));
    const renamed = renamedSheet(s, 2, 'A-101');
    if (!Array.isArray(renamed)) throw new Error(renamed);
    return renamed;
  })();

  it('writes one multi-sheet PDF: the included sheets in list order, labelled and bookmarked', async () => {
    expect(list.map((s) => [s.sheet, s.include])).toEqual([
      ['plan-Model', false],
      ['plan-Layout2', true],
      ['A-101', true],
    ]);
    const { bytes, failed } = publishPdf(plotted(list), 'Job 12');
    expect(failed).toEqual([]);
    const s = await structure(bytes!);
    expect(s.pages).toEqual([
      { paper: [297, 210], colors: ['#00ff00'] },
      { paper: [420, 297], colors: ['#0000ff'] },
    ]);
    expect(s.labels).toEqual(['Layout2', 'Layout1']);
    expect(s.bookmarks).toEqual([
      ['plan-Layout2', 1],
      ['A-101', 2],
    ]);
    expect(s.title.Title).toBe('Job 12');
  });

  it('leaves the outline out when Create bookmarks is off, the labels kept', async () => {
    const { bytes } = publishPdf(plotted(list), 'Job 12', undefined, {
      ...PLOT_PDF_OPTIONS,
      bookmarks: false,
    });
    const s = await structure(bytes!);
    expect(s.pages).toHaveLength(2);
    expect(s.bookmarks).toBeUndefined();
    expect(s.labels).toEqual(['Layout2', 'Layout1']);
  });

  it('writes a single-sheet PDF a sheet, named after it, each labelled and bookmarked', async () => {
    const all = publishSheets('plan.dxf', spaces, 1);
    const { files, failed } = publishPdfFiles([
      ...plotted(all),
      { sheet: 'plan-Empty', space: { name: 'Empty' }, parts: [] },
    ]);
    expect(failed).toEqual([
      { sheet: 'plan-Empty', message: 'There is nothing to plot in this plot area.' },
    ]);
    expect(files.map((f) => f.name)).toEqual([
      'plan-Model.pdf',
      'plan-Layout1.pdf',
      'plan-Layout2.pdf',
    ]);
    const read = await Promise.all(files.map((f) => structure(f.bytes)));
    expect(read.map((r) => r.pages)).toEqual([
      [{ paper: [297, 210], colors: ['#ff0000'] }],
      [{ paper: [420, 297], colors: ['#0000ff'] }],
      [{ paper: [297, 210], colors: ['#00ff00'] }],
    ]);
    expect(read.map((r) => r.labels)).toEqual([['Model'], ['Layout1'], ['Layout2']]);
    expect(read.map((r) => r.bookmarks)).toEqual([
      [['plan-Model', 1]],
      [['plan-Layout1', 1]],
      [['plan-Layout2', 1]],
    ]);
    expect(read.map((r) => r.title.Title)).toEqual(['plan-Model', 'plan-Layout1', 'plan-Layout2']);
    // Bookmarks off: no outline in any.
    const off = publishPdfFiles(plotted(all), undefined, { ...PLOT_PDF_OPTIONS, bookmarks: false });
    expect((await structure(off.files[0]!.bytes)).bookmarks).toBeUndefined();
  });
});
