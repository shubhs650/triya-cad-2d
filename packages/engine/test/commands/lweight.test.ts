// M5-08 part 3: LWEIGHT and -LWEIGHT, as AutoCAD 2024's (AutoCAD Help, "LWEIGHT (Command)",
// "Lineweight Settings Dialog Box", "-LWEIGHT (Command)", "LWDEFAULT", "LWUNITS"):
//   - LWEIGHT opens Lineweight Settings on CELWEIGHT; OK makes the lineweight chosen current, one
//     LWEIGHT undo step (the dialog sets LWUNITS, LWDISPLAY and LWDEFAULT itself, in the app);
//   - -LWEIGHT shows the current lineweight in LWUNITS' units, takes ByLayer, ByBlock, Default or
//     a number in those units (the nearest lineweight to one that is not), and lIst lists them.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  lineweightText,
  lineweightTyped,
  nearestLineweight,
  type BusEvent,
  type DialogRequest,
  type ViewHost,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

function drawing(lwunits?: number) {
  const model = DocumentModel.create({
    ...sampleInit(),
    header: new Map([...(sampleInit().header ?? []), ['$CELWEIGHT', -1]]),
  });
  const log: string[] = [];
  const view: ViewHost = {
    request: (r) =>
      Promise.resolve(
        r.op === 'sysvar' && r.name === 'LWUNITS' && lwunits !== undefined
          ? { ok: true, value: lwunits }
          : { ok: false, message: 'no view' },
      ),
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { model, bus, log };
}

describe('lineweights as LWUNITS lists them', () => {
  it('shows millimetres to two places and inches to three, as AutoCAD lists them', () => {
    expect(lineweightText(25)).toBe('0.25 mm');
    expect(lineweightText(0, 'mm')).toBe('0.00 mm');
    expect(lineweightText(25, 'in')).toBe('0.010"');
    expect(lineweightText(5, 'in')).toBe('0.002"');
    expect(lineweightText(211, 'in')).toBe('0.083"');
    expect(lineweightText('ByLayer', 'in')).toBe('ByLayer');
  });

  it('reads names, numbers in the units, and the nearest lineweight to any other number', () => {
    expect(lineweightTyped('bylayer')).toBe('ByLayer');
    expect(lineweightTyped('BYBLOCK')).toBe('ByBlock');
    expect(lineweightTyped('default')).toBe('Default');
    expect(lineweightTyped('0.35')).toBe(35);
    expect(lineweightTyped('0.35 mm')).toBe(35);
    expect(lineweightTyped('0.33')).toBe(35);
    expect(lineweightTyped('5')).toBe(211);
    expect(lineweightTyped('0.010', 'in')).toBe(25);
    expect(lineweightTyped('0.02"', 'in')).toBe(50);
    expect(lineweightTyped('')).toBeUndefined();
    expect(lineweightTyped('wide')).toBeUndefined();
    expect(lineweightTyped('-1')).toBeUndefined();
    // Halfway between 0.09 and 0.13 mm: the thinner.
    expect(nearestLineweight(11)).toBe(9);
  });
});

describe('LWEIGHT: Lineweight Settings', () => {
  it('opens on CELWEIGHT and OK makes the lineweight chosen current, one LWEIGHT step', async () => {
    const t = drawing();
    await t.bus.script(['LW']);
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest };
    expect(p.kind).toBe('dialog');
    expect(p.dialog).toEqual({ type: 'lweight', lineweight: 'ByLayer' });
    await t.bus.answer({ kind: 'dialog', action: 'ok', lineweight: 50 });
    expect(t.model.header.get('$CELWEIGHT')).toBe(50);
    expect(t.bus.undo.state.nextUndo).toBe('LWEIGHT');
    expect(t.bus.command).toBeUndefined();

    await t.bus.script(['LWEIGHT']);
    expect((t.bus.prompt as { dialog?: DialogRequest }).dialog).toEqual({
      type: 'lweight',
      lineweight: 50,
    });
    await t.bus.answer({ kind: 'dialog', action: 'ok', lineweight: 'Default' });
    expect(t.model.header.get('$CELWEIGHT')).toBe(-3);
  });

  it('makes no undo step when OK keeps the lineweight or the dialog is cancelled', async () => {
    const t = drawing();
    await t.bus.script(['LWEIGHT']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', lineweight: 'ByLayer' });
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
    await t.bus.script(['LWEIGHT']);
    await t.bus.cancel();
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
    await t.bus.script(['LWEIGHT']);
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
    expect(t.model.header.get('$CELWEIGHT')).toBe(-1);
  });
});

describe('-LWEIGHT', () => {
  it('shows the current lineweight and sets one typed in millimetres', async () => {
    const t = drawing();
    await t.bus.script(['-LWEIGHT']);
    expect(t.log).toContain('Current lineweight: ByLayer');
    expect(t.bus.prompt?.message).toBe('Enter default lineweight for new objects');
    expect(t.bus.prompt?.options).toEqual(['lIst']);
    await t.bus.script(['0.3']);
    expect(t.model.header.get('$CELWEIGHT')).toBe(30);
    expect(t.bus.undo.state.nextUndo).toBe('LWEIGHT');
    await t.bus.script(['-LW']);
    expect(t.log).toContain('Current lineweight: 0.30 mm');
    await t.bus.script(['byblock']);
    expect(t.model.header.get('$CELWEIGHT')).toBe(-2);
  });

  it('takes the nearest lineweight, refuses text, and Enter changes nothing', async () => {
    const t = drawing();
    await t.bus.script(['-LWEIGHT', 'thick']);
    expect(t.log).toContain('Invalid lineweight.');
    expect(t.bus.command).toBeDefined();
    await t.bus.script(['0.42']);
    expect(t.model.header.get('$CELWEIGHT')).toBe(40);
    await t.bus.script(['-LWEIGHT', '']);
    expect(t.model.header.get('$CELWEIGHT')).toBe(40);
    expect(t.bus.command).toBeUndefined();
  });

  it('lists and reads inches under LWUNITS 0', async () => {
    const t = drawing(0);
    await t.bus.script(['-LWEIGHT', 'I']);
    const list = t.log.find((l) => l.startsWith('ByLayer, ByBlock, Default, 0.000"'));
    expect(list).toContain('0.010"');
    expect(list).toMatch(/0\.083"$/);
    await t.bus.script(['0.020']);
    expect(t.model.header.get('$CELWEIGHT')).toBe(50);
    await t.bus.script(['-LWEIGHT']);
    expect(t.log).toContain('Current lineweight: 0.020"');
  });
});
