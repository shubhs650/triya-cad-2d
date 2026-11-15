// M3-06 part 2: the Drafting Settings dialog's Snap and Grid tab (AutoCAD 2024 Help, "Snap and
// Grid Tab (Drafting Settings Dialog Box)"), ISOPLANE and F5 ("ISOPLANE (Command)") and ELLIPSE
// Isocircle ("ELLIPSE (Command)"). SNAPUNIT, GRIDUNIT, GRIDMAJOR, SNAPSTYL and SNAPISOPAIR are
// the drawing's, kept in the model-space `*Active` VPORT as AutoCAD keeps them in the current
// viewport.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  dragMotion,
  type BusEvent,
  type CommandOutput,
  type DocumentInit,
  type Ellipse,
  type Entity,
  type HeaderValue,
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

function init(o?: Partial<VportRecord> | null, header: [string, HeaderValue][] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    tables: { ...base.tables, ...(o !== null && { vports: [vport(o)] }) },
  };
}

function setup(o?: Partial<VportRecord> | null, header: [string, HeaderValue][] = []) {
  const model = DocumentModel.create(init(o, header));
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const vp = () => model.tables.vports.get(VPORT)!;
  return { model, bus, log, added, vp };
}

const SETTINGS = {
  snapSpacing: { x: 0.5, y: 0.25 },
  gridSpacing: { x: 0, y: 2 },
  gridMajor: 4,
  isometric: true,
};

describe('Drafting Settings: Snap and Grid', () => {
  it('opens with the *Active VPORT’s spacing and snap type', async () => {
    const { bus } = setup({ snapSpacing: { x: 2, y: 3 }, gridMajor: 8, isometricSnap: true });
    await bus.submit('DSETTINGS');
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      dialog: {
        type: 'dsettings',
        snapGrid: {
          snapSpacing: { x: 2, y: 3 },
          gridSpacing: { x: 10, y: 10 },
          gridMajor: 8,
          isometric: true,
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
      isometricSnap: true,
    });
    expect(bus.undo.state.undoable).toBe(1);
    await bus.submit('U');
    expect(vp()).toMatchObject({ snapSpacing: { x: 10, y: 10 }, isometricSnap: false });
  });

  it('leaves the drawing alone when nothing changed, the settings are refused, or Cancel', async () => {
    const { bus, model } = setup();
    const version = model.version;
    await bus.submit('DSETTINGS');
    const same = { ...SETTINGS, snapSpacing: { x: 10, y: 10 }, gridSpacing: { x: 10, y: 10 } };
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      snapGrid: { ...same, gridMajor: 5, isometric: false },
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

describe('ISOPLANE', () => {
  it('steps to the next plane on Enter and takes one by name', async () => {
    const { bus, vp, log } = setup({ isometricPlane: 1 });
    await bus.submit('ISOPLANE');
    expect(log.at(-1)).toBe('Current isoplane:  Top');
    expect(bus.promptText).toBe('Enter isometric plane setting [Left/Top/Right] <Right>:');
    await bus.submit('');
    expect(vp().isometricPlane).toBe(2);
    expect(log.at(-1)).toBe('Current isoplane is: Right');
    await bus.submit('ISOPLANE');
    expect(bus.promptText).toContain('<Left>:');
    await bus.submit('T');
    expect(vp().isometricPlane).toBe(1);
    // Each is an undo step.
    expect(bus.undo.state.undoable).toBe(2);
  });

  it('runs transparently, and says so with no *Active VPORT to keep the plane', async () => {
    const { bus, vp } = setup();
    await bus.submit('LINE');
    await bus.submit("'ISOPLANE");
    await bus.submit('R');
    expect(vp().isometricPlane).toBe(2);
    expect(bus.command).toBe('LINE');
    await bus.cancel();
    await bus.cancel();
    const none = setup(null);
    await none.bus.submit('ISOPLANE');
    expect(none.log.at(-1)).toBe('The drawing has no current viewport to keep an isoplane in.');
    expect(none.bus.command).toBeUndefined();
  });

  it('is what F5 does through the session: the next plane, logged, not an undo step', async () => {
    const session = new EngineSession(init({ isometricPlane: 2 }));
    const lines: string[] = [];
    session.onCommand((o: CommandOutput) => {
      if (o.type === 'log') lines.push(o.line);
    });
    const r = session.edit({ kind: 'isoplane' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.change.tables?.vports?.updated?.[0]?.after.isometricPlane).toBe(0);
    expect(session.model.tables.vports.get(VPORT)!.isometricPlane).toBe(0);
    expect(lines).toEqual(['<Isoplane Left>']);
    expect(session.undoState.undoable).toBe(0);
    const none = new EngineSession(init(null));
    expect(none.edit({ kind: 'isoplane' })).toEqual({
      ok: false,
      message: 'The drawing has no current viewport.',
    });
  });
});

describe('ELLIPSE Isocircle', () => {
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  const geom = (e: Entity) => {
    const g = e.geom as Ellipse;
    return [r6(g.center.x), r6(g.center.y), r6(g.majorAxis.x), r6(g.majorAxis.y), r6(g.ratio)];
  };
  const A = r6(5 * Math.sqrt(1.5));
  const RATIO = r6(Math.sqrt(1 / 3));

  it('is offered only with isometric snap on', async () => {
    const off = setup();
    await off.bus.submit('ELLIPSE');
    expect(off.bus.promptText).toBe('Specify axis endpoint of ellipse or [Arc/Center]:');
    const on = setup({ isometricSnap: true });
    await on.bus.submit('ELLIPSE');
    expect(on.bus.promptText).toBe('Specify axis endpoint of ellipse or [Arc/Center/Isocircle]:');
  });

  it('draws the circle of the current isoplane from its centre and radius', async () => {
    const { bus, added } = setup({ isometricSnap: true, isometricPlane: 1 });
    await bus.submit('ELLIPSE');
    await bus.submit('I');
    expect(bus.promptText).toBe('Specify center of isocircle:');
    await bus.submit('1,2');
    expect(bus.promptText).toBe('Specify radius of isocircle or [Diameter]:');
    // Dragged: the cursor's distance is the radius.
    const drag = bus.prompt!.drag!;
    expect(geom({ geom: dragMotion(drag, { x: 1, y: 7 })!.adding!.geom } as Entity)).toEqual([
      1,
      2,
      A,
      0,
      RATIO,
    ]);
    await bus.submit('5');
    expect(added().map(geom)).toEqual([[1, 2, A, 0, RATIO]]);
  });

  it('takes a diameter, on the Left and Right planes', async () => {
    const left = setup({ isometricSnap: true, isometricPlane: 0 });
    await left.bus.script(['ELLIPSE', 'I', '0,0', 'D', '10']);
    const [lx, ly] = geom(left.added()[0]!).slice(2);
    expect(Math.round((Math.atan2(ly!, lx!) * 180) / Math.PI + 360) % 180).toBe(120);
    expect(r6(Math.hypot(lx!, ly!))).toBe(A);
    const right = setup({ isometricSnap: true, isometricPlane: 2 });
    await right.bus.script(['ELLIPSE', 'I', '0,0', '5']);
    const [rx, ry] = geom(right.added()[0]!).slice(2);
    expect(Math.round((Math.atan2(ry!, rx!) * 180) / Math.PI + 360) % 180).toBe(60);
  });

  it('refuses a zero radius and asks again', async () => {
    const { bus, log, added } = setup({ isometricSnap: true });
    await bus.script(['ELLIPSE', 'I', '0,0', '0']);
    expect(log.at(-1)).toBe('*Invalid*');
    expect(bus.promptText).toBe('Specify radius of isocircle or [Diameter]:');
    await bus.submit('2');
    expect(added()).toHaveLength(1);
  });

  it('starts an elliptical arc too, and a polyline with PELLIPSE 1', async () => {
    const arc = setup({ isometricSnap: true, isometricPlane: 1 });
    await arc.bus.submit('ELLIPSE');
    await arc.bus.submit('A');
    expect(arc.bus.promptText).toBe(
      'Specify axis endpoint of elliptical arc or [Center/Isocircle]:',
    );
    await arc.bus.script(['I', '0,0', '5', '0', '90']);
    const g = arc.added()[0]!.geom as Ellipse;
    expect(g.kind).toBe('ELLIPSE');
    expect(r6(g.endParam - g.startParam)).toBe(r6(Math.PI / 2));
    const pl = setup({ isometricSnap: true }, [['$PELLIPSE', 1]]);
    await pl.bus.submit('ELLIPSE');
    expect(pl.bus.promptText).toBe('Specify axis endpoint of ellipse or [Center/Isocircle]:');
    await pl.bus.script(['I', '0,0', '5']);
    expect(pl.added()[0]!.geom.kind).toBe('LWPOLYLINE');
  });

  it('ends on Esc at the centre or the radius', async () => {
    const { bus, added } = setup({ isometricSnap: true });
    await bus.script(['ELLIPSE', 'I']);
    await bus.cancel();
    await bus.script(['ELLIPSE', 'I', '0,0']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(0);
  });
});
