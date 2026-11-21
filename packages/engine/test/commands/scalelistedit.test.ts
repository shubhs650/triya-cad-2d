// M6-02 part 21: -SCALELISTEDIT, the drawing's scale list at the command line (AutoCAD 2024 Help,
// "-SCALELISTEDIT (Command)": "Enter option [?/Add/Delete/Reset/Exit] <Add>:").
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE_LIST,
  DocumentModel,
  PromptBus,
  builtinCommands,
  drawingScales,
  type BusEvent,
  type DrawingScale,
  type EntityInit,
  type ScaleListDialogRequest,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { entityInit, lineGeom, sampleInit } from '../model/fixtures';
import { host } from './edit-harness';

const DICT = '9F0';
const OPTIONS = 'Enter option [?/Add/Delete/Reset/Exit] <Add>:';

const scale = (handle: string, key: string, name: string, paper: number, drawing: number) =>
  ({
    type: 'SCALE',
    handle,
    owner: DICT,
    reactors: [DICT],
    key,
    name,
    paperUnits: paper,
    drawingUnits: drawing,
    unitScale: name === '1:1',
  }) satisfies DrawingScale;

const SCALES = [
  scale('A00', 'A0', '1:1', 1, 1),
  scale('A01', 'A1', '1:50', 1, 50),
  scale('A02', 'A2', '1:100', 1, 100),
];

function setup(
  o: {
    scales?: DrawingScale[];
    cannoscale?: string;
    entities?: EntityInit[];
    dialog?: (r: ScaleListDialogRequest) => ViewReply;
  } = {},
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    handSeed: 'B00',
    meta: { ...init.meta!, scaleListDictionary: DICT },
    header: new Map([
      ...(init.header ?? []),
      ...((o.cannoscale ? [['CANNOSCALE', o.cannoscale]] : []) as [string, string][]),
    ]),
    objects: [...(init.objects ?? []), ...(o.scales ?? SCALES)],
    entities: [...(init.entities ?? []), ...(o.entities ?? [])],
  });
  const base = host(() => model);
  const view: ViewHost = {
    request: (r) =>
      r.op === 'scaleListDialog' && o.dialog
        ? Promise.resolve(o.dialog({ scales: r.scales, defaults: r.defaults }))
        : base.request(r),
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const names = () => drawingScales(model).map((s) => s.name);
  return { model, bus, log, names };
}

describe('-SCALELISTEDIT', () => {
  it('asks for an option until Exit; ? lists the scales with their units', async () => {
    const t = setup();
    await t.bus.script(['-SCALELISTEDIT']);
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['?']);
    expect(t.bus.promptText).toBe('Enter scale name(s) to list <*>:');
    await t.bus.script(['']);
    expect(t.log.slice(-3)).toEqual([
      '1:1      1 paper units = 1 drawing units',
      '1:50     1 paper units = 50 drawing units',
      '1:100    1 paper units = 100 drawing units',
    ]);
    await t.bus.script(['?', '1:5*']);
    expect(t.log.at(-1)).toBe('1:50    1 paper units = 50 drawing units');
    await t.bus.script(['?', 'X']);
    expect(t.log.at(-1)).toBe('No matching scales found.');
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['E']);
    expect(t.bus.prompt).toBeUndefined();
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('Add (the default) makes a scale of a name and a ratio, at the end of the list', async () => {
    const t = setup();
    await t.bus.script(['-SCALELISTEDIT', '']);
    expect(t.bus.promptText).toBe('Enter name for new scale:');
    await t.bus.script(['1/4" = 1\'-0"']);
    expect(t.bus.promptText).toBe('Enter scale ratio:');
    await t.bus.script(['1:0']);
    expect(t.log.at(-1)).toBe('Invalid scale.');
    expect(t.bus.promptText).toBe('Enter scale ratio:');
    await t.bus.script(['0.25:12']);
    expect(t.bus.promptText).toBe(OPTIONS);
    expect(t.names()).toEqual(['1:1', '1:50', '1:100', '1/4" = 1\'-0"']);
    expect(drawingScales(t.model).at(-1)).toMatchObject({
      key: 'A3',
      paperUnits: 0.25,
      drawingUnits: 12,
    });
    // A name the list has is refused before the ratio.
    await t.bus.script(['A', '1:50']);
    expect(t.log.at(-1)).toBe('A scale named "1:50" already exists.');
    expect(t.bus.promptText).toBe(OPTIONS);
    await t.bus.script(['A', 'Site', '500', 'E']);
    expect(drawingScales(t.model).at(-1)).toMatchObject({ name: 'Site', paperUnits: 500 });
    // The whole command is one undo step.
    expect(t.bus.undo.state.undoable).toBe(1);
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['1:1', '1:50', '1:100']);
  });

  it('Delete removes the scales a name matches, but not the current one or one in use', async () => {
    const line = entityInit('300', lineGeom(0, 0, 1, 0), {
      annotative: { representations: [{ handle: '301', scale: 'A02', isDefault: true }] },
    });
    const t = setup({
      cannoscale: '1:1',
      scales: [...SCALES, scale('A03', 'A3', '1:5', 1, 5)],
      entities: [line],
    });
    await t.bus.script(['-SCALELISTEDIT', 'D']);
    expect(t.bus.promptText).toBe('Enter name of scale to delete:');
    await t.bus.script(['1:*']);
    expect(t.log.slice(-3)).toEqual([
      'Scale "1:1" is the current annotation scale and cannot be deleted.',
      'Scale "1:100" is used by an annotative object and cannot be deleted.',
      '2 scales deleted.',
    ]);
    expect(t.names()).toEqual(['1:1', '1:100']);
    await t.bus.script(['D', 'Nope']);
    expect(t.log.at(-1)).toBe('Cannot find scale "Nope".');
    await t.bus.script(['E']);
    expect(t.bus.prompt).toBeUndefined();
  });

  it('Reset asks first, then restores the default list', async () => {
    const t = setup({ scales: [scale('A00', 'A0', 'Site', 1, 500)] });
    await t.bus.script(['-SCALELISTEDIT', 'R']);
    expect(t.bus.promptText).toBe('Reset scale list to default entries? [Yes/No] <No>:');
    await t.bus.script(['']);
    expect(t.names()).toEqual(['Site']);
    await t.bus.script(['R', 'Y', 'E']);
    expect(t.names()).toEqual(DEFAULT_SCALE_LIST.map((s) => s.name));
  });

  it('a drawing without a scale list edits the metric list viewports offer', async () => {
    const t = setup({ scales: [] });
    await t.bus.script(['-SCALELISTEDIT', 'A', 'Site', '1:500', 'E']);
    expect(t.names()).toEqual([...DEFAULT_SCALE_LIST.slice(0, 17).map((s) => s.name), 'Site']);
  });

  it('SCALELISTEDIT opens Edit Drawing Scales on the list, each scale with how it is in use', async () => {
    const line = entityInit('300', lineGeom(0, 0, 1, 0), {
      annotative: { representations: [{ handle: '301', scale: 'A02', isDefault: true }] },
    });
    let asked: ScaleListDialogRequest | undefined;
    const t = setup({
      cannoscale: '1:1',
      entities: [line],
      dialog: (r) => {
        asked = r;
        return { ok: true };
      },
    });
    await t.bus.script(['SCALELISTEDIT']);
    expect(t.bus.command).toBeUndefined();
    expect(asked!.scales).toEqual([
      { handle: 'A00', name: '1:1', paperUnits: 1, drawingUnits: 1, use: 'current' },
      { handle: 'A01', name: '1:50', paperUnits: 1, drawingUnits: 50 },
      { handle: 'A02', name: '1:100', paperUnits: 1, drawingUnits: 100, use: 'object' },
    ]);
    expect(asked!.defaults).toEqual(DEFAULT_SCALE_LIST);
    // Cancel changes nothing.
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('the dialog’s OK makes its list in one undo step', async () => {
    const t = setup({
      dialog: (r) => ({
        ok: true,
        scaleList: [
          { ...r.scales[2]!, name: 'Hundred' },
          r.scales[0]!,
          { name: 'Site', paperUnits: 1, drawingUnits: 500 },
        ],
      }),
    });
    await t.bus.script(['SCALELISTEDIT']);
    expect(t.names()).toEqual(['Hundred', '1:1', 'Site']);
    expect(drawingScales(t.model)[0]).toMatchObject({ handle: 'A02', key: 'A0' });
    expect(t.bus.undo.state.undoable).toBe(1);
    await t.bus.script(['U']);
    expect(t.names()).toEqual(['1:1', '1:50', '1:100']);
  });

  it('an OK the drawing cannot take says why and changes nothing', async () => {
    const t = setup({
      dialog: (r) => ({ ok: true, scaleList: [...r.scales, { ...r.scales[0]! }] }),
    });
    await t.bus.script(['SCALELISTEDIT']);
    expect(t.log.at(-1)).toBe('A scale named "1:1" already exists.');
    expect(t.names()).toEqual(['1:1', '1:50', '1:100']);
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('SCALELISTEDIT without a dialog to show asks at the command line', async () => {
    const t = setup();
    await t.bus.script(['SCALELISTEDIT']);
    expect(t.bus.promptText).toBe(OPTIONS);
  });
});
