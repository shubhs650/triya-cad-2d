// M4-07 part 5: HATCH's Hatch and Gradient dialog and HATCHEDIT's Hatch Edit dialog, as the app
// drives them (AutoCAD 2024 Help, "Hatch and Gradient Dialog Box", "Hatch Edit Dialog Box",
// "HPDLGMODE"): the dialog's state goes back with each button, which picks in the drawing and
// opens the dialog again; OK makes or changes the hatch.
import { describe, expect, it } from 'vitest';
import type {
  HatchDialogButton,
  HatchDialogRequest,
  HatchDialogState,
  HatchSettings,
} from '../../src/index';
import { circle, setup, square } from './hatch-fixtures';

type Setup = ReturnType<typeof setup>;

/** A drawing whose app opens the hatch dialogs (HPDLGMODE 2, AutoCAD's initial value). */
const withDialogs = (geoms: Parameters<typeof setup>[0], mode = 2) =>
  setup(geoms, { variables: new Map([['HPDLGMODE', mode]]) });

const dialog = (s: Setup): HatchDialogRequest | undefined => {
  const p = s.bus.prompt;
  return p?.kind === 'dialog' && p.dialog.type === 'hatch' ? p.dialog : undefined;
};

/** The dialog's state, changed as `change` says, sent with `button` (OK when none). */
async function press(
  s: Setup,
  button?: HatchDialogButton,
  change: (d: HatchDialogState) => Partial<HatchDialogState> = () => ({}),
): Promise<void> {
  const d = dialog(s);
  expect(d, s.bus.promptText).toBeDefined();
  const { type: _t, edit: _e, layers: _l, boundaries: _b, boundarySet: _s, ...state } = d!;
  const next = { ...state, ...change(state) };
  await s.bus.answer({
    kind: 'dialog',
    action: button ? 'apply' : 'ok',
    hatch: { state: next, ...(button && { button }) },
  });
}

const settings = (change: Partial<HatchSettings>) => (d: HatchDialogState) => ({
  settings: { ...d.settings, ...change },
});

const PICK = 'Pick internal point or [Select objects/remove Boundaries/Undo]:';

describe('Hatch and Gradient dialog (HATCH, M4-07 part 5)', () => {
  it('opens at once when HPDLGMODE says so, on HATCH’s settings', async () => {
    const s = withDialogs(square(0, 0, 10));
    await s.bus.script(['HATCH']);
    const d = dialog(s)!;
    expect(d).toMatchObject({
      type: 'hatch',
      edit: false,
      tab: 'hatch',
      boundaries: 0,
      boundarySet: false,
      transparency: 'use current',
      specified: false,
      more: false,
    });
    expect(d.settings).toMatchObject({ pattern: 'TRIYA_LINES45', scale: 1, angle: 0 });
    expect(d.layers).toContain('0');
    expect(s.bus.promptText).toBe('Hatch and Gradient:');
  });

  it('picks points with the dialog closed, then makes the hatch on OK, keeping its settings', async () => {
    const s = withDialogs(square(0, 0, 10));
    await s.bus.script(['HATCH']);
    await press(s, 'pick', settings({ scale: 2, angle: Math.PI / 2 }));
    expect(s.bus.promptText).toBe(PICK);
    await s.bus.script(['5,5', '']);
    expect(dialog(s)).toMatchObject({ boundaries: 1, settings: { scale: 2 } });
    await press(s);
    expect(s.bus.command).toBeUndefined();
    const [h] = s.hatches();
    expect(h!.geom).toMatchObject({ pattern: 'TRIYA_LINES45', patternScale: 2 });
    expect(h!.geom.patternAngle).toBeCloseTo(Math.PI / 2);
    // HATCH opens on the settings it was left with.
    await s.bus.script(['HATCH']);
    expect(dialog(s)!.settings).toMatchObject({ scale: 2 });
  });

  it('selects objects, removes boundaries and undoes a pick before going back', async () => {
    const s = withDialogs([...square(0, 0, 10), circle(5, 5, 2), circle(50, 50, 3)]);
    await s.bus.script(['HATCH']);
    await press(s, 'select');
    expect(s.bus.promptText).toBe(
      'Select objects or [picK internal point/remove Boundaries/Undo]:',
    );
    await s.bus.pick({ x: 53, y: 50 });
    await s.bus.script(['', 'K', '1,1', 'U', '1,1', '']);
    expect(dialog(s)!.boundaries).toBe(2);
    await press(s, 'remove');
    expect(s.bus.promptText).toBe('Select objects or [Add boundaries]:');
    await s.bus.pick({ x: 7, y: 5 });
    await s.bus.script(['', '']);
    await press(s);
    // The circle selected, and the square without its circle island.
    expect(s.hatches().map((h) => h.geom.loops.length)).toEqual([2]);
  });

  it('shows the boundaries found (View Selections) and the hatch (Preview)', async () => {
    const s = withDialogs(square(0, 0, 10));
    await s.bus.script(['HATCH']);
    await press(s, 'pick');
    await s.bus.script(['5,5', '']);
    await press(s, 'view');
    expect(s.bus.promptText).toBe(' <Hit enter or right-click to return to the dialog>:');
    expect(s.previews.at(-1)!.map((g) => g.kind)).toEqual(['LWPOLYLINE']);
    await s.bus.script(['']);
    await press(s, 'preview');
    expect(s.bus.promptText).toBe(
      'Pick or press Esc to return to dialog or <Right-click to accept hatch>:',
    );
    expect(s.previews.at(-1)!.map((g) => g.kind)).toEqual(['HATCH']);
    // Esc goes back to the dialog; Enter (right-click) accepts the hatch.
    await s.bus.answer({ kind: 'escape' });
    expect(dialog(s)).toBeDefined();
    expect(s.hatches()).toHaveLength(0);
    await press(s, 'preview');
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.hatches()).toHaveLength(1);
  });

  it('places the pattern at the origin set, the extents’ corner or centre, stored when asked', async () => {
    const s = withDialogs(square(10, 10, 10));
    await s.bus.script(['HATCH']);
    await press(s, 'origin');
    expect(s.bus.promptText).toBe('Specify origin point:');
    await s.bus.script(['3,4']);
    expect(dialog(s)).toMatchObject({ specified: true, origin: { x: 3, y: 4 } });
    await press(s, 'pick');
    await s.bus.script(['15,15', '']);
    await press(s);
    expect(s.hatches()[0]!.geom.patternLines[0]!.base).toEqual({ x: 3, y: 4 });
    // Not stored: the next hatch starts from HPORIGIN again.
    await s.bus.script(['HATCH']);
    expect(dialog(s)).toMatchObject({ specified: false, origin: { x: 0, y: 0 } });
    await press(s, 'pick', () => ({ specified: true, extents: 5, storeOrigin: true }));
    await s.bus.script(['15,15', '']);
    await press(s);
    expect(s.hatches()[1]!.geom.patternLines[0]!.base).toEqual({ x: 15, y: 15 });
    await s.bus.script(['HATCH']);
    expect(dialog(s)!.extents).toBe(5);
    await press(s, 'pick', () => ({ specified: true, extents: 2 }));
    await s.bus.script(['15,15', '']);
    await press(s);
    expect(s.hatches()[2]!.geom.patternLines[0]!.base).toEqual({ x: 20, y: 10 });
  });

  it('inherits a hatch’s properties, then picks points', async () => {
    const s = withDialogs([...square(0, 0, 10), ...square(20, 0, 10)]);
    await s.bus.script(['-HATCH', 'P', 'MINE', '3', '0', 'LA', 'WALLS', 'T', '40', '5,5', '']);
    await s.bus.script(['HATCH']);
    await press(s, 'inherit');
    expect(s.bus.promptText).toBe('Select hatch object:');
    await s.bus.script(['L']);
    expect(s.bus.promptText).toBe(PICK);
    await s.bus.script(['25,5', '']);
    expect(dialog(s)).toMatchObject({
      transparency: '40',
      settings: { pattern: 'MINE', custom: true, scale: 3, layer: 'WALLS' },
    });
    await press(s);
    const [, h] = s.hatches();
    expect(h!.geom).toMatchObject({ pattern: 'MINE', patternType: 2, patternScale: 3 });
  });

  it('sets HPTRANSPARENCY and makes separate hatches as its Options say', async () => {
    const s = withDialogs([...square(0, 0, 10), ...square(20, 0, 10)]);
    await s.bus.script(['HATCH']);
    await press(s, 'pick', (d) => ({
      transparency: '25',
      settings: { ...d.settings, separate: true, drawOrder: 'front' },
    }));
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('25');
    await s.bus.script(['5,5', '25,5', '']);
    await press(s);
    expect(s.hatches()).toHaveLength(2);
    expect(s.hatches()[0]!.transparency).toEqual({ alpha: 191 });
    const order = s.order();
    expect(order.slice(-2)).toEqual(s.hatches().map(s.handleOf));
  });

  it('chooses a new boundary set (More options)', async () => {
    const s = withDialogs([...square(0, 0, 10), ...square(2, 2, 6)]);
    await s.bus.script(['HATCH']);
    await press(s, 'boundarySet');
    expect(s.bus.promptText).toBe('Select objects:');
    // Only the outer square bounds hatches: the inner one is no island.
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.pick({ x: 5, y: 10 });
    await s.bus.pick({ x: 0, y: 5 });
    await s.bus.script(['']);
    expect(dialog(s)!.boundarySet).toBe(true);
    await press(s, 'pick');
    await s.bus.script(['5,5', '']);
    await press(s);
    expect(s.hatches()[0]!.geom.loops).toHaveLength(1);
  });

  it('makes nothing on OK without boundaries; Esc cancels', async () => {
    const s = withDialogs(square(0, 0, 10));
    await s.bus.script(['HATCH']);
    await press(s);
    expect(s.bus.command).toBeUndefined();
    expect(s.hatches()).toHaveLength(0);
    await s.bus.script(['HATCH']);
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
  });

  it('opens on the Gradient tab for GRADIENT, and from HATCH’s seTtings with HPDLGMODE 0', async () => {
    const g = withDialogs(square(0, 0, 10));
    await g.bus.script(['GRADIENT']);
    expect(dialog(g)).toMatchObject({ tab: 'gradient', settings: { pattern: 'GR_LINEAR' } });
    const s = withDialogs(square(0, 0, 10), 0);
    await s.bus.script(['HATCH']);
    expect(s.bus.promptText).toBe('Pick internal point or [Select objects/Undo/seTtings]:');
    await s.bus.script(['5,5']);
    expect(s.bus.promptText).toBe(
      'Pick internal point or [Select objects/remove Boundaries/Undo/seTtings]:',
    );
    await s.bus.script(['T']);
    expect(dialog(s)).toMatchObject({ boundaries: 1, tab: 'hatch' });
    await press(s, undefined, settings({ pattern: 'SOLID' }));
    expect(s.hatches()[0]!.geom).toMatchObject({ pattern: 'SOLID', solid: true });
  });
});

describe('Hatch Edit dialog (HATCHEDIT, M4-07 part 5)', () => {
  /** Two squares, one hatched, with the dialogs on. */
  async function hatched() {
    const s = withDialogs([...square(0, 0, 10), ...square(20, 0, 10), circle(5, 5, 2)]);
    await s.bus.script(['-HATCH', '1,1', '']);
    return s;
  }

  it('opens on the hatch’s settings, and from a double click', async () => {
    const s = await hatched();
    await s.bus.script(['HATCHEDIT', 'L']);
    const d = dialog(s)!;
    expect(d).toMatchObject({
      edit: true,
      boundaries: 2,
      settings: { pattern: 'TRIYA_LINES45', drawOrder: 'none', separate: false, layer: 'WALLS' },
    });
    expect(s.bus.promptText).toBe('Hatch Edit:');
    await s.bus.cancel();
    const t = setup(square(0, 0, 10), {
      variables: new Map([['HPDLGMODE', 2]]),
      pickAt: (m) => [...m.entities()].filter((e) => e.geom.kind === 'HATCH').map((e) => e.id),
    });
    await t.bus.script(['-HATCH', '5,5', '']);
    await t.bus.doubleClick({ x: 5, y: 5 });
    expect(dialog(t)).toMatchObject({ edit: true, boundaries: 1 });
  });

  it('changes the pattern, style, transparency and layer as one undo step', async () => {
    const s = await hatched();
    const was = s.hatches()[0]!;
    await s.bus.script(['HATCHEDIT', 'L']);
    await press(s, undefined, (d) => ({
      transparency: '50',
      settings: { ...d.settings, scale: 2, style: 'outer', layer: 'HATCHES' },
    }));
    expect(s.bus.command).toBeUndefined();
    const h = s.hatches()[0]!;
    expect(h.id).toBe(was.id);
    expect(h.geom).toMatchObject({ patternScale: 2, style: 1 });
    expect(h.transparency).toEqual({ alpha: 128 });
    expect(s.model.tables.layers.get(h.layer)!.name).toBe('HATCHES');
    await s.bus.script(['U']);
    expect(s.hatches()[0]!.geom).toEqual(was.geom);
    expect(s.hatches()[0]!.transparency).toEqual(was.transparency);
    expect(s.hatches()[0]!.layer).toBe(was.layer);
  });

  it('adds and removes boundaries, then separates the hatch', async () => {
    const s = await hatched();
    await s.bus.script(['HATCHEDIT', 'L']);
    await press(s, 'pick');
    expect(s.bus.promptText).toBe(PICK);
    await s.bus.script(['25,5', '']);
    expect(dialog(s)!.boundaries).toBe(3);
    // The circle island taken out.
    await press(s, 'remove');
    expect(s.bus.promptText).toBe('Select Objects:');
    await s.bus.pick({ x: 7, y: 5 });
    await s.bus.script(['']);
    expect(dialog(s)!.boundaries).toBe(2);
    await press(s, undefined, settings({ separate: true }));
    const hs = s.hatches();
    expect(hs).toHaveLength(2);
    expect(hs.map((h) => h.geom.loops.length)).toEqual([1, 1]);
  });

  it('keeps one boundary at least', async () => {
    const s = withDialogs(square(0, 0, 10));
    await s.bus.script(['-HATCH', '5,5', '', 'HATCHEDIT', 'L']);
    await press(s, 'remove');
    await s.bus.pick({ x: 5, y: 0 });
    await s.bus.script(['']);
    expect(s.log).toContain('A hatch keeps at least one boundary.');
    expect(dialog(s)!.boundaries).toBe(1);
  });

  it('previews the hatch as edited, and moves its origin to the extents’ corner', async () => {
    const s = await hatched();
    await s.bus.script(['HATCHEDIT', 'L']);
    await press(s, 'preview', () => ({ specified: true, extents: 1 }));
    const preview = s.previews.at(-1)![0]!;
    expect(preview.kind).toBe('HATCH');
    expect(s.hatches()[0]!.geom.patternLines[0]!.base).toEqual({ x: 0, y: 0 });
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    expect(s.hatches()[0]!.geom.patternLines[0]!.base).toEqual({ x: 0, y: 0 });
    await s.bus.script(['HATCHEDIT', 'L']);
    await press(s, undefined, () => ({ specified: true, extents: 3 }));
    expect(s.hatches()[0]!.geom.patternLines[0]!.base).toEqual({ x: 10, y: 10 });
  });

  it('turns a pattern into a gradient and brings the hatch to the front', async () => {
    const s = await hatched();
    expect(s.order()[0]).toBe(s.handleOf(s.hatches()[0]!));
    await s.bus.script(['HATCHEDIT', 'L']);
    await press(s, undefined, (d) => ({
      tab: 'gradient',
      settings: { ...d.settings, pattern: 'GR_SPHER', drawOrder: 'front' },
    }));
    const h = s.hatches()[0]!;
    expect(h.geom).toMatchObject({ solid: true, gradient: { name: 'SPHERICAL' } });
    expect(s.order().at(-1)).toBe(s.handleOf(h));
  });

  it('keeps -HATCHEDIT’s prompts with HPDLGMODE 0', async () => {
    const s = withDialogs(square(0, 0, 10), 0);
    await s.bus.script(['-HATCH', '5,5', '', 'HATCHEDIT', 'L']);
    expect(s.bus.promptText).toMatch(/^Enter hatch option/);
  });
});
