// M4-11: TOLERANCE (TOL) and TEXTEDIT on a feature control frame, scripted on the PromptBus as
// AutoCAD 2024's "TOLERANCE (Command)": the Geometric Tolerance dialog, then "Enter tolerance
// location:", the frame dragged there; a double click (TEXTEDIT) opens the dialog on the frame.
import { describe, expect, it } from 'vitest';
import {
  DOUBLE_CLICK,
  PromptBus,
  builtinCommands,
  type EntityGeometry,
  EMPTY_GDT_FRAME,
  doubleClickCommand,
  toleranceFrame,
  type GdtFrame,
  type ToleranceGeometry,
} from '../../src/index';
import { entityInit } from '../model/fixtures';
import { STYLE, said, setup, standard } from './dimension-harness';

const POSITION: GdtFrame = {
  ...EMPTY_GDT_FRAME,
  rows: [
    {
      ...EMPTY_GDT_FRAME.rows[0],
      symbol: 'j',
      tolerance1: { diameter: true, value: '0.1', material: 'm' },
      datum1: { value: 'A', material: '' },
    },
    EMPTY_GDT_FRAME.rows[1],
  ],
};
const POSITION_TEXT = '{\\Fgdt;j}%%v{\\Fgdt;n}0.1{\\Fgdt;m}%%v%%vA%%v%%v';

describe('TOLERANCE', () => {
  it('opens the empty Geometric Tolerance dialog, then places the frame dragged', async () => {
    const { bus, added, model, prompts } = setup({ header: [['$CLAYER', '0']] });
    await bus.submit('TOL');
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      message: 'Geometric Tolerance',
      dialog: { type: 'tolerance', frame: EMPTY_GDT_FRAME },
    });
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    expect(prompts.at(-1)).toBe('Enter tolerance location:');
    expect(bus.prompt).toMatchObject({ kind: 'point', drag: { kind: 'preview' } });
    await bus.submit('10,20');
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(1);
    const e = added()[0]!;
    expect(e.type).toBe('TOLERANCE');
    expect(e.geom).toEqual({
      kind: 'TOLERANCE',
      style: STYLE,
      position: { x: 10, y: 20 },
      rotation: 0,
      text: POSITION_TEXT,
    } satisfies ToleranceGeometry);
    expect(toleranceFrame((e.geom as ToleranceGeometry).text)).toEqual(POSITION);
    // One undo step.
    await bus.submit('U');
    expect(added()).toHaveLength(0);
    expect(model.version).toBeGreaterThan(0);
  });

  it('turns the frame with the current UCS and makes it with the header’s DIMVAR overrides', async () => {
    const { bus, added } = setup({
      styles: [standard({ DIMTXT: 2.5 })],
      header: [
        ['$UCSORG', { x: 0, y: 0, z: 0 }],
        ['$UCSXDIR', { x: 0, y: 1, z: 0 }],
        ['$UCSYDIR', { x: -1, y: 0, z: 0 }],
        ['$DIMTXT', 5],
      ],
    });
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    await bus.submit('0,0');
    const e = added()[0]!;
    expect((e.geom as ToleranceGeometry).rotation).toBeCloseTo(Math.PI / 2);
    expect(JSON.stringify(e.xdata)).toContain('DSTYLE');
  });

  it('places nothing on Cancel, on OK with every field empty, or on Esc at the location', async () => {
    const { bus, added } = setup();
    await bus.submit('TOLERANCE');
    await bus.cancel();
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: EMPTY_GDT_FRAME });
    expect(bus.command).toBeUndefined();
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok' });
    expect(bus.command).toBeUndefined();
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    await bus.cancel();
    expect(added()).toHaveLength(0);
  });

  it('drags the frame’s compartments, laid out in the widths the renderer measures', async () => {
    const { bus } = setup({ styles: [standard({ DIMTXT: 2, DIMGAP: 0.5 })] });
    let preview: readonly EntityGeometry[] = [];
    bus.on((e) => {
      if (e.type === 'preview') preview = e.geometry;
    });
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    // Symbol, tolerance and datum A: a frame and its text each, from the insertion point.
    expect(preview.map((g) => g.kind)).toEqual([
      'LWPOLYLINE',
      'MTEXT',
      'LWPOLYLINE',
      'MTEXT',
      'LWPOLYLINE',
      'MTEXT',
    ]);
    expect(preview[0]).toMatchObject({
      vertices: [{ x: 0, y: 1.5 }, { y: 1.5 }, { y: -1.5 }, { x: 0, y: -1.5 }],
    });
    await bus.cancel();
    expect(preview).toEqual([]);
  });

  it('drags nothing where the renderer cannot measure the text', async () => {
    const model = setup().model;
    const bus = new PromptBus({ model, registry: builtinCommands() });
    let preview: readonly EntityGeometry[] | undefined;
    bus.on((e) => {
      if (e.type === 'preview') preview ??= e.geometry;
    });
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    expect(preview).toEqual([]);
    expect(bus.promptText).toBe('Enter tolerance location:');
    await bus.cancel();
  });

  it('says so in a drawing without a dimension style', async () => {
    const { bus, added } = setup({ styles: [] });
    await bus.submit('TOLERANCE');
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    expect(said(bus)).toContain('The drawing has no dimension style.');
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(0);
  });
});

describe('TEXTEDIT on a feature control frame', () => {
  const FRAME = '900';
  const frameInit = (text: string) =>
    entityInit(FRAME, {
      kind: 'TOLERANCE',
      style: STYLE,
      position: { x: 5, y: 5 },
      rotation: 0,
      text,
    });

  it('opens the Geometric Tolerance dialog on the frame and writes what OK leaves', async () => {
    const { bus, model } = setup({ entities: [frameInit(POSITION_TEXT)] });
    const id = model.entityByHandle(FRAME)!.id;
    expect(doubleClickCommand(model.entity(id))).toBe('TEXTEDIT');
    expect(DOUBLE_CLICK.TOLERANCE).toBe('TEXTEDIT');
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      message: 'Geometric Tolerance',
      dialog: { type: 'tolerance', frame: POSITION },
    });
    const next: GdtFrame = { ...POSITION, datumIdentifier: 'B' };
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: next });
    expect((model.entity(id)!.geom as ToleranceGeometry).text).toBe(`${POSITION_TEXT}\nB`);
    // Multiple mode asks for the next object; Undo takes the edit back.
    await bus.submit('U');
    expect((model.entity(id)!.geom as ToleranceGeometry).text).toBe(POSITION_TEXT);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('keeps text the dialog cannot show when OK changes nothing, and refuses an empty frame', async () => {
    // Codes the dialog does not offer (a seventh compartment) stay as they are.
    const odd = `${POSITION_TEXT}%%vextra`;
    const { bus, model } = setup({ entities: [frameInit(odd)] });
    const id = model.entityByHandle(FRAME)!.id;
    const version = model.version;
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: POSITION });
    expect(model.version).toBe(version);
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.answer({ kind: 'dialog', action: 'ok', tolerance: EMPTY_GDT_FRAME });
    expect(said(bus)).toContain(
      'A feature control frame cannot be empty: ERASE removes the frame.',
    );
    expect((model.entity(id)!.geom as ToleranceGeometry).text).toBe(odd);
    // Cancel ends TEXTEDIT, as Esc in its other dialogs does.
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(model.version).toBe(version);
  });
});
