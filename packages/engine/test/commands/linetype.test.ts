// M5-08 part 1: loading and deleting linetypes, LINETYPE's Linetype Manager, -LINETYPE and
// LTSCALE, as AutoCAD 2024's (AutoCAD Help, "Linetype Manager", "Load or Reload Linetypes Dialog
// Box", "-LINETYPE (Command)", "LTSCALE (Command)", "About Text in Custom Linetypes"):
//   - a .lin definition loads as an LTYPE record (pattern length the elements' total, text on
//     the STYLE record the .lin names or the current text style; U= is DXF 74 bit 8, A= bit 1);
//     a name the drawing has reloads in place (handle kept) or stays; ByLayer, ByBlock and
//     Continuous never load; a shape linetype is refused (no shape files);
//   - Delete refuses ByLayer, ByBlock, Continuous, the current linetype, xref-dependent ones and
//     linetypes in use (objects, block contents, layers, dimension styles, kept objects);
//   - the manager's OK is one LINETYPE undo step: loads, Current, deletes and the scales.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  deleteLinetypes,
  editLinetypes,
  linetypesInUse,
  loadLinetypes,
  type BusEvent,
  type DialogRequest,
  type DocumentInit,
  type LinetypeDefinition,
  type LinetypeRecord,
  type PromptAnswer,
  type TextStyleRecord,
  type ViewHost,
  type ViewRequest,
} from '../../src/index';
import {
  LAYER_WALLS,
  MODEL_SPACE,
  blockRecord,
  entityInit,
  lineGeom,
  linetype,
  sampleInit,
} from '../model/fixtures';

const style = (handle: string, name: string, font: string, flags = 0): TextStyleRecord => ({
  handle,
  name,
  font,
  flags,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const DASHED = '15';
const HIDDEN = '16';
const XREF_DOT = '17';
const BYLAYER = '18';
const BYBLOCK = '19';
const KEPT = '1A';
const BLOCK = '50';

/** Continuous, DASHED (a line uses it), HIDDEN (unused), an xref's DOT, ByLayer, ByBlock. */
function init(): DocumentInit {
  const s = sampleInit();
  const dashed: LinetypeRecord = {
    ...linetype(DASHED, 'DASHED'),
    description: 'Dashed __ __',
    patternLength: 0.75,
    elements: [
      { length: 0.5, shapeFlags: 0, shapeNumber: 0, offset: { x: 0, y: 0 }, rotation: 0, scale: 1 },
      {
        length: -0.25,
        shapeFlags: 0,
        shapeNumber: 0,
        offset: { x: 0, y: 0 },
        rotation: 0,
        scale: 1,
      },
    ],
  };
  return {
    ...s,
    header: new Map([...(s.header ?? []), ['$TEXTSTYLE', 'Notes'], ['$CELTYPE', 'ByLayer']]),
    tables: {
      ...s.tables,
      linetypes: [
        ...(s.tables?.linetypes ?? []),
        dashed,
        linetype(HIDDEN, 'HIDDEN'),
        { ...linetype(XREF_DOT, 'PLAN|DOT'), flags: 48 },
        linetype(BYLAYER, 'ByLayer'),
        linetype(BYBLOCK, 'ByBlock'),
        linetype(KEPT, 'KEPT'),
      ],
      textStyles: [
        style('30', 'Standard', 'txt.shx'),
        style('31', 'Notes', 'romans.shx'),
        style('32', '', 'ltypeshp.shx', 1),
      ],
      blockRecords: [...(s.tables?.blockRecords ?? []), blockRecord(BLOCK, 'TAG')],
    },
    blocks: [...(s.blocks ?? []), { handle: BLOCK, name: 'TAG', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...(s.entities ?? []),
      entityInit('51', lineGeom(0, 0, 1, 1), { linetype: DASHED }),
      entityInit('52', lineGeom(0, 0, 1, 1), { owner: BLOCK }),
    ],
    passthroughLinetypes: [KEPT],
  };
}

const el = (length: number) => ({ length });
const GAS: LinetypeDefinition = {
  name: 'TRIYA_GAS',
  description: 'Gas line ----GAS----',
  elements: [
    el(0.5),
    {
      length: -0.2,
      embed: {
        kind: 'text',
        text: 'GAS',
        style: 'standard',
        scale: 0.1,
        rotation: 0,
        rotationMode: 'upright',
        offset: { x: -0.1, y: -0.05 },
      },
    },
    el(-0.25),
  ],
};
const CENTER: LinetypeDefinition = {
  name: 'TRIYA_CENTER',
  description: 'Center',
  elements: [el(1.25), el(-0.25), el(0.25), el(-0.25)],
};

const named = (m: DocumentModel, name: string) =>
  [...m.tables.linetypes.values()].find((l) => l.name.toUpperCase() === name.toUpperCase());

describe('loading linetypes (M5-08)', () => {
  it('adds a complex text linetype: elements, pattern length, the named style, U= as bit 8', () => {
    const m = DocumentModel.create(init());
    const b = new ChangeSetBuilder(m);
    const r = loadLinetypes(b, m, [GAS, CENTER]);
    m.apply(b.build());
    expect(r).toEqual({
      loaded: ['TRIYA_GAS', 'TRIYA_CENTER'],
      reloaded: [],
      kept: [],
      refused: [],
    });
    const gas = named(m, 'TRIYA_GAS')!;
    expect(gas).toMatchObject({
      description: 'Gas line ----GAS----',
      alignment: 'A',
      patternLength: 0.95,
    });
    expect(gas.patternLength).toBeCloseTo(0.95, 12);
    expect(gas.elements[1]).toEqual({
      length: -0.2,
      shapeFlags: 2 | 8,
      shapeNumber: 0,
      style: '30',
      offset: { x: -0.1, y: -0.05 },
      rotation: 0,
      scale: 0.1,
      text: 'GAS',
    });
    expect(gas.elements[0]!.shapeFlags).toBe(0);
    // A new handle above the seed.
    expect(parseInt(gas.handle, 16)).toBeGreaterThanOrEqual(0x40);
  });

  it('takes the current text style when the .lin names none, A= as bit 1', () => {
    const m = DocumentModel.create(init());
    const b = new ChangeSetBuilder(m);
    const def: LinetypeDefinition = {
      name: 'T2',
      description: '',
      elements: [
        el(1),
        {
          length: -1,
          embed: {
            kind: 'text',
            text: 'X',
            scale: 1,
            rotation: 0,
            rotationMode: 'absolute',
            offset: { x: 0, y: 0 },
          },
        },
      ],
    };
    loadLinetypes(b, m, [def]);
    m.apply(b.build());
    expect(named(m, 'T2')!.elements[1]).toMatchObject({ shapeFlags: 3, style: '31' });
  });

  it('refuses a missing text style, a shape, ByLayer/Continuous and xref names; keeps or reloads one it has', () => {
    const m = DocumentModel.create(init());
    const b = new ChangeSetBuilder(m);
    const r = loadLinetypes(
      b,
      m,
      [
        {
          ...GAS,
          elements: [
            el(1),
            { ...GAS.elements[1]!, embed: { ...GAS.elements[1]!.embed!, style: 'NOPE' } },
          ],
        },
        {
          name: 'FENCE',
          description: '',
          elements: [
            el(1),
            {
              length: -1,
              embed: {
                kind: 'shape',
                shapeName: 'CIRC1',
                style: 'ltypeshp.shx',
                scale: 1,
                rotation: 0,
                rotationMode: 'relative',
                offset: { x: 0, y: 0 },
              },
            },
          ],
        },
        { ...CENTER, name: 'continuous' },
        { ...CENTER, name: 'dashed' },
      ],
      false,
    );
    expect(r.loaded).toEqual([]);
    expect(r.kept).toEqual(['DASHED']);
    expect(r.refused.map((f) => f.name)).toEqual(['TRIYA_GAS', 'FENCE', 'continuous']);
    expect(r.refused[0]!.reason).toMatch(/text style NOPE is not in the drawing/);
    expect(r.refused[1]!.reason).toMatch(/shape CIRC1 needs its shape file ltypeshp\.shx/);

    const b2 = new ChangeSetBuilder(m);
    const r2 = loadLinetypes(b2, m, [{ ...CENTER, name: 'dashed' }], true);
    m.apply(b2.build());
    expect(r2.reloaded).toEqual(['DASHED']);
    const dashed = m.tables.linetypes.get(DASHED)!;
    expect(dashed.name).toBe('DASHED');
    expect(dashed.elements.map((e) => e.length)).toEqual([1.25, -0.25, 0.25, -0.25]);
    expect(dashed.patternLength).toBe(2);
  });
});

describe('linetypes in use and Delete (M5-08)', () => {
  it('counts objects, block contents, layers, dimension styles, CELTYPE and kept objects', () => {
    const base = init();
    const m = DocumentModel.create({
      ...base,
      header: new Map([...(base.header ?? []), ['$CELTYPE', 'HIDDEN']]),
      tables: {
        ...base.tables,
        dimStyles: [{ handle: '60', name: 'ISO', vars: { DIMLTEX1: XREF_DOT } }],
      },
    });
    const used = linetypesInUse(m);
    // Continuous: the layers'.
    expect([...used].sort()).toEqual(['14', DASHED, HIDDEN, XREF_DOT, KEPT].sort());
    const b = new ChangeSetBuilder(m);
    b.updateTableRecord('layers', LAYER_WALLS, { linetype: XREF_DOT });
    b.updateEntity(m.ids.idOf('51')!, { linetype: 'ByLayer' });
    m.apply(b.build());
    expect(linetypesInUse(m).has(DASHED)).toBe(false);
  });

  it("deletes only what AutoCAD's Delete may, saying why the others stay", () => {
    const m = DocumentModel.create(init());
    const b = new ChangeSetBuilder(m);
    const r = deleteLinetypes(b, m, [HIDDEN, DASHED, XREF_DOT, BYLAYER, '14', KEPT]);
    m.apply(b.build());
    expect(r.deleted).toEqual(['HIDDEN']);
    expect(r.refused).toEqual([
      'DASHED is in use.',
      'PLAN|DOT is xref-dependent.',
      'ByLayer cannot be deleted.',
      'Continuous cannot be deleted.',
      'KEPT is in use.',
    ]);
    expect(m.tables.linetypes.has(HIDDEN)).toBe(false);
  });
});

/** A bus whose app reads a bundled file and a user's file `pipes.lin`. */
function drawing(files: Record<string, readonly LinetypeDefinition[]> = {}) {
  const model = DocumentModel.create(init());
  const log: string[] = [];
  const asked: ViewRequest[] = [];
  const all: Record<string, readonly LinetypeDefinition[]> = {
    'triya-iso.lin': [CENTER, { ...CENTER, name: 'TRIYA_ISO02', description: 'ISO 02' }],
    'pipes.lin': [GAS, { ...CENTER, name: 'DASHED', description: 'New dashed' }],
    ...files,
  };
  const view: ViewHost = {
    request: (r) => {
      asked.push(r);
      if (r.op === 'linetypeCreate')
        return Promise.resolve(
          /^A,[-\d.,]+$/.test(r.pattern)
            ? { ok: true, linetypeFile: { name: r.file, linetypes: [] } }
            : { ok: false, message: 'Bad pattern.' },
        );
      if (r.op !== 'linetypeFile') return Promise.resolve({ ok: false, message: 'no view' });
      const key = (r.file ?? 'triya-iso.lin').toLowerCase().replace(/(\.lin)?$/, '.lin');
      const found = all[key];
      const bundled = key === 'triya-iso.lin';
      return Promise.resolve(
        found
          ? { ok: true, linetypeFile: { name: key, linetypes: found, ...(bundled && { bundled }) } }
          : { ok: true },
      );
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const request = () => {
    const p = bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('linetype');
    return p!.dialog as Extract<DialogRequest, { type: 'linetype' }>;
  };
  return { model, bus, log, asked, request };
}

describe('LINETYPE: the Linetype Manager', () => {
  it('lists ByLayer, ByBlock, then by name, with what is used and xref-dependent, and the scales', async () => {
    const t = drawing();
    await t.bus.script(['LT']);
    const r = t.request();
    expect(r.linetypes.map((l) => l.name)).toEqual([
      'ByLayer',
      'ByBlock',
      'Continuous',
      'DASHED',
      'HIDDEN',
      'KEPT',
      'PLAN|DOT',
    ]);
    expect(r.linetypes.filter((l) => l.used).map((l) => l.name)).toEqual([
      'ByLayer',
      'Continuous',
      'DASHED',
      'KEPT',
    ]);
    expect(r.linetypes.find((l) => l.name === 'PLAN|DOT')!.xref).toBe(true);
    expect(r).toMatchObject({ current: 'ByLayer', ltscale: 1, celtscale: 1, psltscale: true });
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
  });

  it('OK loads, sets Current, deletes and sets the scales as one LINETYPE step; U undoes it', async () => {
    const t = drawing();
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: {
        load: [GAS],
        current: 'triya_gas',
        delete: [HIDDEN, DASHED],
        ltscale: 2,
        celtscale: 0.5,
        psltscale: false,
      },
    } as PromptAnswer);
    expect(t.bus.command).toBeUndefined();
    expect(named(t.model, 'TRIYA_GAS')).toBeDefined();
    expect(named(t.model, 'HIDDEN')).toBeUndefined();
    expect(named(t.model, 'DASHED')).toBeDefined();
    expect(t.log).toContain('DASHED is in use. It was not deleted.');
    const h = t.model.header;
    expect([
      h.get('$CELTYPE'),
      h.get('$LTSCALE'),
      h.get('$CELTSCALE'),
      h.get('$PSLTSCALE'),
    ]).toEqual(['TRIYA_GAS', 2, 0.5, 0]);
    expect(t.bus.undo.state.nextUndo).toBe('LINETYPE');
    await t.bus.script(['U']);
    expect(named(t.model, 'TRIYA_GAS')).toBeUndefined();
    expect(named(t.model, 'HIDDEN')).toBeDefined();
    expect(t.model.header.get('$CELTYPE')).toBe('ByLayer');
    expect(t.model.header.get('$LTSCALE')).toBe(1);
  });

  it('OK without changes and Cancel make no undo step', async () => {
    const t = drawing();
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { current: 'BYLAYER', ltscale: 1, celtscale: 1, psltscale: true },
    } as PromptAnswer);
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('the current linetype is not deleted, but one made current elsewhere first can be', async () => {
    const t = drawing();
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { current: 'HIDDEN', delete: [HIDDEN] },
    } as PromptAnswer);
    expect(named(t.model, 'HIDDEN')).toBeDefined();
    expect(t.log).toContain('HIDDEN is the current linetype. It was not deleted.');
  });
});

describe('-LINETYPE', () => {
  it('Load loads the names typed from the file named, asking to reload one it has', async () => {
    const t = drawing();
    await t.bus.script(['-LINETYPE', 'L', 'triya_gas,dashed', 'pipes']);
    expect(t.log).toContain('Current line type:  "ByLayer"');
    expect(t.bus.prompt?.message).toBe('Linetype DASHED is already loaded.  Reload it?');
    await t.bus.script(['']);
    expect(t.log).toContain('Linetype TRIYA_GAS loaded.');
    expect(t.log).toContain('Linetype DASHED reloaded.');
    expect(t.model.tables.linetypes.get(DASHED)!.description).toBe('New dashed');
    await t.bus.cancel();
    expect(t.bus.undo.state.nextUndo).toBe('LINETYPE');
  });

  it('Load keeps a linetype not to be reloaded, and says when the file lacks the names', async () => {
    const t = drawing();
    await t.bus.script(['-LT', 'L', 'DASHED', 'pipes.lin', 'N']);
    expect(t.model.tables.linetypes.get(DASHED)!.description).toBe('Dashed __ __');
    await t.bus.script(['L', 'NOPE*', '']);
    expect(t.log).toContain('Linetype NOPE* not found in triya-iso.lin.');
    await t.bus.script(['L', 'X', 'missing']);
    expect(t.log).toContain('Linetype file missing not found.');
    await t.bus.cancel();
  });

  it("? lists a file's linetypes; Set makes one current, loading it from the bundled file", async () => {
    const t = drawing();
    await t.bus.script(['-LINETYPE', '?', '', '']);
    expect(t.log).toContain('Linetypes defined in file triya-iso.lin:');
    expect(t.log.some((l) => /^TRIYA_ISO02\s+ISO 02$/.test(l))).toBe(true);
    await t.bus.script(['S', 'triya_iso02']);
    expect(t.log).toContain('Linetype TRIYA_ISO02 loaded.');
    expect(t.model.header.get('$CELTYPE')).toBe('TRIYA_ISO02');
    await t.bus.script(['S', 'unknown']);
    expect(t.log).toContain('Linetype unknown not found.  Use the Load option to load it.');
    await t.bus.script(['?', 'D*']);
    expect(t.log.some((l) => /^DASHED\s+Dashed __ __$/.test(l))).toBe(true);
    await t.bus.script(['bylayer']);
    expect(t.model.header.get('$CELTYPE')).toBe('ByLayer');
    await t.bus.cancel();
  });
});

describe('LINETYPE and -LINETYPE: refusals', () => {
  it('reports what OK could not do: an unknown current linetype, a refused load', async () => {
    const t = drawing();
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { current: 'NOPE', load: [{ ...CENTER, name: 'BYLAYER' }] },
    } as PromptAnswer);
    expect(t.log).toContain('Linetype NOPE not found.');
    expect(t.log).toContain('Linetype BYLAYER not loaded: BYLAYER is always in the drawing.');
    // Apply (not a button the manager has) changes nothing.
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({ kind: 'dialog', action: 'apply' } as PromptAnswer);
    expect(t.bus.command).toBeUndefined();
  });

  it('says so when the app reads no files, and Enter or nothing typed ends an option', async () => {
    const model = DocumentModel.create(init());
    const log: string[] = [];
    const bus = new PromptBus({ model, registry: builtinCommands() });
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['-LINETYPE', 'L', '']);
    expect(bus.prompt?.message).toBe('Enter an option');
    await bus.script(['L', 'X', '']);
    expect(log).toContain('There is no view to change.');
    await bus.script(['S', '']);
    expect(bus.prompt?.message).toBe('Enter an option');
    await bus.cancel();
    expect(model.header.get('$CELTYPE')).toBe('ByLayer');
  });

  it('a reload question cancelled loads nothing; a shape linetype is reported refused', async () => {
    const shape: LinetypeDefinition = {
      name: 'FENCE',
      description: '',
      elements: [
        el(1),
        {
          length: -1,
          embed: {
            kind: 'shape',
            shapeName: 'CIRC1',
            style: 'ltypeshp.shx',
            scale: 1,
            rotation: 0,
            rotationMode: 'relative',
            offset: { x: 0, y: 0 },
          },
        },
      ],
    };
    const t = drawing({ 'fence.lin': [shape] });
    await t.bus.script(['-LINETYPE', 'L', 'FENCE', 'fence']);
    expect(t.log.some((l) => l.startsWith('Linetype FENCE not loaded: shape CIRC1'))).toBe(true);
    await t.bus.script(['L', 'DASHED', 'pipes']);
    expect(t.bus.prompt?.message).toBe('Linetype DASHED is already loaded.  Reload it?');
    await t.bus.cancel();
    expect(t.model.tables.linetypes.get(DASHED)!.description).toBe('Dashed __ __');
  });
});

describe('LTSCALE', () => {
  it('asks for the factor, refuses zero, and regenerates', async () => {
    const t = drawing();
    await t.bus.script(['LTS']);
    expect(t.bus.prompt?.message).toBe('Enter new linetype scale factor');
    await t.bus.script(['0', '2.5']);
    expect(t.log).toContain('Value must be positive and nonzero.');
    expect(t.log).toContain('Regenerating model.');
    expect(t.model.header.get('$LTSCALE')).toBe(2.5);
    expect(t.bus.undo.state.nextUndo).toBe('LTSCALE');
    await t.bus.script(['LTSCALE', '']);
    expect(t.model.header.get('$LTSCALE')).toBe(2.5);
    expect(t.bus.command).toBeUndefined();
  });
});

describe('the linetype-load edit (Select Linetype Load...)', () => {
  it('loads as one LINETYPE step, reloading only when asked; refuses when nothing loads', () => {
    const s = new EngineSession(init());
    expect(s.edit({ kind: 'linetype-load', linetypes: [GAS] })).toMatchObject({ ok: true });
    expect(s.undoState.nextUndo).toBe('LINETYPE');
    expect(named(s.model, 'TRIYA_GAS')).toBeDefined();
    expect(s.edit({ kind: 'linetype-load', linetypes: [GAS] })).toEqual({
      ok: false,
      message: 'No linetype loaded.',
    });
    expect(s.edit({ kind: 'linetype-load', linetypes: [{ ...CENTER, name: 'ByBlock' }] })).toEqual({
      ok: false,
      message: 'Linetype ByBlock not loaded: ByBlock is always in the drawing.',
    });
    expect(
      s.edit({ kind: 'linetype-load', linetypes: [{ ...CENTER, name: 'DASHED' }], reload: true }),
    ).toMatchObject({ ok: true });
    expect(s.model.tables.linetypes.get(DASHED)!.description).toBe('Center');
  });
});

describe('Other... in the Properties palette (M5-08 part 2)', () => {
  const lineOf = (t: ReturnType<typeof drawing>) => t.model.entityByHandle('51')!;

  it('loads in the Linetype Manager and gives the selection the linetype highlighted, one undo step', async () => {
    const t = drawing();
    await t.bus.selectAll();
    const selected = [...t.bus.selection];
    await t.bus.otherLinetype();
    expect(t.bus.command).toBe('PROPERTIES');
    expect(t.request()).toMatchObject({ apply: true, current: 'ByLayer' });
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { load: [GAS], apply: 'triya_gas', ltscale: 1, celtscale: 1, psltscale: true },
    } as PromptAnswer);
    expect(t.bus.command).toBeUndefined();
    const gas = named(t.model, 'TRIYA_GAS')!;
    expect(lineOf(t).linetype).toBe(gas.handle);
    // CELTYPE is not touched with objects shown, and they stay selected.
    expect(t.model.header.get('$CELTYPE')).toBe('ByLayer');
    expect([...t.bus.selection]).toEqual(selected);
    expect(t.bus.undo.state.nextUndo).toBe('PROPERTIES');
    await t.bus.script(['U']);
    expect(named(t.model, 'TRIYA_GAS')).toBeUndefined();
    expect(lineOf(t).linetype).toBe(DASHED);
  });

  it('makes the linetype current with nothing selected; ByLayer and ByBlock by name', async () => {
    const t = drawing();
    await t.bus.otherLinetype();
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { apply: 'HIDDEN' },
    } as PromptAnswer);
    expect(t.model.header.get('$CELTYPE')).toBe('HIDDEN');
    await t.bus.selectAll();
    await t.bus.otherLinetype();
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { apply: 'BYBLOCK' },
    } as PromptAnswer);
    expect(lineOf(t).linetype).toBe('ByBlock');
  });

  it('Cancel changes nothing; OK without a linetype makes only the manager’s changes; an unknown one is said', async () => {
    const t = drawing();
    await t.bus.selectAll();
    const version = t.model.version;
    await t.bus.otherLinetype();
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    expect(t.model.version).toBe(version);
    await t.bus.otherLinetype();
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { load: [CENTER] },
    } as PromptAnswer);
    expect(named(t.model, 'TRIYA_CENTER')).toBeDefined();
    expect(lineOf(t).linetype).toBe(DASHED);
    await t.bus.otherLinetype();
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { apply: 'NOPE' },
    } as PromptAnswer);
    expect(t.log).toContain('Linetype NOPE not found.');
    expect(lineOf(t).linetype).toBe(DASHED);
  });

  it('cancels a running command first, keeping the selection its Select objects prompt built', async () => {
    const t = drawing();
    await t.bus.script(['MOVE']);
    await t.bus.selectAll();
    const selected = [...t.bus.selection];
    expect(selected.length).toBeGreaterThan(0);
    await t.bus.otherLinetype();
    expect(t.bus.command).toBe('PROPERTIES');
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: { apply: 'HIDDEN' },
    } as PromptAnswer);
    expect(lineOf(t).linetype).toBe(HIDDEN);
    expect([...t.bus.selection]).toEqual(selected);
  });

  it('the session’s property-editor input with key linetype opens the manager', async () => {
    const s = new EngineSession(init());
    const out: unknown[] = [];
    s.onCommand((o) => out.push(o));
    await s.command({ kind: 'property-editor', key: 'linetype' });
    const prompt = out
      .filter((o): o is { type: 'prompt'; prompt: { dialog?: DialogRequest } } => {
        return (o as { type: string }).type === 'prompt';
      })
      .at(-1);
    expect(prompt?.prompt.dialog).toMatchObject({ type: 'linetype', apply: true });
  });
});

void MODEL_SPACE;

// M5-08 part 4: renaming and describing a linetype in the Linetype Manager's Details ("Linetype
// Manager": "Name: Displays the selected linetype name, which can be edited ... Linetype names
// cannot be edited for ByLayer, ByBlock, Continuous, and xref-dependent linetypes";
// "Description: ... which can be edited in the details section"), and -LINETYPE Create
// ("-LINETYPE (Command)": "Creates a new linetype and stores it in an LIN file").
describe('editing a linetype: rename and describe (M5-08 part 4)', () => {
  const edit = (m: DocumentModel, edits: Parameters<typeof editLinetypes>[2]) => {
    const b = new ChangeSetBuilder(m);
    const r = editLinetypes(b, m, edits);
    m.apply(b.build());
    return r;
  };

  it('renames (handle kept, objects keep it) and describes; CELTYPE follows a rename', () => {
    const base = init();
    const m = DocumentModel.create({
      ...base,
      header: new Map([...(base.header ?? []), ['$CELTYPE', 'DASHED']]),
    });
    const r = edit(m, [
      { handle: DASHED, name: 'SITE_DASH', description: 'Site dashes' },
      { handle: HIDDEN, description: 'Hidden edges' },
    ]);
    expect(r).toEqual({
      renamed: [{ from: 'DASHED', to: 'SITE_DASH' }],
      described: ['SITE_DASH', 'HIDDEN'],
      refused: [],
    });
    expect(m.tables.linetypes.get(DASHED)).toMatchObject({
      name: 'SITE_DASH',
      description: 'Site dashes',
    });
    expect(m.tables.linetypes.get(HIDDEN)!.description).toBe('Hidden edges');
    expect(m.header.get('$CELTYPE')).toBe('SITE_DASH');
    expect([...m.entities()].find((e) => e.handle === '51')).toMatchObject({ linetype: DASHED });
  });

  it('a change of case alone renames; unchanged fields make no change', () => {
    const m = DocumentModel.create(init());
    const r = edit(m, [
      { handle: DASHED, name: 'Dashed' },
      { handle: HIDDEN, name: 'HIDDEN', description: 'Solid line' },
    ]);
    expect(r).toEqual({ renamed: [{ from: 'DASHED', to: 'Dashed' }], described: [], refused: [] });
    expect(m.tables.linetypes.get(DASHED)!.name).toBe('Dashed');
  });

  it("refuses AutoCAD's: fixed names, xref-dependent, taken or invalid names, long descriptions", () => {
    const m = DocumentModel.create(init());
    const cont = [...m.tables.linetypes.values()].find((l) => l.name === 'Continuous')!;
    const r = edit(m, [
      { handle: cont.handle, name: 'SOLID' },
      { handle: cont.handle, description: 'Solid, unbroken' },
      { handle: BYLAYER, description: 'x' },
      { handle: XREF_DOT, name: 'DOT' },
      { handle: HIDDEN, name: 'dashed' },
      { handle: HIDDEN, name: 'A<B' },
      { handle: HIDDEN, name: '  ' },
      { handle: KEPT, description: 'x'.repeat(48) },
    ]);
    expect(r.renamed).toEqual([]);
    expect(r.described).toEqual(['Continuous']);
    expect(r.refused).toEqual([
      'The name of Continuous cannot be changed.',
      'ByLayer cannot be edited.',
      'PLAN|DOT is xref-dependent and cannot be changed.',
      'A linetype named dashed already exists.',
      'A<B is not a valid linetype name.',
      'A linetype name cannot be empty.',
      'The description of KEPT is longer than 47 characters.',
    ]);
    expect(m.tables.linetypes.get(cont.handle)).toMatchObject({
      name: 'Continuous',
      description: 'Solid, unbroken',
    });
  });

  it('names may be swapped in one step', () => {
    const m = DocumentModel.create(init());
    const r = edit(m, [
      { handle: DASHED, name: 'HIDDEN' },
      { handle: HIDDEN, name: 'DASHED' },
    ]);
    expect(r.refused).toEqual([]);
    expect(m.tables.linetypes.get(DASHED)!.name).toBe('HIDDEN');
    expect(m.tables.linetypes.get(HIDDEN)!.name).toBe('DASHED');
  });
});

describe('LINETYPE: Details rename and describe (M5-08 part 4)', () => {
  it('OK renames and describes with the other changes, one LINETYPE step; U undoes it', async () => {
    const t = drawing();
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: {
        load: [{ ...GAS, name: 'MY_GAS', description: 'Mine' }],
        edit: [{ handle: HIDDEN, name: 'BACK', description: 'Hidden behind' }],
        current: 'BACK',
      },
    } as PromptAnswer);
    expect(named(t.model, 'MY_GAS')!.description).toBe('Mine');
    expect(t.model.tables.linetypes.get(HIDDEN)).toMatchObject({
      name: 'BACK',
      description: 'Hidden behind',
    });
    expect(t.model.header.get('$CELTYPE')).toBe('BACK');
    expect(t.bus.undo.state.nextUndo).toBe('LINETYPE');
    await t.bus.script(['U']);
    expect(t.model.tables.linetypes.get(HIDDEN)!.name).toBe('HIDDEN');
    expect(t.model.header.get('$CELTYPE')).toBe('ByLayer');
  });

  it('a renamed current linetype stays current and is not deleted; refusals are reported', async () => {
    const t = drawing();
    t.model.apply(
      (() => {
        const b = new ChangeSetBuilder(t.model);
        b.setHeader('$CELTYPE', 'HIDDEN');
        return b.build();
      })(),
    );
    await t.bus.script(['LINETYPE']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      linetype: {
        edit: [
          { handle: HIDDEN, name: 'BEHIND' },
          { handle: XREF_DOT, name: 'DOT' },
        ],
        current: 'BEHIND',
        delete: [HIDDEN],
      },
    } as PromptAnswer);
    expect(t.model.tables.linetypes.get(HIDDEN)!.name).toBe('BEHIND');
    expect(t.model.header.get('$CELTYPE')).toBe('BEHIND');
    expect(t.log).toContain('PLAN|DOT is xref-dependent and cannot be changed.');
    expect(t.log).toContain('HIDDEN is the current linetype. It was not deleted.');
  });
});

describe('-LINETYPE Create (M5-08 part 4)', () => {
  it('asks the name, the file, the description and the pattern, and has the app write it', async () => {
    const t = drawing({ 'custom.lin': [] });
    await t.bus.script(['-LINETYPE', 'C', 'FENCE', '', 'Fence ---x---x---', '.5,-.25,0,-.25']);
    const asked = t.asked.filter((r) => r.op === 'linetypeCreate');
    expect(asked).toEqual([
      {
        op: 'linetypeCreate',
        file: 'custom.lin',
        name: 'FENCE',
        description: 'Fence ---x---x---',
        pattern: 'A,.5,-.25,0,-.25',
      },
    ]);
    expect(t.log).toContain('Enter linetype pattern (on next line):');
    expect(t.log).toContain('New linetype definition saved to file custom.lin.');
    // The drawing is not changed: Load loads it (AutoCAD: "you must load it").
    expect(named(t.model, 'FENCE')).toBeUndefined();
    expect(t.bus.prompt?.message).toBe('Enter an option');
    await t.bus.cancel();
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('asks before overwriting a definition the file has; No writes nothing', async () => {
    const t = drawing();
    await t.bus.script(['-LT', 'C', 'triya_gas', 'pipes']);
    expect(t.bus.prompt?.message).toBe(
      'Linetype TRIYA_GAS already exists in pipes.lin.  Overwrite it?',
    );
    await t.bus.script(['']);
    expect(t.bus.prompt?.message).toBe('Enter an option');
    await t.bus.script(['C', 'triya_gas', 'pipes.lin', 'Y', '', 'A,1,-1']);
    expect(t.asked.filter((r) => r.op === 'linetypeCreate')).toEqual([
      {
        op: 'linetypeCreate',
        file: 'pipes.lin',
        name: 'triya_gas',
        description: '',
        pattern: 'A,1,-1',
      },
    ]);
    await t.bus.cancel();
  });

  it('refuses a fixed or invalid name, a bundled file, a long description; reports the app', async () => {
    const t = drawing({ 'custom.lin': [] });
    await t.bus.script(['-LT', 'C', 'continuous']);
    expect(t.log).toContain('continuous is a reserved linetype name.');
    await t.bus.script(['C', 'A=B']);
    expect(t.log).toContain('A=B is not a valid linetype name.');
    await t.bus.script(['C', 'X', 'triya-iso']);
    expect(t.log).toContain('triya-iso.lin is bundled with Triya and cannot be changed.');
    await t.bus.script(['C', 'X', '', 'y'.repeat(48)]);
    expect(t.log).toContain('A description cannot exceed 47 characters.');
    expect(t.bus.prompt?.message).toBe('Descriptive text');
    await t.bus.script(['', '']);
    // Enter for the pattern writes nothing.
    expect(t.asked.some((r) => r.op === 'linetypeCreate')).toBe(false);
    expect(t.bus.prompt?.message).toBe('Enter an option');
    await t.bus.script(['C', 'X', '', '', 'B,1']);
    expect(t.log).toContain('Bad pattern.');
    await t.bus.cancel();
  });
});
