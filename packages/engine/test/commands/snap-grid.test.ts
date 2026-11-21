// M3-06 part 2: the Drafting Settings dialog's Snap and Grid tab (AutoCAD 2024 Help, "Snap and
// Grid Tab (Drafting Settings Dialog Box)") and the SNAP and GRID commands ("SNAP (Command)",
// "GRID (Command)"). SNAPUNIT, GRIDUNIT and GRIDMAJOR are the drawing's, kept in the model-space
// `*Active` VPORT as AutoCAD keeps them in the current viewport; SNAPMODE and GRIDMODE are kept
// there too (M6-02 part 19: DXF 75 and 76), and a drawing without one turns the app's status bar
// toggles through the view host.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type ViewHost,
  type ViewReply,
  type VportRecord,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

const VPORT = '29';

function vport(o: Partial<VportRecord> = {}): VportRecord {
  return {
    handle: VPORT,
    name: '*Active',
    center: { x: 0, y: 0 },
    height: 10,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    twist: 0,
    viewMode: 0,
    renderMode: 0,
    lowerLeft: { x: 0, y: 0 },
    upperRight: { x: 1, y: 1 },
    aspectRatio: 1,
    snapBase: { x: 0, y: 0 },
    snapSpacing: { x: 10, y: 10 },
    snapRotation: 0,
    snapOn: false,
    isometricSnap: false,
    isometricPlane: 0,
    gridSpacing: { x: 10, y: 10 },
    gridOn: false,
    gridFlags: 0,
    gridMajor: 5,
    circleZoom: 1000,
    ucsIcon: 3,
    ucs: {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      elevation: 0,
      orthographic: 0,
    },
    ...o,
  } as VportRecord;
}

function init(o?: Partial<VportRecord> | null): DocumentInit {
  const base = sampleInit();
  return { ...base, tables: { ...base.tables, ...(o !== null && { vports: [vport(o)] }) } };
}

/** A drawing, its bus, and the app's SNAPMODE and GRIDMODE as the view host keeps them. */
function setup(o?: Partial<VportRecord> | null) {
  const model = DocumentModel.create(init(o));
  const app: Record<string, number> = { SNAPMODE: 0, GRIDMODE: 0, SNAPTYPE: 0 };
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'sysvar' || !(r.name in app))
        return Promise.resolve({ ok: false, message: 'Not here.' });
      if (r.value !== undefined) app[r.name] = r.value;
      return Promise.resolve({ ok: true, value: app[r.name]! });
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const vp = () => model.tables.vports.get(VPORT)!;
  return { model, bus, log, vp, app };
}

const SETTINGS = {
  snapSpacing: { x: 0.5, y: 0.25 },
  gridSpacing: { x: 0, y: 2 },
  gridMajor: 4,
};

describe('Drafting Settings: Snap and Grid', () => {
  it('opens with the *Active VPORT’s snap and grid spacing', async () => {
    const { bus } = setup({ snapSpacing: { x: 2, y: 3 }, gridMajor: 8 });
    await bus.submit('DSETTINGS');
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      dialog: {
        type: 'dsettings',
        snapGrid: {
          snapSpacing: { x: 2, y: 3 },
          gridSpacing: { x: 10, y: 10 },
          gridMajor: 8,
        },
      },
    });
  });

  it('OK sets them in the VPORT, one DSETTINGS undo step that U takes back', async () => {
    const { bus, vp } = setup();
    await bus.submit('DSETTINGS');
    await bus.answer({ kind: 'dialog', action: 'ok', snapGrid: SETTINGS });
    expect(bus.command).toBeUndefined();
    expect(vp()).toMatchObject({
      snapSpacing: { x: 0.5, y: 0.25 },
      gridSpacing: { x: 0, y: 2 },
      gridMajor: 4,
    });
    expect(bus.undo.state.undoable).toBe(1);
    await bus.submit('U');
    expect(vp()).toMatchObject({ snapSpacing: { x: 10, y: 10 }, gridMajor: 5 });
  });

  it('leaves the drawing alone when nothing changed, the settings are refused, or Cancel', async () => {
    const { bus, model } = setup();
    const version = model.version;
    await bus.submit('DSETTINGS');
    const same = { ...SETTINGS, snapSpacing: { x: 10, y: 10 }, gridSpacing: { x: 10, y: 10 } };
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      snapGrid: { ...same, gridMajor: 5 },
    });
    for (const bad of [
      { ...SETTINGS, snapSpacing: { x: 0, y: 1 } },
      { ...SETTINGS, snapSpacing: { x: 1, y: Number.NaN } },
      { ...SETTINGS, gridSpacing: { x: -1, y: 1 } },
      { ...SETTINGS, gridMajor: 0 },
      { ...SETTINGS, gridMajor: 2.5 },
      { ...SETTINGS, gridMajor: 101 },
    ]) {
      await bus.submit('DSETTINGS');
      await bus.answer({ kind: 'dialog', action: 'ok', snapGrid: bad });
    }
    await bus.submit('DSETTINGS');
    await bus.cancel();
    expect(model.version).toBe(version);
    expect(bus.undo.state.undoable).toBe(0);
  });

  it('has no Snap and Grid settings in a drawing without an *Active VPORT', async () => {
    const { bus, model } = setup(null);
    await bus.submit('DSETTINGS');
    const p = bus.prompt;
    expect(p?.kind === 'dialog' && 'snapGrid' in p.dialog).toBe(false);
    const version = model.version;
    await bus.answer({ kind: 'dialog', action: 'ok', snapGrid: SETTINGS });
    expect(model.version).toBe(version);
  });
});

describe('SNAP', () => {
  it('sets the snap spacing and turns SNAP on; ON and OFF turn it', async () => {
    const { bus, vp, app, log } = setup({ snapSpacing: { x: 2.5, y: 4 } });
    await bus.submit('SN');
    expect(bus.promptText).toBe('Specify snap spacing or [ON/OFF/Aspect/Type] <2.5000>:');
    await bus.submit('0.5');
    expect(vp().snapSpacing).toEqual({ x: 0.5, y: 0.5 });
    expect(vp().snapOn).toBe(true);
    await bus.script(['SNAP', 'OFF']);
    expect(vp().snapOn).toBe(false);
    await bus.script(['SNAP', 'ON']);
    expect(vp().snapOn).toBe(true);
    // The VPORT keeps it, not the app (M6-02 part 19).
    expect(app['SNAPMODE']).toBe(0);
    // A spacing of 0 or less is refused and asked again.
    await bus.script(['SNAP', '0']);
    expect(log.at(-1)).toBe('Value must be positive and nonzero.');
    expect(bus.promptText).toContain('Specify snap spacing');
    await bus.cancel();
    expect(vp().snapSpacing).toEqual({ x: 0.5, y: 0.5 });
    // One SNAP undo step for the spacing, and one each for OFF and ON.
    expect(bus.undo.state.undoable).toBe(3);
  });

  it('sets the snap type, PolarSnap or grid snap (SNAPTYPE), with the current one the default', async () => {
    const { bus, app, vp } = setup();
    await bus.script(['SNAP', 'T']);
    expect(bus.promptText).toBe('Enter snap type [Polar/Grid] <Grid>:');
    await bus.submit('P');
    expect(app['SNAPTYPE']).toBe(1);
    expect(bus.command).toBeUndefined();
    await bus.script(['SNAP', 'T']);
    expect(bus.promptText).toBe('Enter snap type [Polar/Grid] <Polar>:');
    // Enter keeps it.
    await bus.submit('');
    expect(app['SNAPTYPE']).toBe(1);
    await bus.script(['SNAP', 'T', 'G']);
    expect(app['SNAPTYPE']).toBe(0);
    // The spacing is not touched, and the type is no undo step.
    expect(vp().snapSpacing).toEqual({ x: 10, y: 10 });
    expect(bus.undo.state.undoable).toBe(0);
  });

  it('says why when the app keeps no snap type', async () => {
    const { bus, app, log } = setup();
    delete app['SNAPTYPE'];
    await bus.script(['SNAP', 'T']);
    expect(bus.promptText).toBe('Enter snap type [Polar/Grid] <Grid>:');
    await bus.submit('P');
    expect(log.at(-1)).toBe('Not here.');
    await bus.script(['SNAP', 'T']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
  });

  it('takes different X and Y spacing after Aspect, without turning SNAP on', async () => {
    const { bus, vp, app, log } = setup();
    await bus.script(['SNAP', 'A']);
    expect(bus.promptText).toBe('Specify horizontal spacing <10.0000>:');
    await bus.submit('-1');
    expect(log.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.submit('3');
    expect(bus.promptText).toBe('Specify vertical spacing <10.0000>:');
    await bus.submit('');
    expect(vp().snapSpacing).toEqual({ x: 3, y: 10 });
    expect(vp().snapOn).toBe(false);
    expect(app['SNAPMODE']).toBe(0);
    await bus.script(['SNAP', 'A', '1']);
    await bus.cancel();
    expect(vp().snapSpacing).toEqual({ x: 3, y: 10 });
  });

  it('runs transparently, and keeps ON and OFF without an *Active VPORT', async () => {
    const { bus, vp } = setup();
    await bus.submit('LINE');
    await bus.submit("'SNAP");
    await bus.submit('5');
    expect(vp().snapSpacing).toEqual({ x: 5, y: 5 });
    expect(bus.command).toBe('LINE');
    await bus.cancel();
    const none = setup(null);
    await none.bus.script(['SNAP', '5']);
    expect(none.log.at(-1)).toBe('The drawing has no current viewport to keep the spacing in.');
    expect(none.app['SNAPMODE']).toBe(0);
    await none.bus.script(['SNAP', 'ON']);
    expect(none.app['SNAPMODE']).toBe(1);
  });

  it('says why the app refused a toggle', async () => {
    const model = DocumentModel.create(init(null));
    const log: string[] = [];
    const bus = new PromptBus({ model, registry: builtinCommands() });
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['SNAP', 'ON']);
    expect(bus.command).toBeUndefined();
    expect(log.length).toBeGreaterThan(1);
  });
});

describe('GRID', () => {
  it('sets the grid spacing and turns GRID on; ON and OFF turn it', async () => {
    const { bus, vp, app } = setup({ gridSpacing: { x: 0, y: 0 } });
    await bus.submit('GRID');
    expect(bus.promptText).toBe(
      'Specify grid spacing(X) or [ON/OFF/Snap/Major/aDaptive/Limits/Follow/Aspect] <0.0000>:',
    );
    await bus.submit('20');
    expect(vp().gridSpacing).toEqual({ x: 20, y: 20 });
    expect(vp().gridOn).toBe(true);
    await bus.script(['GRID', 'OFF']);
    expect(vp().gridOn).toBe(false);
    await bus.script(['GRID', 'ON']);
    expect(vp().gridOn).toBe(true);
    expect(app['GRIDMODE']).toBe(0);
  });

  it('takes 0 or Snap to follow the snap spacing, and 2x for twice it', async () => {
    const { bus, vp, log } = setup({ snapSpacing: { x: 2, y: 3 } });
    await bus.script(['GRID', '2x']);
    expect(vp().gridSpacing).toEqual({ x: 4, y: 6 });
    await bus.script(['GRID', 'S']);
    expect(vp().gridSpacing).toEqual({ x: 0, y: 0 });
    await bus.script(['GRID', '.5X']);
    expect(vp().gridSpacing).toEqual({ x: 1, y: 1.5 });
    await bus.script(['GRID', '0']);
    expect(vp().gridSpacing).toEqual({ x: 0, y: 0 });
    for (const bad of ['-2', '0x']) {
      await bus.script(['GRID', bad]);
      expect(log.at(-1)).toBe('Value must be positive and nonzero.');
      await bus.cancel();
    }
    await bus.script(['GRID', 'twice']);
    expect(log.at(-1)).toBe('Requires a distance, a number followed by x, or an option keyword.');
    await bus.cancel();
    expect(vp().gridSpacing).toEqual({ x: 0, y: 0 });
  });

  it('sets the lines per major line, 1 to 100', async () => {
    const { bus, vp, log } = setup();
    await bus.script(['GRID', 'M']);
    expect(bus.promptText).toBe('Specify the number of grid lines per major grid line <5>:');
    await bus.submit('10');
    expect(vp().gridMajor).toBe(10);
    await bus.script(['GRID', 'M', '101']);
    expect(log.at(-1)).toBe('Requires an integer between 1 and 100.');
    expect(vp().gridMajor).toBe(10);
    await bus.script(['GRID', 'M']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
  });

  it('takes X and Y spacing after Aspect, 0 allowed', async () => {
    const { bus, vp } = setup();
    await bus.script(['GRID', 'A']);
    expect(bus.promptText).toBe('Specify the horizontal spacing(X) <10.0000>:');
    await bus.submit('0');
    expect(bus.promptText).toBe('Specify the vertical spacing(Y) <10.0000>:');
    await bus.submit('7');
    expect(vp().gridSpacing).toEqual({ x: 0, y: 7 });
  });

  it('keeps ON and OFF without an *Active VPORT, and ends on Esc', async () => {
    const none = setup(null);
    await none.bus.script(['GRID', 'S']);
    expect(none.log.at(-1)).toBe('The drawing has no current viewport to keep the spacing in.');
    await none.bus.script(['GRID', 'M', '4']);
    expect(none.app['GRIDMODE']).toBe(0);
    await none.bus.script(['GRID', 'ON']);
    expect(none.app['GRIDMODE']).toBe(1);
    await none.bus.submit('GRID');
    await none.bus.cancel();
    expect(none.bus.command).toBeUndefined();
  });
});

// M3-06 part 6: Grid behavior (AutoCAD 2024 Help, "GRIDDISPLAY": 1 display beyond the limits, 2
// adaptive, 4 subdivide below the grid spacing, 8 follow the dynamic UCS), kept in the `*Active`
// VPORT (DXF 60) as AutoCAD keeps it in the current viewport, and GRID's aDaptive, Limits and
// Follow ("GRID (Command)").
describe('GRID behaviour (GRIDDISPLAY)', () => {
  it('aDaptive turns adaptive display on with or without subdivision, or off', async () => {
    const { bus, vp } = setup({ gridFlags: 1 });
    await bus.script(['GRID', 'D']);
    expect(bus.promptText).toBe('Turn adaptive behavior on [Yes/No] <No>:');
    await bus.submit('Y');
    expect(bus.promptText).toBe('Allow subdivision below grid spacing [Yes/No] <No>:');
    await bus.submit('Y');
    expect(vp().gridFlags).toBe(1 | 2 | 4);
    expect(bus.command).toBeUndefined();
    await bus.script(['GRID', 'D']);
    expect(bus.promptText).toBe('Turn adaptive behavior on [Yes/No] <Yes>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Allow subdivision below grid spacing [Yes/No] <Yes>:');
    await bus.submit('N');
    expect(vp().gridFlags).toBe(1 | 2);
    // No asks nothing more and keeps subdivision as it was, for when adaptive is on again.
    await bus.script(['GRID', 'D', 'N']);
    expect(bus.command).toBeUndefined();
    expect(vp().gridFlags).toBe(1);
    // Each change is one GRID undo step.
    expect(bus.undo.state.undoable).toBe(3);
    await bus.submit('U');
    expect(vp().gridFlags).toBe(1 | 2);
  });

  it('Limits and Follow set the grid beyond the limits and following the dynamic UCS', async () => {
    const { bus, vp } = setup({ gridFlags: 3 });
    await bus.script(['GRID', 'L']);
    expect(bus.promptText).toBe('Display grid beyond Limits [Yes/No] <Yes>:');
    await bus.submit('N');
    expect(vp().gridFlags).toBe(2);
    await bus.script(['GRID', 'L', 'Y']);
    expect(vp().gridFlags).toBe(3);
    await bus.script(['GRID', 'F']);
    expect(bus.promptText).toBe('Follow Dynamic UCS [Yes/No] <No>:');
    await bus.submit('Y');
    expect(vp().gridFlags).toBe(11);
    // A or AS is still Aspect, D the adaptive option.
    await bus.script(['GRID', 'A']);
    expect(bus.promptText).toBe('Specify the horizontal spacing(X) <10.0000>:');
    await bus.cancel();
    await bus.script(['GRID', 'L']);
    await bus.cancel();
    expect(vp().gridFlags).toBe(11);
  });

  it('says why without an *Active VPORT', async () => {
    const none = setup(null);
    await none.bus.script(['GRID', 'L']);
    expect(none.log.at(-1)).toBe('The drawing has no current viewport to keep the spacing in.');
    expect(none.bus.command).toBeUndefined();
  });

  it('the Snap and Grid tab opens with GRIDDISPLAY and OK sets it with the spacing', async () => {
    const { bus, vp } = setup({ gridFlags: 3 });
    await bus.submit('DSETTINGS');
    expect(bus.prompt).toMatchObject({ dialog: { snapGrid: { gridDisplay: 3 } } });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      snapGrid: { ...SETTINGS, gridDisplay: 6 },
    });
    expect(vp()).toMatchObject({ gridFlags: 6, gridMajor: 4 });
    expect(bus.undo.state.undoable).toBe(1);
    // Bits AutoCAD does not define are refused.
    for (const gridDisplay of [16, -1, 1.5]) {
      await bus.submit('DSETTINGS');
      await bus.answer({ kind: 'dialog', action: 'ok', snapGrid: { ...SETTINGS, gridDisplay } });
    }
    expect(vp().gridFlags).toBe(6);
    expect(bus.undo.state.undoable).toBe(1);
  });
});

// M3-06 part 6: SETVAR's SNAPUNIT, GRIDUNIT, GRIDMAJOR, GRIDDISPLAY and SNAPBASE are the
// `*Active` VPORT's, as the Snap and Grid tab's are (AutoCAD 2024 Help, each variable: "Saved in:
// Drawing", the current viewport's).
describe('SETVAR of the viewport’s snap and grid', () => {
  it('reads and sets SNAPUNIT, GRIDUNIT and SNAPBASE as points', async () => {
    const { bus, vp, log } = setup({ snapSpacing: { x: 2, y: 3 } });
    await bus.script(['SETVAR', 'SNAPUNIT']);
    expect(bus.promptText).toBe('Enter new value for SNAPUNIT <2.0000,3.0000>:');
    await bus.submit('0.5,0.25');
    expect(vp().snapSpacing).toEqual({ x: 0.5, y: 0.25 });
    await bus.script(['GRIDUNIT', '0,0']);
    expect(vp().gridSpacing).toEqual({ x: 0, y: 0 });
    await bus.script(['SNAPBASE', '1,2']);
    expect(vp().snapBase).toEqual({ x: 1, y: 2 });
    expect(bus.undo.state.undoable).toBe(3);
    // A snap spacing of 0 or a negative grid spacing is refused, the viewport unchanged.
    await bus.script(['SNAPUNIT', '0,1']);
    expect(log.at(-1)).toBe('Snap spacing must be more than 0.');
    await bus.script(['GRIDUNIT', '-1,1']);
    expect(log.at(-1)).toBe('Grid spacing must be 0 or more.');
    expect(vp().snapSpacing).toEqual({ x: 0.5, y: 0.25 });
    expect(bus.undo.state.undoable).toBe(3);
  });

  it('sets GRIDMAJOR 1 to 100 and GRIDDISPLAY 0 to 15', async () => {
    const { bus, vp, log } = setup({ gridFlags: 3 });
    await bus.script(['GRIDMAJOR']);
    expect(bus.promptText).toBe('Enter new value for GRIDMAJOR <5>:');
    await bus.submit('10');
    expect(vp().gridMajor).toBe(10);
    await bus.script(['GRIDMAJOR', '101']);
    expect(log.at(-1)).toBe('Value must be between 1 and 100.');
    await bus.cancel();
    await bus.script(['GRIDDISPLAY']);
    expect(bus.promptText).toBe('Enter new value for GRIDDISPLAY <3>:');
    await bus.submit('6');
    expect(vp().gridFlags).toBe(6);
    await bus.script(['GRIDDISPLAY', '16']);
    expect(log.at(-1)).toBe('Value must be between 0 and 15.');
    await bus.cancel();
    expect(vp()).toMatchObject({ gridMajor: 10, gridFlags: 6 });
    // The same value again is no change and no undo step.
    await bus.script(['GRIDMAJOR', '10']);
    expect(bus.undo.state.undoable).toBe(2);
  });

  it('lists them with SETVAR ?, and says why without an *Active VPORT', async () => {
    const { bus, log } = setup({ gridMajor: 4 });
    await bus.script(['SETVAR', '?', 'GRID*']);
    expect(log).toContain('GRIDMAJOR         4');
    expect(log).toContain('GRIDUNIT          10.0000,10.0000');
    const none = setup(null);
    await none.bus.script(['SNAPUNIT']);
    expect(none.log.at(-1)).toBe('The drawing has no current viewport to keep SNAPUNIT in.');
    expect(none.bus.command).toBeUndefined();
  });
});
