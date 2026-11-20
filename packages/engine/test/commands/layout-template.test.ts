// M6-01 part 4: LAYOUT Template and SAveas (AutoCAD 2024 Help, "LAYOUT (Command)"), and the
// layout templates they carry between drawings (edit/layout-templates.ts).
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  VIEWPORT_NON_RECT_CLIP,
  builtinCommands,
  insertLayoutTemplate,
  layoutTemplate,
  layoutTemplates,
  plotTransparencyOf,
  templateLayoutName,
  type DocumentInit,
  type EntityGeometry,
  type LayoutPlot,
  type LayoutTemplateCopy,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
  type ViewportGeometry,
} from '../../src/index';
import {
  MODEL_SPACE as MODEL,
  PAPER_SPACE as SHEET,
  LAYER_WALLS,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const PLOT: LayoutPlot = {
  paperSize: 'ISO_full_bleed_A3_(420.00_x_297.00_MM)',
  paperWidth: 420,
  paperHeight: 297,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 16 | 32 | 128 | 512,
  standardScaleType: 16,
};

/** PLOT as a template's layout takes it: its standard scale 1:1 as the custom scale 1:1. */
const { standardScaleType: _type, ...CUSTOM } = { ...PLOT, flags: PLOT.flags & ~16 };

const viewport = (over: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 210, y: 148.5 },
  width: 420,
  height: 297,
  id: 1,
  status: 1,
  flags: 557_088,
  viewCenter: { x: 210, y: 148.5 },
  viewHeight: 297,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...over,
});

const square = (x: number, y: number, size: number): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  closed: true,
  vertices: [
    { x, y, bulge: 0 },
    { x: x + size, y, bulge: 0 },
    { x: x + size, y: y + size, bulge: 0 },
    { x, y: y + size, bulge: 0 },
  ],
});

const TITLE = '50';
const SHEET2 = '30';

/**
 * The template drawing: Layout1 an A3 sheet (plot transparency on) holding its paper viewport, a
 * title line on a layer TITLE only it has, a viewport (id 4) freezing WALLS with a VP Color
 * override, and one clipped by a square (id 5); a draw order table draws the line last.
 * "Sheet B" is a second, empty layout.
 */
function templateInit(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      layers: [
        layer('10', '0'),
        {
          ...layer(LAYER_WALLS, 'WALLS'),
          viewportOverrides: [{ viewport: '41', color: { kind: 'aci', index: 1 } }],
        },
        layer(TITLE, 'TITLE'),
      ],
      appIds: [{ handle: '55', name: 'PLOTTRANSPARENCY', flags: 0 }],
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord(SHEET2, '*Paper_Space0')],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: SHEET2, name: '*Paper_Space0', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [
      { handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL },
      {
        handle: '1E',
        name: 'Layout1',
        tabOrder: 1,
        blockRecord: SHEET,
        flags: 3,
        plot: PLOT,
        limits: { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } },
        xdata: [{ appId: '55', values: [{ code: 1071, value: 1 }] }],
      },
      { handle: '31', name: 'Sheet B', tabOrder: 2, blockRecord: SHEET2 },
    ],
    objects: [
      ...(base.objects ?? []),
      {
        handle: '60',
        type: 'SORTENTSTABLE',
        owner: '61',
        block: SHEET,
        entries: [{ entity: '24', sort: '70' }],
      } as never,
    ],
    entities: [
      ...(base.entities ?? []).filter((e) => e.owner !== SHEET),
      entityInit('40', viewport(), { owner: SHEET }),
      entityInit('24', lineGeom(10, 10, 410, 10), { owner: SHEET, layer: TITLE }),
      entityInit(
        '41',
        viewport({
          id: 4,
          status: 3,
          flags: 819_232,
          center: { x: 100, y: 100 },
          width: 80,
          frozenLayers: [LAYER_WALLS],
        }),
        { owner: SHEET },
      ),
      entityInit('42', square(200, 50, 60), { owner: SHEET, reactors: ['43'] }),
      entityInit(
        '43',
        viewport({
          id: 5,
          status: 2,
          flags: 819_232 | VIEWPORT_NON_RECT_CLIP,
          center: { x: 230, y: 80 },
          width: 60,
          height: 60,
          clipBoundary: '42',
        }),
        { owner: SHEET },
      ),
    ],
  };
}

/** The drawing the templates go into: sampleInit (Model, Layout1 with a line). */
function targetModel(): DocumentModel {
  return DocumentModel.create(sampleInit());
}

const sheetOf = (model: DocumentModel, name: string) => {
  const l = model.layouts.find((x) => x.name === name)!;
  return model.blockEntities(l.blockRecord).map((id) => model.entity(id)!);
};

describe('layout templates', () => {
  it('carry a layout, its viewports and what they use into another drawing, in draw order', () => {
    const source = DocumentModel.create(templateInit());
    const copy = layoutTemplate(
      source,
      source.layouts.find((l) => l.name === 'Layout1')!,
    );
    expect(copy.refused.size).toBe(0);
    expect(copy.template.plotTransparency).toBe(true);
    expect(copy.template.withOverrides).toBe(1);
    // Draw order: the line, sorted by 70, is drawn last.
    expect(copy.template.content.entities.map((e) => e.handle)).toEqual([
      '40',
      '41',
      '42',
      '43',
      '24',
    ]);

    const target = targetModel();
    const b = new ChangeSetBuilder(target);
    const name = templateLayoutName(target, 'Layout1');
    expect(name).toBe('Layout1 (2)');
    const made = insertLayoutTemplate(b, target, copy.template, name);
    target.apply(b.build());
    const layout = target.layouts.find((l) => l.handle === made.layout.handle)!;
    expect(layout).toMatchObject({ name: 'Layout1 (2)', tabOrder: 2, flags: 3 });
    expect(layout.plot).toEqual(CUSTOM);
    expect(layout.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 420, y: 297 } });
    expect(plotTransparencyOf(target, layout)).toBe(true);

    const sheet = sheetOf(target, 'Layout1 (2)');
    expect(sheet.map((e) => e.geom.kind)).toEqual([
      'VIEWPORT',
      'VIEWPORT',
      'LWPOLYLINE',
      'VIEWPORT',
      'LINE',
    ]);
    expect(sheet.every((e) => !['40', '41', '42', '43', '24'].includes(e.handle))).toBe(true);
    // The layer TITLE came along; the viewport freezes the target's own WALLS.
    const title = [...target.tables.layers.values()].find((l) => l.name === 'TITLE')!;
    expect(sheet[4]!.layer).toBe(title.handle);
    const vps = sheet
      .filter((e) => e.geom.kind === 'VIEWPORT')
      .map((e) => e.geom as ViewportGeometry);
    expect(vps.map((g) => [g.id, g.status])).toEqual([
      [1, 1],
      [4, 3],
      [5, 2],
    ]);
    expect(vps[1]!.frozenLayers).toEqual([LAYER_WALLS]);
    // The clipped viewport is clipped by the square's copy.
    expect(vps[2]!.clipBoundary).toBe(sheet[2]!.handle);
    expect(sheet[2]!.reactors).toEqual([sheet[3]!.handle]);
    // The WALLS override is not carried.
    expect(target.tables.layers.get(LAYER_WALLS)!.viewportOverrides).toBeUndefined();
  });

  it('a page setup of no paper or limits of no rectangle take the units’ own sheet', () => {
    const source = DocumentModel.create(templateInit());
    const [first] = layoutTemplates(source);
    const template = {
      ...first!.template,
      plot: { ...PLOT, paperWidth: 0, paperHeight: 0 },
      limits: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    };
    const target = targetModel();
    const b = new ChangeSetBuilder(target);
    const made = insertLayoutTemplate(b, target, template, 'Zero');
    expect(made.layout.plot!.paperSize).toBe('ISO_full_bleed_A4_(297.00_x_210.00_MM)');
    expect(made.layout.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 297, y: 210 } });
  });

  it('a page setup plotting a view the drawing lacks plots the layout', () => {
    const source = DocumentModel.create(templateInit());
    const [first] = layoutTemplates(source);
    const template = { ...first!.template, plot: { ...PLOT, plotType: 3, viewName: 'DETAIL' } };
    const target = targetModel();
    const b = new ChangeSetBuilder(target);
    const made = insertLayoutTemplate(b, target, template, 'Detail');
    expect(made.layout.plot!.plotType).toBe(5);
    expect(made.layout.plot!.viewName).toBeUndefined();
  });

  it('a layout in a drawing of other units is not scaled', () => {
    const source = DocumentModel.create({
      ...templateInit(),
      meta: { ...templateInit().meta!, insUnits: 1 },
    });
    const [first] = layoutTemplates(source);
    const target = targetModel();
    const b = new ChangeSetBuilder(target);
    insertLayoutTemplate(b, target, first!.template, 'Inches');
    target.apply(b.build());
    const line = sheetOf(target, 'Inches').find((e) => e.geom.kind === 'LINE')!;
    expect(line.geom).toEqual(lineGeom(10, 10, 410, 10));
  });

  it('SAveas’s new drawing: the layout takes the template in place, renamed', () => {
    const source = DocumentModel.create(templateInit());
    const [first] = layoutTemplates(source);
    const blank = DocumentModel.create({ ...sampleInit(), entities: [] });
    const b = new ChangeSetBuilder(blank);
    const into = blank.layouts.find((l) => l.name === 'Layout1')!;
    insertLayoutTemplate(b, blank, first!.template, 'Layout1', into);
    blank.apply(b.build());
    expect(blank.layouts.map((l) => l.name)).toEqual(['Model', 'Layout1']);
    expect(blank.layouts[1]!.plot).toEqual(CUSTOM);
    expect(sheetOf(blank, 'Layout1')).toHaveLength(5);
  });
});

// ── LAYOUT Template and SAveas at the command line ─────────────────────────────────────────────

const OPTIONS = 'Enter layout option [Copy/Delete/New/Template/Rename/SAveas/Set/?] <Set>:';

function setup(answer: (r: ViewRequest) => ViewReply = () => ({ ok: true })) {
  const model = targetModel();
  const requests: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      requests.push(r);
      return Promise.resolve(answer(r));
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => MODEL });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const names = () => model.layouts.map((l) => `${l.tabOrder}:${l.name}`);
  return { model, bus, log, requests, names };
}

const sourceLayouts = (): readonly LayoutTemplateCopy[] =>
  layoutTemplates(DocumentModel.create(templateInit()));

describe('LAYOUT Template', () => {
  it('Enter opens the dialogs; the layouts picked come in after the last tab, one LAYOUT step', async () => {
    const t = setup((r) =>
      r.op === 'layoutFile'
        ? { ok: true, layoutFile: { name: 'title blocks.dxf', layouts: sourceLayouts() } }
        : { ok: false, message: 'no' },
    );
    await t.bus.script(['LAYOUT']);
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['T']);
    expect(t.bus.promptText).toBe('Enter name of template file <~>:');
    await t.bus.script(['']);
    expect(t.requests).toEqual([{ op: 'layoutFile' }]);
    expect(t.bus.command).toBeUndefined();
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout1 (2)', '3:Sheet B']);
    expect(t.log.slice(-2)).toEqual([
      '1 viewport was inserted without its layer overrides (not saved yet).',
      'Inserted 2 layouts from title blocks.dxf: Layout1 (2), Sheet B.',
    ]);
    expect(t.bus.undo.state.nextUndo).toBe('LAYOUT');
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1']);
  });

  it('the dialogs cancelled insert nothing', async () => {
    const t = setup(() => ({ ok: true }));
    await t.bus.script(['LAYOUT', 'T', '~']);
    expect(t.requests).toEqual([{ op: 'layoutFile' }]);
    expect(t.names()).toEqual(['0:Model', '1:Layout1']);
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('a file named asks for the layouts: Enter takes the first, ? lists them, * takes all', async () => {
    const t = setup((r) =>
      r.op === 'layoutFile' && r.file === 'blocks'
        ? { ok: true, layoutFile: { name: 'blocks.dxf', layouts: sourceLayouts() } }
        : { ok: true },
    );
    await t.bus.script(['LAYOUT', 'T', 'nowhere']);
    expect(t.log.at(-1)).toBe('Cannot find the file "nowhere".');
    expect(t.bus.promptText).toBe('Enter name of template file <~>:');
    await t.bus.script(['blocks']);
    expect(t.requests.at(-1)).toEqual({ op: 'layoutFile', file: 'blocks' });
    expect(t.bus.promptText).toBe('Enter layout name(s) or [?] <Layout1>:');
    await t.bus.script(['?']);
    expect(t.log.slice(-2)).toEqual(['Layout1', 'Sheet B']);
    await t.bus.script(['nope']);
    expect(t.log.at(-1)).toBe('No layout named "nope" in blocks.dxf.');
    await t.bus.script(['sheet b']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Sheet B']);
    expect(t.log.at(-1)).toBe('Inserted 1 layout from blocks.dxf: Sheet B.');
    await t.bus.script(['LAYOUT', 'T', 'blocks', '*']);
    expect(t.names()).toEqual([
      '0:Model',
      '1:Layout1',
      '2:Sheet B',
      '3:Layout1 (2)',
      '4:Sheet B (2)',
    ]);
  });

  it('a file without layouts says so', async () => {
    const t = setup(() => ({ ok: true, layoutFile: { name: 'empty.dxf', layouts: [] } }));
    await t.bus.script(['LAYOUT', 'T', 'empty']);
    expect(t.log.at(-1)).toBe('empty.dxf has no layouts.');
    expect(t.bus.command).toBeUndefined();
  });
});

describe('LAYOUT SAveas', () => {
  it('writes the layout shown by default as a template DXF named after it', async () => {
    const t = setup((r) => (r.op === 'writeBlock' ? { ok: true, file: r.file } : { ok: true }));
    await t.bus.script(['LAYOUT', 'SA']);
    expect(t.bus.promptText).toBe('Enter layout to save to template <Layout1>:');
    await t.bus.script(['Model']);
    expect(t.log.at(-1)).toBe('The Model tab cannot be chosen here.');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Enter template file name <Layout1.dxf>:');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    const r = t.requests.find((x) => x.op === 'writeBlock') as Extract<
      ViewRequest,
      { op: 'writeBlock' }
    >;
    expect(r.file).toBe('Layout1.dxf');
    const layout = r.drawing!.layout!;
    expect(layout.name).toBe('Layout1');
    // The sheet's line, and nothing in the new drawing's model space.
    expect(layout.content.entities.map((e) => e.handle)).toEqual(['24']);
    expect(r.drawing!.content.entities).toEqual([]);
    expect(r.drawing!.header['$MEASUREMENT']).toBeUndefined();
    expect(r.drawing!.header['$INSUNITS']).toBe(4);
    expect(t.log.at(-1)).toBe('Wrote Layout1.dxf.');
  });

  it('a typed file name is a DXF', async () => {
    const t = setup((r) => (r.op === 'writeBlock' ? { ok: true, file: r.file } : { ok: true }));
    await t.bus.script(['LAYOUT', 'SA', 'layout1', 'A3 title.dwt']);
    const r = t.requests.find((x) => x.op === 'writeBlock') as Extract<
      ViewRequest,
      { op: 'writeBlock' }
    >;
    expect(r.file).toBe('A3 title.dxf');
  });
});
