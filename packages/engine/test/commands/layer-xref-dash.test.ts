// M5-18 part 3: -LAYER's Xref option, which "Resets the xref layer property override in the
// current drawing to the layer settings in the xref" (AutoCAD 2024 Help, "-LAYER (Command)").
// The drawing keeps its own records of an xref's layers (`PLAN|A-WALL`), changed by the drafter;
// Xref sets one property, or All, of those named back to the layer in the xref's file.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  xrefLoadChange,
  type BusEvent,
  type DocumentInit,
  type LayerRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { blockRecord, layer, linetype, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const XREF = '30';
const OTHER = '32';

/** The xref's A-WALL: green, DASHED, 0.35 mm, 50 % transparent, frozen in new viewports. */
const A_WALL: LayerRecord = {
  ...layer('11', 'A-WALL'),
  color: { kind: 'aci', index: 3 },
  linetype: '15',
  lineweight: 35,
  transparency: { alpha: 127 },
  flags: 2,
  description: 'Walls',
};

/** The xref's drawing: layers 0, A-WALL and A-DOOR (Continuous); linetype DASHED. */
function planInit(): DocumentInit {
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '60',
    tables: {
      layers: [layer('10', '0'), A_WALL, layer('12', 'A-DOOR')],
      linetypes: [linetype('14', 'Continuous'), linetype('15', 'DASHED')],
      blockRecords: [blockRecord('1F', '*Model_Space'), blockRecord('1B', '*Paper_Space')],
    },
    blocks: [
      { handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: '1B', name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22A', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    objects: [{ handle: 'C', type: 'DICTIONARY', owner: '0' }],
  };
}

/**
 * The sample drawing with xref PLAN loaded and xref SITE (another file, loaded too, layer
 * SITE|ROAD), so the drawing has PLAN|A-WALL, PLAN|A-DOOR, PLAN|DASHED and SITE|ROAD.
 */
function setup(o: { file?: 'missing' | 'unreadable'; plan?: DocumentInit } = {}) {
  const s = sampleInit();
  const model = DocumentModel.create({
    ...s,
    tables: {
      ...s.tables,
      blockRecords: [
        ...(s.tables?.blockRecords ?? []),
        { ...blockRecord(XREF, 'PLAN'), flags: 4 },
        { ...blockRecord(OTHER, 'SITE'), flags: 4 },
      ],
    },
    blocks: [
      ...(s.blocks ?? []),
      { handle: XREF, name: 'PLAN', basePoint: { x: 0, y: 0 }, xrefPath: '.\\plan.dxf' },
      { handle: OTHER, name: 'SITE', basePoint: { x: 0, y: 0 }, xrefPath: 'site.dxf' },
    ],
  });
  model.apply(xrefLoadChange(model, XREF, planInit()));
  const site: DocumentInit = {
    ...planInit(),
    tables: { ...planInit().tables, layers: [layer('10', '0'), layer('11', 'ROAD')] },
  };
  model.apply(xrefLoadChange(model, OTHER, site));
  const base = host(() => model);
  const asked: string[] = [];
  const view = {
    request: (r: ViewRequest): Promise<ViewReply> => {
      if (r.op !== 'xrefDrawing') return base.request(r);
      asked.push(r.block);
      if (r.block === OTHER) return Promise.resolve({ ok: true });
      if (o.file === 'unreadable')
        return Promise.resolve({ ok: false, message: 'plan.dxf could not be read: damaged' });
      return Promise.resolve({
        ok: true,
        xrefDrawing: { name: 'plan.dxf', init: o.plan ?? planInit() },
      });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const named = (name: string) => [...model.tables.layers.values()].find((l) => l.name === name)!;
  return { model, bus, log, named, asked };
}

function clearNewVpFreeze(model: DocumentModel, handle: string): void {
  const b = new ChangeSetBuilder(model);
  b.updateTableRecord('layers', handle, {
    flags: (model.tables.layers.get(handle)!.flags ?? 0) & ~2,
  });
  model.apply(b.build());
}

const OPTION =
  'Enter an option [On/Color/Ltype/LWeight/TRansparency/Plot/Freeze/LOck/Newvpfreeze/Description/All] <All>:';
const NAMES = 'Enter xref layer name(s) to reset or [?] <*>:';

/** -LAYER changes overriding PLAN|A-WALL's every property the xref gives it. */
const OVERRIDE = [
  ...['C', '1', 'PLAN|A-WALL', 'L', 'Continuous', 'PLAN|A-WALL', 'LW', '0.5', 'PLAN|A-WALL'],
  ...['TR', '0', 'PLAN|A-WALL', 'P', 'N', 'PLAN|A-WALL', 'F', 'PLAN|A-WALL', 'LO', 'PLAN|A-WALL'],
  ...['OFF', 'PLAN|A-WALL', 'D', 'Mine', 'PLAN|A-WALL', 'Y'],
];

describe('-LAYER Xref', () => {
  it("All resets every property of the xref layers named to the xref file's", async () => {
    const t = setup();
    await t.bus.script(['-LAYER', ...OVERRIDE]);
    const before = t.named('PLAN|A-WALL');
    expect(before.color).toEqual({ kind: 'aci', index: 1 });
    expect(before.frozen).toBe(true);
    // -LAYER has no New VP Freeze: the Layer Properties Manager's column turns it off.
    clearNewVpFreeze(t.model, before.handle);
    expect((t.named('PLAN|A-WALL').flags ?? 0) & 2).toBe(0);
    await t.bus.script(['X']);
    expect(t.bus.promptText).toBe(OPTION);
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe(NAMES);
    await t.bus.script(['?']);
    expect(t.log.slice(-3)).toEqual(['PLAN|A-DOOR', 'PLAN|A-WALL', 'SITE|ROAD']);
    expect(t.bus.promptText).toBe(NAMES);
    await t.bus.script(['plan|a-w*']);
    const after = t.named('PLAN|A-WALL');
    expect(after.color).toEqual({ kind: 'aci', index: 3 });
    expect(t.model.tables.linetypes.get(after.linetype)!.name).toBe('PLAN|DASHED');
    expect(after.lineweight).toBe(35);
    expect(after.transparency).toEqual({ alpha: 127 });
    expect([after.on, after.frozen, after.locked, after.plot]).toEqual([true, false, false, true]);
    expect(after.description).toBe('Walls');
    expect((after.flags ?? 0) & 2).toBe(2);
    expect(t.log.at(-1)).toBe('1 xref layer reset.');
    await t.bus.script(['']);
    expect(t.bus.prompt).toBeUndefined();
    // The overrides and the reset are one LAYER undo step.
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it.each([
    ['ON', 'on', true],
    ['C', 'color', { kind: 'aci', index: 3 }],
    ['L', 'linetype', 'PLAN|DASHED'],
    ['LW', 'lineweight', 35],
    ['TR', 'transparency', { alpha: 127 }],
    ['P', 'plot', true],
    ['F', 'frozen', false],
    ['LO', 'locked', false],
    ['N', 'flags', 2],
    ['D', 'description', 'Walls'],
  ] as const)('%s resets that property alone', async (keyword, key, value) => {
    const t = setup();
    await t.bus.script(['-LAYER', ...OVERRIDE]);
    clearNewVpFreeze(t.model, t.named('PLAN|A-WALL').handle);
    const before = t.named('PLAN|A-WALL');
    await t.bus.script(['X', keyword, 'PLAN|A-WALL']);
    const after = t.named('PLAN|A-WALL');
    const got =
      key === 'linetype'
        ? t.model.tables.linetypes.get(after.linetype)!.name
        : key === 'flags'
          ? (after.flags ?? 0) & 2
          : after[key];
    expect(got).toEqual(value);
    // Nothing else changed.
    const rest = (l: LayerRecord) => {
      const { [key]: _k, flags: _f, ...others } = l;
      return others;
    };
    expect(rest(after)).toEqual(rest(before));
  });

  it('<*> resets every xref layer; a file not at hand or without the layer is said', async () => {
    const t = setup({
      plan: { ...planInit(), tables: { ...planInit().tables, layers: [layer('10', '0'), A_WALL] } },
    });
    await t.bus.script(['-LAYER', 'C', '1', 'PLAN|A-WALL', 'X', 'C', '']);
    expect(t.log.slice(-3)).toEqual([
      'Xref "PLAN" has no layer "A-DOOR": it was not reset.',
      'The file of xref "SITE" (site.dxf) is not at hand: its layers were not reset.',
      '1 xref layer reset.',
    ]);
    expect(t.named('PLAN|A-WALL').color).toEqual({ kind: 'aci', index: 3 });
    // Each xref's file is read once.
    expect(t.asked).toEqual([XREF, OTHER]);
    await t.bus.script(['X', '', 'NONE']);
    expect(t.log.at(-1)).toBe('No matching xref layers found.');
  });

  it('an unreadable file, a linetype the drawing lacks and a refused value are said', async () => {
    const t = setup({ file: 'unreadable' });
    await t.bus.script(['-LAYER', 'X', '', 'PLAN|A-WALL']);
    expect(t.log.slice(-2)).toEqual([
      'plan.dxf could not be read: damaged',
      '0 xref layers reset.',
    ]);
    const odd: LayerRecord = { ...A_WALL, linetype: '16', description: 'x'.repeat(300) };
    const hidden: LayerRecord = { ...A_WALL, linetype: '99' };
    const plan = (l: LayerRecord): DocumentInit => ({
      ...planInit(),
      tables: {
        ...planInit().tables,
        layers: [layer('10', '0'), l],
        linetypes: [...(planInit().tables?.linetypes ?? []), linetype('16', 'HIDDEN')],
      },
    });
    const u = setup({ plan: plan(odd) });
    await u.bus.script(['-LAYER', 'X', 'L', 'PLAN|A-WALL']);
    expect(u.log.slice(-2)).toEqual([
      'Linetype "PLAN|HIDDEN" not found: "PLAN|A-WALL" keeps its own.',
      '1 xref layer reset.',
    ]);
    await u.bus.script(['X', 'D', 'PLAN|A-WALL']);
    expect(u.log.slice(-2)).toEqual([
      '"PLAN|A-WALL": A description is at most 255 characters.',
      '0 xref layers reset.',
    ]);
    const v = setup({ plan: plan(hidden) });
    await v.bus.script(['-LAYER', 'X', 'L', 'PLAN|A-WALL']);
    expect(v.log.at(-2)).toBe('Linetype "" not found: "PLAN|A-WALL" keeps its own.');
  });

  it('? says when the drawing has no xref layers', async () => {
    const t = setup();
    const b = new ChangeSetBuilder(t.model);
    for (const l of t.model.tables.layers.values())
      if (l.name.includes('|')) b.updateTableRecord('layers', l.handle, { flags: 0 });
    t.model.apply(b.build());
    await t.bus.script(['-LAYER', 'X', 'A', '?']);
    expect(t.log.at(-1)).toBe('No xref layers found.');
    await t.bus.script(['*']);
    expect(t.log.at(-1)).toBe('No matching xref layers found.');
  });
});
