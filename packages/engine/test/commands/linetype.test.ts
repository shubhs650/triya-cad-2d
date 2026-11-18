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
      if (r.op !== 'linetypeFile') return Promise.resolve({ ok: false, message: 'no view' });
      const key = (r.file ?? 'triya-iso.lin').toLowerCase().replace(/(\.lin)?$/, '.lin');
      const found = all[key];
      return Promise.resolve(
        found ? { ok: true, linetypeFile: { name: key, linetypes: found } } : { ok: true },
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

void MODEL_SPACE;
