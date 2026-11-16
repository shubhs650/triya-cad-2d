// M4-10 part 1: UPDATEFIELD (AutoCAD 2024 Help, "UPDATEFIELD (Command)": "Manually updates
// fields in selected objects in the drawing"). Select objects: the fields of the TEXT, MTEXT,
// attribute definitions and block references' attributes selected are evaluated again, the
// text shows the new values, and the command reports how many fields it found and updated. One
// undo step undoes them all.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type DrawingField,
  type EntityId,
  type InsertAttribute,
  type InsertGeometry,
  type MTextGeometry,
  type TextGeometry,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const NOW = new Date(2026, 10, 16, 9, 30);

const field = (code: string, children: [string, string][]): DrawingField => ({
  evaluator: '_text',
  code,
  children: children.map(([c, value]) => ({
    evaluator: 'AcVar',
    code: c,
    children: [],
    objects: [],
    value,
  })),
  objects: [],
});

const text = (value: string, f?: DrawingField): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: '0',
  position: { x: 0, y: 0 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  ...(f ? { field: f } : {}),
});

const mtext = (contents: string, f: DrawingField): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  field: f,
  style: '0',
  position: { x: 0, y: 20 },
  height: 2.5,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

const attrib = (handle: string, tag: string, value: string, f?: DrawingField): InsertAttribute => ({
  handle,
  layer: LAYER_0,
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...text(value, f),
  tag,
  flags: 0,
});

function setup() {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    entities: [
      ...base.entities!,
      entityInit('50', text('1/1/2020', field('%<\\_FldIdx 0>%', [['\\AcVar Date', '1/1/2020']]))),
      entityInit(
        '51',
        mtext(
          '{\\C1;FILE:} Old.dxf\\PLAYOUT: Model',
          field('{\\C1;FILE:} %<\\_FldIdx 0>%\\PLAYOUT: %<\\_FldIdx 1>%', [
            ['\\AcVar Filename \\f "%fn6"', 'Old.dxf'],
            ['\\AcVar ctab \\f "%tc1"', 'Model'],
          ]),
        ),
        { owner: PAPER_SPACE },
      ),
      entityInit('52', {
        kind: 'INSERT',
        block: MODEL_SPACE,
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [
          attrib(
            '53',
            'DATE',
            '2020',
            field('%<\\_FldIdx 0>%', [['\\AcVar Date \\f "yyyy"', '2020']]),
          ),
          attrib('54', 'TITLE', 'PLAN'),
        ],
      } satisfies InsertGeometry),
      entityInit('55', text('No fields here')),
      entityInit(
        '56',
        text('2026', field('%<\\_FldIdx 0>%', [['\\AcVar Date \\f "yyyy"', '2026']])),
      ),
    ],
  });
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'sysvar' && r.name === 'DWGNAME')
        return Promise.resolve({ ok: true, value: 'Plan.dxf' });
      if (r.op === 'sysvar' && r.name === 'DWGPREFIX')
        return Promise.resolve({ ok: true, value: '' });
      return Promise.resolve({ ok: true });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    clock: { now: () => NOW },
  });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string): EntityId => [...model.entities()].find((e) => e.handle === h)!.id;
  const geom = <T>(h: string) => model.entity(id(h))!.geom as T;
  return { model, bus, log, id, geom };
}

describe('UPDATEFIELD', () => {
  it("updates the selected texts' fields and reports the count", async () => {
    const s = setup();
    await s.bus.submit('UPDATEFIELD');
    expect(s.bus.prompt?.kind).toBe('selection');
    await s.bus.answer({ kind: 'selection', ids: ['50', '51', '52', '55'].map(s.id) });
    expect(s.bus.command).toBeUndefined();
    expect(s.geom<TextGeometry>('50').value).toBe('11/16/2026');
    expect(s.geom<TextGeometry>('50').field!.children[0]!.value).toBe('11/16/2026');
    const m = s.geom<MTextGeometry>('51');
    expect(m.contents).toBe('{\\C1;FILE:} Plan.dxf\\PLAYOUT: LAYOUT1');
    expect(m.field!.children.map((c) => c.value)).toEqual(['Plan.dxf', 'LAYOUT1']);
    const attributes = s.geom<InsertGeometry>('52').attributes;
    expect(attributes.map((a) => a.value)).toEqual(['2026', 'PLAN']);
    expect(s.log).toContain('4 field(s) found.');
    expect(s.log).toContain('4 field(s) updated.');
    // Text without fields is left as it was.
    expect(s.geom<TextGeometry>('55').value).toBe('No fields here');
  });

  it('is undone as one step', async () => {
    const s = setup();
    await s.bus.submit('UPDATEFIELD');
    await s.bus.answer({ kind: 'selection', ids: ['50', '51'].map(s.id) });
    await s.bus.submit('U');
    expect(s.geom<TextGeometry>('50').value).toBe('1/1/2020');
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\C1;FILE:} Old.dxf\\PLAYOUT: Model');
  });

  it('counts a field already up to date as updated, changing nothing', async () => {
    const s = setup();
    await s.bus.submit('UPDATEFIELD');
    await s.bus.answer({ kind: 'selection', ids: [s.id('56')] });
    expect(s.log).toContain('1 field(s) found.');
    expect(s.log).toContain('1 field(s) updated.');
    expect(s.geom<TextGeometry>('56').value).toBe('2026');
  });

  it('reports none found when the selection has no fields', async () => {
    const s = setup();
    await s.bus.submit('UPDATEFIELD');
    await s.bus.answer({ kind: 'selection', ids: ['55', '20'].map(s.id) });
    expect(s.log).toContain('0 field(s) found.');
    expect(s.log.some((l) => l.includes('updated'))).toBe(false);
  });

  it('ends on an empty selection', async () => {
    const s = setup();
    await s.bus.submit('UPDATEFIELD');
    await s.bus.answer({ kind: 'selection', ids: [] });
    expect(s.bus.command).toBeUndefined();
    expect(s.log.some((l) => l.includes('field(s)'))).toBe(false);
  });

  it('keeps a field it cannot evaluate, and a file name when the app gives none', async () => {
    const s = setup();
    const quiet = new PromptBus({
      model: s.model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: 'no app' }) },
      clock: { now: () => NOW },
    });
    const log: string[] = [];
    quiet.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    await quiet.submit('UPDATEFIELD');
    await quiet.answer({ kind: 'selection', ids: [s.id('51')] });
    expect(s.geom<MTextGeometry>('51').contents).toBe('{\\C1;FILE:} Old.dxf\\PLAYOUT: LAYOUT1');
    expect(log).toContain('2 field(s) found.');
  });
});
