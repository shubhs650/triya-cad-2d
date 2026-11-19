// M6-01 part 1: LAYOUT New, Delete, Rename, Set and ? (AutoCAD 2024 Help, "LAYOUT (Command)").
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type Handle,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import {
  MODEL_SPACE as MODEL,
  PAPER_SPACE as SHEET1,
  blockRecord,
  entityInit,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

// SHEET1 is *Paper_Space: Layout1 is the drawing's current layout.
const SHEET2 = '30'; // *Paper_Space0: Layout2.
const OPTIONS = 'Enter layout option [Copy/Delete/New/Template/Rename/SAveas/Set/?] <Set>:';

/** Model, Layout1 (current, on *Paper_Space) and Layout2, each sheet with a line on it. */
function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([
      ...(base.header ?? []),
      ['$PLIMMIN', { x: 0, y: 0 }],
      ['$PLIMMAX', { x: 420, y: 297 }],
    ]),
    tables: {
      ...base.tables,
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
        blockRecord: SHEET1,
        limits: { min: { x: 0, y: 0 }, max: { x: 420, y: 297 } },
      },
      { handle: '31', name: 'Layout2', tabOrder: 2, blockRecord: SHEET2 },
    ],
    entities: [...(base.entities ?? []), entityInit('32', lineGeom(0, 0, 5, 5), { owner: SHEET2 })],
  };
}

function setup(start: DocumentInit = init(), shown: Handle = MODEL) {
  const model = DocumentModel.create(start);
  let space = shown;
  const tabs: string[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'tab') return Promise.resolve({ ok: false, message: 'no' });
      tabs.push(r.name ?? '');
      const l = model.layouts.find((x) => x.name === r.name);
      if (l) space = l.blockRecord;
      return Promise.resolve({ ok: true });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view, space: () => space });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const names = () => model.layouts.map((l) => `${l.tabOrder}:${l.name}`);
  const named = (n: string) => model.layouts.find((l) => l.name === n);
  const blockName = (h: Handle) => model.tables.blockRecords.get(h)?.name;
  return { model, bus, log, tabs, names, named, blockName, space: () => space };
}

describe('LAYOUT', () => {
  it('New adds the next Layout<n> after the last tab on the units’ own sheet, one LAYOUT step', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT']);
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['N']);
    expect(t.bus.promptText).toBe('Enter name of new layout <Layout3>:');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2', '3:Layout3']);
    const made = t.named('Layout3')!;
    expect(t.blockName(made.blockRecord)).toBe('*Paper_Space1');
    // The sample drawing is metric: ISO A4 landscape in millimetres, 1:1, plotting the layout.
    expect(made.plot).toMatchObject({
      paperSize: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)',
      paperWidth: 297,
      paperHeight: 210,
      paperUnits: 'millimeters',
      plotType: 5,
      scale: { numerator: 1, denominator: 1 },
    });
    expect(made.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 297, y: 210 } });
    // LAYOUT New does not show the new tab.
    expect(t.tabs).toEqual([]);
    expect(t.bus.undo.state.nextUndo).toBe('LAYOUT');
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
  });

  it('New in an imperial drawing is on ANSI A in inches', async () => {
    const base = init();
    const t = setup({
      ...base,
      header: new Map([...(base.header ?? []), ['$MEASUREMENT', 0]]),
    });
    await t.bus.script(['LAYOUT', 'N', 'Sheet A']);
    const made = t.named('Sheet A')!;
    expect(made.plot).toMatchObject({
      paperSize: 'ANSI_full_bleed_A_(11.00_x_8.50_Inches)',
      paperWidth: 279.4,
      paperHeight: 215.9,
      paperUnits: 'inches',
    });
    expect(made.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 11, y: 8.5 } });
  });

  it('New refuses a name in use (any case) or with characters AutoCAD refuses, and asks again', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'N', 'layout2']);
    expect(t.log.at(-1)).toBe('A layout named "layout2" already exists.');
    expect(t.bus.promptText).toBe('Enter name of new layout <Layout3>:');
    await t.bus.script(['A<B']);
    expect(t.log.at(-1)).toBe('Invalid layout name.');
    await t.bus.script(['Detail 1']);
    expect(t.bus.command).toBeUndefined();
    expect(t.names().at(-1)).toBe('3:Detail 1');
  });

  it('Rename defaults to the layout shown, keeps it on Enter and renames it, one undo step', async () => {
    const t = setup(init(), SHEET2);
    await t.bus.script(['LAYOUT', 'R']);
    expect(t.bus.promptText).toBe('Enter layout to rename <Layout2>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Enter new layout name <Layout2>:');
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    expect(t.bus.undo.state.undoable).toBe(0);
    await t.bus.script(['LAYOUT', 'R', 'layout1', 'Layout2']);
    expect(t.log.at(-1)).toBe('A layout named "Layout2" already exists.');
    await t.bus.script(['Plan']);
    expect(t.log.at(-1)).toBe('Layout "Layout1" renamed to "Plan".');
    expect(t.names()).toEqual(['0:Model', '1:Plan', '2:Layout2']);
    // Its case alone changes too.
    await t.bus.script(['LAYOUT', 'R', 'plan', 'PLAN']);
    expect(t.names()).toEqual(['0:Model', '1:PLAN', '2:Layout2']);
    await t.bus.script(['U', 'U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
  });

  it('a name the drawing lacks is asked again; the Model tab is not offered to Rename or Delete', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'R', 'Sheet9']);
    expect(t.log.at(-1)).toBe('No layout named "Sheet9".');
    expect(t.bus.promptText).toBe('Enter layout to rename <Layout1>:');
    await t.bus.script(['model']);
    expect(t.log.at(-1)).toBe('The Model tab cannot be chosen here.');
    await t.bus.cancel();
    await t.bus.script(['LAYOUT', 'D', 'Model']);
    expect(t.log.at(-1)).toBe('The Model tab cannot be chosen here.');
  });

  it('Delete of a layout not current removes it, its block and its sheet; U brings them back', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', 'D']);
    // On the Model tab, the drawing's current layout is the default.
    expect(t.bus.promptText).toBe('Enter name of layout to delete <Layout1>:');
    await t.bus.script(['Layout2']);
    expect(t.log.at(-1)).toBe('Layout "Layout2" deleted.');
    expect(t.names()).toEqual(['0:Model', '1:Layout1']);
    expect(t.model.blocks.has(SHEET2)).toBe(false);
    expect(t.model.entityByHandle('32')).toBeUndefined();
    expect(t.tabs).toEqual([]);
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
    expect(t.model.entityByHandle('32')).toBeDefined();
  });

  it('Delete of the current layout makes the next one current first and shows the Model tab', async () => {
    const t = setup(init(), SHEET1);
    await t.bus.script(['LAYOUT', 'D', '']);
    expect(t.log.at(-1)).toBe('Layout "Layout1" deleted.');
    expect(t.tabs).toEqual(['Model']);
    expect(t.space()).toBe(MODEL);
    expect(t.names()).toEqual(['0:Model', '1:Layout2']);
    // Layout2's sheet block took the name *Paper_Space, as AutoCAD swaps them.
    expect(t.blockName(SHEET2)).toBe('*Paper_Space');
    expect(t.model.blocks.has(SHEET1)).toBe(false);
  });

  it('the current layout cannot go while its other layouts are all new since the drawing opened', async () => {
    const start = init();
    const t = setup({
      ...start,
      layouts: start.layouts!.filter((l) => l.name !== 'Layout2'),
      tables: {
        ...start.tables,
        blockRecords: start.tables!.blockRecords!.filter((r) => r.handle !== SHEET2),
      },
      blocks: start.blocks!.filter((b) => b.handle !== SHEET2),
      entities: start.entities!.filter((e) => e.owner !== SHEET2),
    });
    await t.bus.script(['LAYOUT', 'N', '', 'LAYOUT', 'D', 'Layout1']);
    expect(t.log.at(-1)).toBe(
      'Layout "Layout1" cannot be deleted until the drawing is saved and opened again: its other layouts are new.',
    );
    expect(t.names()).toEqual(['0:Model', '1:Layout1', '2:Layout2']);
    expect(t.bus.undo.state.undoable).toBe(1);
  });

  it('Delete of the only layout leaves it emptied as Layout1 on a new layout’s sheet', async () => {
    const start = init();
    const t = setup(
      {
        ...start,
        layouts: start.layouts!.map((l) => (l.handle === '1E' ? { ...l, name: 'Plan' } : l)),
      },
      SHEET1,
    );
    await t.bus.script(['LAYOUT', 'D', 'Layout2', 'LAYOUT', 'D', 'Plan']);
    expect(t.log.at(-1)).toBe('Layout "Plan" deleted.');
    expect(t.names()).toEqual(['0:Model', '1:Layout1']);
    const sheet = t.named('Layout1')!;
    expect(sheet.handle).toBe('1E');
    expect(t.model.blockEntities(SHEET1)).toEqual([]);
    expect(sheet.limits).toEqual({ min: { x: 0, y: 0 }, max: { x: 297, y: 210 } });
    // The header held the current layout's limits: they follow.
    expect(t.model.header.get('$PLIMMAX')).toEqual({ x: 297, y: 210 });
    // Still shown: nothing else to show.
    expect(t.tabs).toEqual([]);
  });

  it('Set shows the tab named (Model too); Enter keeps the one shown', async () => {
    const t = setup();
    await t.bus.script(['LAYOUT', '']);
    expect(t.bus.promptText).toBe('Enter layout to make current <Model>:');
    await t.bus.script(['layout2']);
    expect(t.tabs).toEqual(['Layout2']);
    await t.bus.script(['LAYOUT', 'S', '']);
    expect(t.tabs).toEqual(['Layout2']);
    await t.bus.script(['LAYOUT', 'S', 'model']);
    expect(t.tabs).toEqual(['Layout2', 'Model']);
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('? lists the layout shown and every layout; Copy, Template and SAveas are not there yet', async () => {
    const t = setup(init(), SHEET2);
    await t.bus.script(['LAYOUT', '?']);
    expect(t.log.slice(-4)).toEqual(['Active Layout: Layout2', 'Model', 'Layout1', 'Layout2']);
    await t.bus.script(['LAYOUT', 'C']);
    expect(t.log.at(-1)).toBe('LAYOUT Copy is not available yet.');
    await t.bus.script(['LAYOUT', 'T']);
    expect(t.log.at(-1)).toBe('LAYOUT Template is not available yet.');
    await t.bus.script(['LAYOUT', 'SA']);
    expect(t.log.at(-1)).toBe('LAYOUT SAveas is not available yet.');
  });

  it('New refuses a 256th layout', async () => {
    const start = DocumentModel.create(init());
    const b = new ChangeSetBuilder(start);
    for (let i = 3; i <= 255; i++) b.addLayout({ name: `L${i}` });
    start.apply(b.build());
    const bus = new PromptBus({ model: start, registry: builtinCommands() });
    const log: string[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['LAYOUT', 'N']);
    expect(log.at(-1)).toBe('A drawing can have 255 layouts at most.');
    expect(bus.command).toBeUndefined();
  });
});
