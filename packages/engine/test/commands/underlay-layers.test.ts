// M2-56 part 1: ULAYERS and the Underlay Layers dialog. AutoCAD 2024 Help, "ULAYERS (Command)":
// a PDF underlay's layers are turned on and off per underlay reference and kept in the drawing,
// as the reference's `AdeskUnderlayLayerOverrideData` xdata (one 1000 string per layer off, as
// io reads it, M2-38 part 2). ULAYERS opens the app's dialog on the underlay selected first, and
// OK is one undo step; Properties shows Layer display override Applied or None.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  UNDERLAY_LAYERS_APP,
  builtinCommands,
  propertySheet,
  setUnderlayLayersOff,
  underlayReferences,
  type DocumentInit,
  type EntityGeometry,
  type EntityId,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const underlay = (definition: string, x: number, layersOff?: string[]): EntityGeometry => ({
  kind: 'PDFUNDERLAY',
  definition,
  position: { x, y: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  flags: 2,
  contrast: 100,
  fade: 0,
  clip: [],
  ...(layersOff && { layersOff }),
});

const pdfDef = (handle: string, name: string, fileName: string) => ({
  handle,
  type: 'PDFDEFINITION' as const,
  owner: 'D',
  name,
  fileName,
  page: '1',
});

/**
 * Two underlays of `plan - 1` in model space (the second turns Walls off, with MYAPP xdata
 * before it), one of `site - 2` in the layout, and a line; `withApp` registers the application.
 */
function init(withApp = true): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      appIds: [
        { handle: '30', name: 'ACAD', flags: 0 },
        { handle: '31', name: 'MYAPP', flags: 0 },
        ...(withApp ? [{ handle: '32', name: UNDERLAY_LAYERS_APP.toUpperCase(), flags: 0 }] : []),
      ],
    },
    objects: [
      ...(base.objects ?? []),
      { handle: 'D', type: 'DICTIONARY', owner: 'C' },
      pdfDef('E', 'plan - 1', '..\\plans\\plan.pdf'),
      pdfDef('F', 'site - 2', 'site.pdf'),
    ],
    entities: [
      ...(base.entities ?? []),
      entityInit('50', underlay('E', 0)),
      entityInit(
        '51',
        underlay('E', 20, withApp ? ['Walls'] : undefined),
        withApp
          ? {
              xdata: [
                { appId: '31', values: [{ code: 1000, value: 'keep' }] },
                { appId: '32', values: [{ code: 1000, value: 'Walls' }] },
              ],
            }
          : {},
      ),
      entityInit('52', underlay('F', 0), { owner: PAPER_SPACE }),
    ],
  } as DocumentInit;
}

const idOf = (model: DocumentModel, handle: string): EntityId => model.entityByHandle(handle)!.id;

function setup(
  answer: (r: Extract<ViewRequest, { op: 'underlayLayers' }>) => ViewReply = () => ({ ok: true }),
  model = DocumentModel.create(init()),
) {
  const asked: ViewRequest[] = [];
  const log: string[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r) => {
        asked.push(r);
        if (r.op === 'pick') return Promise.resolve({ ok: true, ids: [idOf(model, '51')] });
        if (r.op === 'underlayLayers') return Promise.resolve(answer(r));
        return Promise.resolve({ ok: false, message: 'no view' });
      },
    },
  });
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { bus, asked, model, log };
}

describe('underlayReferences', () => {
  it("lists model space's and the layouts' underlays, numbering a definition attached twice", () => {
    const model = DocumentModel.create(init());
    expect(underlayReferences(model)).toEqual([
      {
        id: idOf(model, '50'),
        name: 'plan - 1 [1]',
        fileName: '..\\plans\\plan.pdf',
        page: '1',
        layersOff: [],
      },
      {
        id: idOf(model, '51'),
        name: 'plan - 1 [2]',
        fileName: '..\\plans\\plan.pdf',
        page: '1',
        layersOff: ['Walls'],
      },
      { id: idOf(model, '52'), name: 'site - 2', fileName: 'site.pdf', page: '1', layersOff: [] },
    ]);
  });
});

describe('setUnderlayLayersOff', () => {
  it('writes the layers off as 1000 strings of its application, in place among the others', () => {
    const model = DocumentModel.create(init());
    const b = new ChangeSetBuilder(model);
    expect(setUnderlayLayersOff(b, model, idOf(model, '51'), ['Notes', 'Walls', 'Notes'])).toBe(
      true,
    );
    model.apply(b.build());
    const e = model.entityByHandle('51')!;
    expect(e.geom).toMatchObject({ layersOff: ['Notes', 'Walls'] });
    expect(e.xdata).toEqual([
      { appId: '31', values: [{ code: 1000, value: 'keep' }] },
      {
        appId: '32',
        values: [
          { code: 1000, value: 'Notes' },
          { code: 1000, value: 'Walls' },
        ],
      },
    ]);
  });

  it('takes the application off when every layer is on, keeping the other xdata', () => {
    const model = DocumentModel.create(init());
    const b = new ChangeSetBuilder(model);
    expect(setUnderlayLayersOff(b, model, idOf(model, '51'), [])).toBe(true);
    model.apply(b.build());
    const e = model.entityByHandle('51')!;
    expect('layersOff' in e.geom).toBe(false);
    expect(e.xdata).toEqual([{ appId: '31', values: [{ code: 1000, value: 'keep' }] }]);
  });

  it('registers the application when the drawing has none', () => {
    const model = DocumentModel.create(init(false));
    const b = new ChangeSetBuilder(model);
    expect(setUnderlayLayersOff(b, model, idOf(model, '50'), ['Draft'])).toBe(true);
    model.apply(b.build());
    const app = [...model.tables.appIds.values()].find((r) => r.name === UNDERLAY_LAYERS_APP)!;
    expect(app).toBeDefined();
    expect(model.entityByHandle('50')!.xdata).toEqual([
      { appId: app.handle, values: [{ code: 1000, value: 'Draft' }] },
    ]);
    expect(model.entityByHandle('50')!.geom).toMatchObject({ layersOff: ['Draft'] });
  });

  it('refuses what is no PDF underlay, a name xdata cannot hold, and no change', () => {
    const model = DocumentModel.create(init());
    const b = new ChangeSetBuilder(model);
    const line = [...model.entities()].find((e) => e.geom.kind === 'LINE')!;
    expect(setUnderlayLayersOff(b, model, line.id, ['Walls'])).toBe(false);
    expect(setUnderlayLayersOff(b, model, idOf(model, '50'), [''])).toBe(false);
    expect(setUnderlayLayersOff(b, model, idOf(model, '50'), ['x'.repeat(256)])).toBe(false);
    expect(setUnderlayLayersOff(b, model, idOf(model, '50'), ['a\nb'])).toBe(false);
    expect(setUnderlayLayersOff(b, model, idOf(model, '51'), ['Walls'])).toBe(false);
    expect(b.build()).toEqual({});
  });
});

describe('ULAYERS', () => {
  it('opens the Underlay Layers dialog on the first underlay and applies OK as one undo step', async () => {
    const { bus, asked, model } = setup(() => ({
      ok: true,
      underlayLayers: [
        { id: idOf(model, '50'), layersOff: ['Walls', 'Notes'] },
        { id: idOf(model, '51'), layersOff: [] },
        // Unchanged, and no underlay of this drawing: neither is an edit.
        { id: idOf(model, '52'), layersOff: [] },
        { id: 9999 as EntityId, layersOff: ['Walls'] },
      ],
    }));
    await bus.submit('ULAYERS');
    const r = asked.find((q) => q.op === 'underlayLayers');
    expect(r?.op === 'underlayLayers' && r.underlays).toHaveLength(3);
    expect(r && 'current' in r).toBe(false);
    expect(bus.command).toBeUndefined();
    expect(model.entityByHandle('50')!.geom).toMatchObject({ layersOff: ['Walls', 'Notes'] });
    expect('layersOff' in model.entityByHandle('51')!.geom).toBe(false);
    await bus.submit('U');
    expect('layersOff' in model.entityByHandle('50')!.geom).toBe(false);
    expect(model.entityByHandle('51')!.geom).toMatchObject({ layersOff: ['Walls'] });
  });

  it('opens on the underlay selected first (PICKFIRST)', async () => {
    const { bus, asked, model } = setup();
    await bus.pick({ x: 20, y: 0 });
    await bus.submit('ULAYERS');
    expect(asked.find((q) => q.op === 'underlayLayers')).toMatchObject({
      current: idOf(model, '51'),
    });
  });

  it('changes nothing on Cancel, or when OK changed nothing', async () => {
    for (const reply of [
      { ok: true } as const,
      { ok: true, underlayLayers: [] } as const,
      { ok: false, message: 'Cancelled.' } as const,
    ]) {
      const { bus, model } = setup(() => reply);
      const version = model.version;
      await bus.submit('ULAYERS');
      expect(model.version).toBe(version);
      expect(bus.command).toBeUndefined();
    }
  });

  it('says so in a drawing without underlays', async () => {
    const base = sampleInit();
    const { bus, asked, log } = setup(undefined, DocumentModel.create(base));
    await bus.submit('ULAYERS');
    expect(asked).toEqual([]);
    expect(log.at(-1)).toBe('No underlays found in the drawing.');
  });
});

describe('Properties: Layer display override', () => {
  it('reads Applied for an underlay turning layers off, None otherwise, *VARIES* for both', () => {
    const model = DocumentModel.create(init());
    const misc = (handles: string[]) =>
      propertySheet(
        model,
        handles.map((h) => idOf(model, h)),
      )
        .sections.find((s) => s.title === 'Misc')
        ?.rows.find((r) => r.key === 'underlayLayers');
    expect(misc(['51'])).toMatchObject({
      label: 'Layer display override',
      value: 'applied',
      readOnly: true,
      options: [
        { value: 'applied', label: 'Applied' },
        { value: 'none', label: 'None' },
      ],
    });
    expect(misc(['50'])).toMatchObject({ value: 'none' });
    expect(misc(['50', '51'])).toMatchObject({ varies: true });
  });
});
