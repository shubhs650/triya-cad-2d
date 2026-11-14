// M2-45 part 3: the Publish dialog's sheet list saved and loaded. AutoCAD 2024 Help, "Publish
// Dialog Box": Save Sheet List writes the list as a DSD file and Load Sheet List reads one back,
// asking to replace or append when the dialog lists sheets already. A sheet whose drawing is not
// open stays listed as "Drawing file not found" until Add Sheets supplies that drawing.
import { describe, expect, it } from 'vitest';
import { publishSheets, type PublishSheet } from '../src/publish';
import {
  appendedSheets,
  listedSheets,
  readSheetList,
  sheetKey,
  sheetListName,
  withDrawingFound,
  writeSheetList,
  type ListedDrawing,
} from '../src/sheet-list';

const plan: ListedDrawing = {
  doc: 1,
  drawing: 'plan.dxf',
  spaces: [
    { name: 'Model', block: '1F' },
    { name: 'Layout1', block: '58', applied: 'A3 Monochrome' },
    { name: 'Layout2', block: '5E' },
  ],
  pageSetups: (block) => (block === '1F' ? ['Model plot'] : ['A3 Monochrome', 'A1 Colour']),
};

const site: ListedDrawing = {
  doc: -1,
  drawing: 'Site.DWG',
  spaces: [
    { name: 'Model', block: '2A' },
    { name: 'Sheet A', block: '70' },
  ],
  pageSetups: () => [],
};

const OPTIONS = { device: 'pdf', dpi: 150, viewFile: false, log: false } as const;

describe('writeSheetList', () => {
  it('writes a DSD: a sheet section each with its drawing, layout and page setup, CRLF lines', () => {
    const [model, layout1, layout2] = publishSheets(plan.drawing, plan.spaces, plan.doc);
    const sheets: PublishSheet[] = [
      model!,
      { ...layout1!, pageSetup: 'A1 Colour' },
      { ...layout2!, include: false },
    ];
    const text = writeSheetList(sheets, { ...OPTIONS, viewFile: true });
    expect(text.endsWith('\r\n')).toBe(true);
    const lines = text.split('\r\n');
    expect(lines.slice(0, 4)).toEqual([
      '[DWF6Version]',
      'Ver=1',
      '[DWF6MinorVersion]',
      'MinorVer=1',
    ]);
    const at = lines.indexOf('[DWF6Sheet:plan-Layout1]');
    expect(lines.slice(at, at + 7)).toEqual([
      '[DWF6Sheet:plan-Layout1]',
      'DWG=plan.dxf',
      'Layout=Layout1',
      'Setup=A1 Colour',
      'OriginalSheetPath=plan.dxf',
      'Has Plot Port=0',
      'Has3DDWF=0',
    ]);
    // Its own page setup ("<Default: …>") is an empty Setup, as AutoCAD writes it.
    expect(lines[lines.indexOf('[DWF6Sheet:plan-Model]') + 3]).toBe('Setup=');
    // A sheet not included says so; one included writes nothing extra.
    const l2 = lines.indexOf('[DWF6Sheet:plan-Layout2]');
    expect(lines.slice(l2, l2 + 8)).toContain('Include=FALSE');
    expect(lines.filter((l) => l.startsWith('Include='))).toEqual(['Include=FALSE']);
    expect(lines).toContain('ViewFile=TRUE');
    expect(lines).toContain('PlotStampOn=FALSE');
    expect(sheetListName('plan.dxf')).toBe('plan.dsd');
  });

  it('round-trips through readSheetList with the publish options', () => {
    const sheets = publishSheets(plan.drawing, plan.spaces, plan.doc).map((s, i) =>
      i === 1 ? { ...s, pageSetup: 'A1 Colour', include: false } : s,
    );
    const options = { device: 'png', dpi: 300, viewFile: true, log: true } as const;
    const read = readSheetList(writeSheetList(sheets, options));
    expect(read.options).toEqual(options);
    expect(read.entries).toEqual([
      { drawing: 'plan.dxf', layout: 'Model', include: true },
      { drawing: 'plan.dxf', layout: 'Layout1', pageSetup: 'A1 Colour', include: false },
      { drawing: 'plan.dxf', layout: 'Layout2', include: true },
    ]);
  });
});

describe('readSheetList', () => {
  // A list as AutoCAD writes one (its documented keys, typed by hand): full Windows paths, a
  // named page setup with the drawing it comes from, sections Triya does not use.
  const AUTOCAD = [
    '\ufeff[DWF6Version]',
    'Ver=1',
    '[DWF6MinorVersion]',
    'MinorVer=1',
    '[DWF6Sheet:plan-Model]',
    'DWG=C:\\Projects\\Job 12\\plan.dxf',
    'Layout=Model',
    'Setup=',
    'OriginalSheetPath=C:\\Projects\\Job 12\\plan.dxf',
    'Has Plot Port=0',
    'Has3DDWF=0',
    '[DWF6Sheet:plan-Layout1]',
    'DWG=C:\\Projects\\Job 12\\plan.dxf',
    'Layout=layout1',
    'Setup=A3 Monochrome|C:\\Projects\\Job 12\\plan.dxf',
    'OriginalSheetPath=C:\\Projects\\Job 12\\plan.dxf',
    'Has Plot Port=0',
    'Has3DDWF=0',
    '[DWF6Sheet:Site-Sheet A]',
    'DWG=/home/me/site.dwg',
    'Layout=Sheet A',
    'Setup=',
    '[Target]',
    'Type=6',
    'DWF=C:\\Projects\\Job 12\\plan.pdf',
    '[SheetSet Properties]',
    'IsSheetSet=FALSE',
    '; a comment',
    'ViewFile=TRUE',
    '',
  ].join('\r\n');

  it("reads AutoCAD's lists: the file name of each path, the setup's name before its |", () => {
    const read = readSheetList(AUTOCAD);
    expect(read.entries).toEqual([
      { drawing: 'plan.dxf', layout: 'Model', include: true },
      { drawing: 'plan.dxf', layout: 'layout1', pageSetup: 'A3 Monochrome', include: true },
      { drawing: 'site.dwg', layout: 'Sheet A', include: true },
    ]);
    expect(read.options).toEqual({ viewFile: true });
  });

  it('reads LF lines and ignores what it does not know', () => {
    const read = readSheetList(
      '[DWF6Sheet:x]\nLayout=Model\nDWG=a.dxf\n[Triya]\nPublishTo=Plotter\nResolution=abc\n',
    );
    expect(read.entries).toEqual([{ drawing: 'a.dxf', layout: 'Model', include: true }]);
    expect(read.options).toEqual({});
  });

  it('refuses a file that lists no sheets', () => {
    expect(() => readSheetList('hello')).toThrow(/no sheets/);
    expect(() => readSheetList('[DWF6Sheet:x]\nLayout=Model\n')).toThrow(/no drawing/);
  });
});

describe('listedSheets', () => {
  it('lists each entry as a sheet of the drawing open or added under its file name, any case', () => {
    const read = readSheetList(
      writeSheetList(
        [
          ...publishSheets(site.drawing, site.spaces, site.doc).reverse(),
          { ...publishSheets(plan.drawing, plan.spaces, plan.doc)[1]!, pageSetup: 'A1 Colour' },
        ],
        OPTIONS,
      ).replaceAll('Site.DWG', 'site.dwg'),
    );
    const sheets = listedSheets(read.entries, [plan, site]);
    expect(sheets.map((s) => [s.doc, s.block, s.sheet, s.pageSetup])).toEqual([
      [-1, '70', 'Site-Sheet A', undefined],
      [-1, '2A', 'Site-Model', undefined],
      [1, '58', 'plan-Layout1', 'A1 Colour'],
    ]);
    // The applied page setup still names <Default: …>.
    expect(sheets[2]!.applied).toBe('A3 Monochrome');
    expect(sheets.every((s) => s.missing === undefined)).toBe(true);
  });

  it('keeps a page setup only when the drawing has it, of the sheet’s kind', () => {
    const sheets = listedSheets(
      [
        { drawing: 'plan.dxf', layout: 'Model', pageSetup: 'A1 Colour', include: true },
        { drawing: 'plan.dxf', layout: 'Layout2', pageSetup: 'Gone', include: true },
        { drawing: 'plan.dxf', layout: 'LAYOUT1', pageSetup: 'A1 Colour', include: false },
      ],
      [plan],
    );
    expect(sheets.map((s) => [s.name, s.pageSetup, s.include])).toEqual([
      ['Model', undefined, true],
      ['Layout2', undefined, true],
      ['Layout1', 'A1 Colour', false],
    ]);
  });

  it('lists the sheets of a drawing not open as not found, and a layout it lacks as not found', () => {
    const sheets = listedSheets(
      [
        { drawing: 'shed.dxf', layout: 'Model', include: true },
        { drawing: 'shed.dxf', layout: 'Roof', pageSetup: 'A1', include: false },
        { drawing: 'plan.dxf', layout: 'Layout9', include: true },
      ],
      [plan],
    );
    expect(sheets.map((s) => [s.sheet, s.name, s.missing, s.pageSetup, s.include])).toEqual([
      ['shed-Model', 'Model', 'Drawing file not found', undefined, true],
      ['shed-Roof', 'Roof', 'Drawing file not found', 'A1', false],
      ['plan-Layout9', 'Layout9', 'Layout not found', undefined, true],
    ]);
    // Each has its own key, apart from any sheet that was found.
    expect(new Set(sheets.map(sheetKey)).size).toBe(3);
    // Saved again, they keep their drawing, layout and page setup.
    const again = readSheetList(writeSheetList(sheets, OPTIONS)).entries;
    expect(again).toEqual([
      { drawing: 'shed.dxf', layout: 'Model', include: true },
      { drawing: 'shed.dxf', layout: 'Roof', pageSetup: 'A1', include: false },
      { drawing: 'plan.dxf', layout: 'Layout9', include: true },
    ]);
  });

  it('lists a sheet named twice once', () => {
    const e = { drawing: 'plan.dxf', layout: 'Model', include: true };
    expect(listedSheets([e, e], [plan])).toHaveLength(1);
    const m = { drawing: 'shed.dxf', layout: 'Model', include: true };
    expect(listedSheets([m, m], [plan])).toHaveLength(1);
  });
});

describe('withDrawingFound', () => {
  it('finds the sheets of a drawing not found once Add Sheets supplies it, keeping their order', () => {
    const sheets = listedSheets(
      [
        { drawing: 'site.dwg', layout: 'Sheet A', pageSetup: 'Nope', include: false },
        { drawing: 'plan.dxf', layout: 'Model', include: true },
        { drawing: 'SITE.dwg', layout: 'Model', include: true },
      ],
      [plan],
    );
    expect(sheets.filter((s) => s.missing)).toHaveLength(2);
    const found = withDrawingFound(sheets, site);
    expect(found.map((s) => [s.doc, s.block, s.sheet, s.include, s.missing])).toEqual([
      [-1, '70', 'Site-Sheet A', false, undefined],
      [1, '1F', 'plan-Model', true, undefined],
      [-1, '2A', 'Site-Model', true, undefined],
    ]);
    // Another drawing leaves the list as it was.
    expect(withDrawingFound(sheets, { ...site, drawing: 'other.dwg' })).toEqual(sheets);
  });
});

describe('appendedSheets', () => {
  it('appends the sheets not listed already', () => {
    const current = publishSheets(plan.drawing, plan.spaces, plan.doc).slice(0, 2);
    const loaded = listedSheets(
      [
        { drawing: 'plan.dxf', layout: 'Layout1', include: false },
        { drawing: 'plan.dxf', layout: 'Layout2', include: true },
        { drawing: 'shed.dxf', layout: 'Model', include: true },
      ],
      [plan],
    );
    const out = appendedSheets(current, loaded);
    expect(out.map((s) => s.sheet)).toEqual([
      'plan-Model',
      'plan-Layout1',
      'plan-Layout2',
      'shed-Model',
    ]);
    // The one listed already keeps its own check.
    expect(out[1]!.include).toBe(true);
  });
});
