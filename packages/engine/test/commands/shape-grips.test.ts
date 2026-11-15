// M3-05 part 3: grips on ellipses, hatches and layout viewports at the grip prompt. A patterned
// hatch's control grip has AutoCAD's functions Stretch, Origin Point, Hatch Angle and Hatch
// Scale ("To Modify Hatch Objects Using Grips"), offered in its hover menu, cycled with Ctrl
// and typed by name; an ellipse's axis end and a viewport's corner stretch.
//
// The drawing: model space holds 40 an ANSI31-like hatch over the rectangle (0,0)–(10,6) and
// 41 an ellipse about (50,0) with axes 10 and 5; paper space holds 42 a viewport 40 × 20 about
// (100,50) at scale 2.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  GRIP_CYCLE,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type EllipseGeometry,
  type HatchGeometry,
  type ViewportGeometry,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, entityInit, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

function drawing(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    entities: [
      ...(base.entities ?? []).filter((e) => e.owner !== MODEL_SPACE && e.owner !== PAPER_SPACE),
      entityInit('40', {
        kind: 'HATCH',
        pattern: 'ANSI31',
        solid: false,
        associative: false,
        style: 0,
        patternType: 1,
        patternAngle: 0,
        patternScale: 1,
        double: false,
        loops: [
          {
            flags: 3,
            polyline: {
              closed: true,
              vertices: [
                { x: 0, y: 0, bulge: 0 },
                { x: 10, y: 0, bulge: 0 },
                { x: 10, y: 6, bulge: 0 },
                { x: 0, y: 6, bulge: 0 },
              ],
            },
          },
        ],
        patternLines: [
          { angle: Math.PI / 4, base: { x: 0, y: 0 }, offset: { x: -1, y: 1 }, dashes: [] },
        ],
        seedPoints: [],
      }),
      entityInit('41', {
        kind: 'ELLIPSE',
        center: { x: 50, y: 0 },
        majorAxis: { x: 10, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      }),
      entityInit(
        '42',
        {
          kind: 'VIEWPORT',
          center: { x: 100, y: 50 },
          width: 40,
          height: 20,
          id: 2,
          status: 1,
          flags: 0,
          viewCenter: { x: 10, y: 10 },
          viewHeight: 10,
          viewDirection: { x: 0, y: 0, z: 1 },
          viewTarget: { x: 0, y: 0, z: 0 },
          twist: 0,
          lensLength: 50,
          frontClip: 0,
          backClip: 0,
          frozenLayers: [],
          plotStyleSheet: '',
          renderMode: 0,
        },
        { owner: PAPER_SPACE },
      ),
    ],
  };
}

function setup(space = MODEL_SPACE) {
  const model = DocumentModel.create(drawing());
  const bus = new PromptBus({ model, registry: builtinCommands(), space: () => space });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const geom = <T>(h: string) => model.entityByHandle(h)!.geom as T;
  const hatch = () => geom<HatchGeometry>('40');
  const hot = async (x: number, y: number) => {
    await bus.selectAll();
    await bus.pick({ x, y }, { grip: 0.25 });
    expect(bus.command).toBe('GRIP');
  };
  const ctrl = () => bus.answer({ kind: 'keyword', keyword: GRIP_CYCLE });
  return { model, bus, log, geom, hatch, hot, ctrl };
}

describe('hatch grip functions', () => {
  it('the hover menu lists them; Ctrl cycles Origin Point, Hatch Angle, Hatch Scale', async () => {
    const s = setup();
    await s.bus.selectAll();
    expect(s.bus.gripMenu({ x: 5, y: 3 }, 0.25)?.items).toEqual([
      'Stretch',
      'Origin Point',
      'Hatch Angle',
      'Hatch Scale',
    ]);
    await s.hot(5, 3);
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
    expect(s.bus.prompt).toMatchObject({ ctrlCycles: true });
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** ORIGIN POINT **');
    expect(s.bus.promptText).toBe('Specify origin point or [eXit]:');
    expect(s.bus.prompt).toMatchObject({
      drag: { kind: 'grip', grip: { x: 5, y: 3 }, fn: 'Origin Point' },
    });
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** HATCH ANGLE **');
    expect(s.bus.promptText).toBe('Specify hatch angle or [eXit]:');
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** HATCH SCALE **');
    expect(s.bus.promptText).toBe('Specify hatch scale or [eXit]:');
    await s.ctrl();
    expect(s.log.at(-1)).toBe('** STRETCH **');
  });

  it('Origin Point moves the pattern to the point, in one undo step, the selection kept', async () => {
    const s = setup();
    await s.hot(5, 3);
    await s.ctrl();
    await s.bus.submit('2,3');
    expect(s.hatch().patternLines[0]!.base).toEqual({ x: 2, y: 3 });
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.selection).toHaveLength(2);
    await s.bus.script(['U']);
    expect(s.hatch().patternLines[0]!.base).toEqual({ x: 0, y: 0 });
  });

  it('Hatch Angle and Hatch Scale: typed by name, then a typed value or a picked point', async () => {
    const s = setup();
    await s.hot(5, 3);
    await s.bus.submit('AN');
    expect(s.log.at(-1)).toBe('** HATCH ANGLE **');
    await s.bus.submit('90');
    expect(r6(s.hatch().patternAngle)).toBe(r6(Math.PI / 2));
    expect(r6(s.hatch().patternLines[0]!.angle)).toBe(r6((3 * Math.PI) / 4));

    await s.hot(5, 3);
    await s.bus.submit('HA');
    expect(s.log.at(-1)).toBe('** HATCH SCALE **');
    await s.bus.submit('0');
    expect(s.bus.command).toBe('GRIP');
    await s.bus.submit('2');
    expect(s.hatch().patternScale).toBe(2);
    expect(s.hatch().patternLines[0]!.offset).toMatchObject({ x: -2 });

    // Picked: the angle is the grip's direction to the point, the scale its distance.
    await s.hot(5, 3);
    await s.bus.submit('AN');
    await s.bus.submit('15,3');
    expect(r6(s.hatch().patternAngle)).toBe(0);
    await s.hot(5, 3);
    await s.bus.submit('HA');
    await s.bus.submit('5,8');
    expect(s.hatch().patternScale).toBe(5);
  });

  it('Stretch moves the hatch; Enter at a function goes on to MOVE', async () => {
    const s = setup();
    await s.hot(5, 3);
    await s.bus.submit('7,3');
    expect(s.hatch().loops[0]!.polyline!.vertices[0]).toMatchObject({ x: 2, y: 0 });
    await s.hot(7, 3);
    await s.bus.submit('OR');
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Specify move point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('X');
  });
});

describe('ellipse and viewport grips', () => {
  it('an ellipse’s axis end stretches that axis', async () => {
    const s = setup();
    await s.hot(50, 5);
    expect(s.bus.prompt?.ctrlCycles).toBeUndefined();
    await s.bus.submit('50,8');
    expect(r6(s.geom<EllipseGeometry>('41').ratio)).toBe(0.8);
  });

  it('a viewport’s corner resizes it in the layout', async () => {
    const s = setup(PAPER_SPACE);
    await s.hot(120, 60);
    await s.bus.submit('130,70');
    expect(s.geom<ViewportGeometry>('42')).toMatchObject({
      center: { x: 105, y: 55 },
      width: 50,
      height: 30,
      viewHeight: 15,
    });
  });
});
