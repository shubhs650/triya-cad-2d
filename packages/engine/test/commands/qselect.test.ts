// M3-04 part 2: QSELECT and its Quick Select dialog, as AutoCAD 2024's (AutoCAD Help, "Quick
// Select Dialog Box"): Apply to the entire drawing or the current selection, an Object type
// ("Multiple" for all), a property of that type, an Operator (Equals, Not Equal, Greater Than,
// Less Than, *Wildcard Match, Select All), a Value, Include in or Exclude from the new
// selection set, and Append to Current Selection Set. What it selects stays selected at
// `Command:`, gripped, as a pick would leave it.
import { describe, expect, it } from 'vitest';
import {
  quickSelect,
  type DialogRequest,
  type EntityGeometry,
  type QuickSelectCriteria,
} from '../../src/index';
import { LAYER_WALLS } from '../model/fixtures';
import { setup } from './edit-harness';

const text = (value: string, x = 20): EntityGeometry => ({
  kind: 'TEXT',
  value,
  style: '16',
  position: { x, y: 20 },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});
const circle = (x: number, r: number): EntityGeometry => ({
  kind: 'CIRCLE',
  center: { x, y: 50 },
  radius: r,
});
const RED = { color: { kind: 'aci' as const, index: 1 } };

/**
 * 30 a line and 31 a circle of radius 5 on layer 0; on WALLS 40 a red circle of radius 2, 41 a
 * circle of radius 10, 42 a red line, 43 and 44 texts "DOOR 1" and "WINDOW 2".
 */
function drawing() {
  const t = setup([
    [circle(0, 2), RED],
    circle(30, 10),
    [{ kind: 'LINE', start: { x: 0, y: 70 }, end: { x: 9, y: 70 } }, RED],
    text('DOOR 1'),
    text('WINDOW 2', 40),
  ]);
  const handles = () => t.bus.selection.map((id) => String(t.model.ids.handleOf(id))).sort();
  const dialog = () => {
    const p = t.bus.prompt;
    return p?.kind === 'dialog'
      ? (p.dialog as Extract<DialogRequest, { type: 'qselect' }>)
      : undefined;
  };
  const ok = (c: Partial<QuickSelectCriteria>) =>
    t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      qselect: { ...dialog()!.criteria, ...c },
    });
  return { ...t, handles, dialog, ok };
}

describe('QSELECT', () => {
  it('opens Quick Select on the entire drawing, with its object types and their properties', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    const d = t.dialog()!;
    expect(t.bus.promptText).toBe('Quick Select:');
    expect(d.criteria).toEqual({
      applyTo: 'drawing',
      type: 'MULTIPLE',
      key: 'color',
      operator: '=',
      value: 'ByLayer',
      include: true,
      append: false,
    });
    expect(d.selected).toBe(0);
    expect(d.drawing.map((x) => x.label)).toEqual(['Multiple', 'Circle', 'Line', 'Text']);
    // Multiple offers the General properties only; a type its own as well.
    const multiple = d.drawing[0]!.rows.map((r) => r.label);
    expect(multiple).toContain('Layer');
    expect(multiple).not.toContain('Radius');
    const circles = d.drawing.find((x) => x.type === 'CIRCLE')!;
    expect(circles.rows.map((r) => r.label)).toEqual(expect.arrayContaining(['Color', 'Radius']));
    const layer = circles.rows.find((r) => r.key === 'layer')!;
    expect(layer.options?.map((o) => o.label)).toEqual(['0', 'WALLS']);
    expect(d.selection).toEqual([]);
  });

  it('Equals on a choice: the red objects, said as AutoCAD says it', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.ok({ key: 'color', operator: '=', value: 'aci:1' });
    expect(t.bus.command).toBeUndefined();
    expect(t.handles()).toEqual(['40', '42']);
    expect(t.log.at(-1)).toBe('2 item(s) selected.');
  });

  it('Not Equal, Greater Than and Less Than on one type', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'CIRCLE', key: 'radius', operator: '>', value: '4' });
    expect(t.handles()).toEqual(['31', '41']);
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'CIRCLE', key: 'radius', operator: '<', value: '5', applyTo: 'drawing' });
    expect(t.handles()).toEqual(['40']);
    await t.bus.submit('QSELECT');
    await t.ok({
      applyTo: 'drawing',
      type: 'CIRCLE',
      key: 'layer',
      operator: '<>',
      value: LAYER_WALLS,
    });
    expect(t.handles()).toEqual(['31']);
  });

  it('Equals on a number holds within the precision the drawing shows (LUPREC 4)', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'CIRCLE', key: 'radius', operator: '=', value: '10.00003' });
    expect(t.handles()).toEqual(['41']);
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'CIRCLE', key: 'radius', operator: '=', value: 'ten', applyTo: 'drawing' });
    expect(t.handles()).toEqual([]);
    expect(t.log.at(-1)).toBe('0 item(s) selected.');
  });

  it('Wildcard Match on text, and Select All for a whole type', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'TEXT', key: 'contents', operator: '*', value: 'win*' });
    expect(t.handles()).toEqual(['44']);
    await t.bus.submit('QSELECT');
    await t.ok({ applyTo: 'drawing', type: 'LINE', operator: 'all' });
    expect(t.handles()).toEqual(['30', '42']);
  });

  it('Exclude makes the set of everything that does not match', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'CIRCLE', operator: 'all', include: false });
    expect(t.handles()).toEqual(['30', '42', '43', '44']);
  });

  it('applies to the current selection, which it opens on, or appends to it', async () => {
    const t = drawing();
    // A crossing window round the line 30 and the circle 31 (and nothing else) at `Command:`.
    await t.bus.pick({ x: 60, y: -6 });
    await t.bus.pick({ x: -1, y: 6 });
    expect(t.handles()).toEqual(['30', '31']);
    await t.bus.submit('QSELECT');
    const d = t.dialog()!;
    expect(d.selected).toBe(2);
    expect(d.criteria.applyTo).toBe('selection');
    expect(d.selection.map((x) => x.label)).toEqual(['Multiple', 'Circle', 'Line']);
    await t.ok({ type: 'MULTIPLE', key: 'layer', operator: '=', value: '10' });
    expect(t.handles()).toEqual(['30', '31']);
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'LINE', operator: 'all' });
    expect(t.handles()).toEqual(['30']);
    // Append applies to the entire drawing and adds to what is selected.
    await t.bus.submit('QSELECT');
    await t.ok({ type: 'TEXT', operator: 'all', append: true });
    expect(t.handles()).toEqual(['30', '43', '44']);
  });

  it('Select objects closes the dialog for a selection, then opens again on it', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.bus.answer({
      kind: 'dialog',
      action: 'select',
      qselect: { ...t.dialog()!.criteria, type: 'CIRCLE', key: 'radius', operator: '>' },
    });
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.submit('ALL');
    await t.bus.submit('');
    const d = t.dialog()!;
    expect(d.selected).toBe(7);
    expect(d.criteria).toMatchObject({ applyTo: 'selection', type: 'CIRCLE', key: 'radius' });
    await t.ok({ value: '3' });
    expect(t.handles()).toEqual(['31', '41']);
  });

  it('Select objects with a pre-selection asks afresh; selecting nothing keeps what it had', async () => {
    const t = drawing();
    await t.bus.pick({ x: 60, y: -6 });
    await t.bus.pick({ x: -1, y: 6 });
    await t.bus.submit('QSELECT');
    await t.bus.answer({ kind: 'dialog', action: 'select' });
    expect(t.bus.promptText).toBe('Select objects:');
    await t.bus.submit('');
    expect(t.dialog()!.selected).toBe(2);
    await t.ok({ type: 'CIRCLE', operator: 'all' });
    expect(t.handles()).toEqual(['31']);
  });

  it('Cancel (Esc) selects nothing new', async () => {
    const t = drawing();
    await t.bus.submit('QSELECT');
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    expect(t.handles()).toEqual([]);
  });
});

describe('quickSelect', () => {
  it('a value no object has matches nothing; Not Equal matches all', () => {
    const t = drawing();
    const all = t.model.blockEntities('1F');
    const c = (x: Partial<QuickSelectCriteria>): QuickSelectCriteria => ({
      applyTo: 'drawing',
      type: 'MULTIPLE',
      key: 'radius',
      operator: '=',
      value: '7',
      include: true,
      append: false,
      ...x,
    });
    expect(quickSelect(t.model, all, c({}))).toEqual([]);
    expect(quickSelect(t.model, all, c({ operator: '<>' }))).toHaveLength(all.length);
    // Greater Than and Wildcard take no text a number cannot be read from.
    expect(quickSelect(t.model, all, c({ type: 'CIRCLE', operator: '>', value: '' }))).toEqual([]);
    expect(quickSelect(t.model, all, c({ type: 'TEXT', key: 'layer', operator: '*' }))).toEqual([]);
  });
});
