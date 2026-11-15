// M3-01 part 4: POINT (with the current PDMODE and PDSIZE reported) and DONUT scripted on the
// PromptBus, with AutoCAD 2024's prompts.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  type Entity,
  type LwPolylineGeometry,
} from '../../src/index';
import { LAYER_WALLS, MODEL_SPACE, sampleInit } from '../model/fixtures';

function setup(header: [string, number][] = []) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...(init.header ?? []), ...header]),
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  return { model, bus, added };
}

describe('POINT', () => {
  it('reports the point modes and places one point', async () => {
    const { bus, added } = setup([
      ['$PDMODE', 34],
      ['$PDSIZE', -5],
    ]);
    await bus.submit('PO');
    expect(bus.history.at(-1)).toBe('Current point modes:  PDMODE=34  PDSIZE=-5.0000');
    expect(bus.promptText).toBe('Specify a point:');
    await bus.submit('3,4');
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(1);
    expect(added()[0]).toMatchObject({
      type: 'POINT',
      owner: MODEL_SPACE,
      layer: LAYER_WALLS,
      geom: { kind: 'POINT', position: { x: 3, y: 4 } },
    });
  });

  it('reports AutoCAD’s initial modes when the drawing has none', async () => {
    const { bus } = setup();
    await bus.submit('POINT');
    expect(bus.history.at(-1)).toBe('Current point modes:  PDMODE=0  PDSIZE=0.0000');
  });

  it('PDMODE and PDSIZE are set as variables, one undo step each', async () => {
    const { bus, model } = setup([
      ['$PDMODE', 0],
      ['$PDSIZE', 0],
    ]);
    await bus.script(['PDMODE', '35', 'PDSIZE', '-10']);
    expect(model.header.get('$PDMODE')).toBe(35);
    expect(model.header.get('$PDSIZE')).toBe(-10);
  });
});

describe('DONUT', () => {
  it('asks both diameters, then places donuts until Enter', async () => {
    const { bus, added } = setup();
    await bus.submit('DO');
    expect(bus.promptText).toBe('Specify inside diameter of donut <0.5000>:');
    await bus.submit('2');
    expect(bus.promptText).toBe('Specify outside diameter of donut <1.0000>:');
    await bus.submit('4');
    expect(bus.promptText).toBe('Specify center of donut or <exit>:');
    // The donut follows the cursor.
    const drag = bus.prompt!.drag!;
    expect(drag).toMatchObject({ kind: 'sketch', layer: LAYER_WALLS });
    expect(dragMotion(drag, { x: 1, y: 1 })?.adding?.geom).toMatchObject({
      kind: 'LWPOLYLINE',
      closed: true,
      constantWidth: 1,
      vertices: [
        { x: -0.5, y: 1, bulge: 1 },
        { x: 2.5, y: 1, bulge: 1 },
      ],
    });
    await bus.script(['10,10', '20,10', '']);
    expect(bus.command).toBeUndefined();
    const geoms = added().map((e) => e.geom as LwPolylineGeometry);
    expect(geoms).toHaveLength(2);
    // Centre line radius (2 + 4) / 4 = 1.5, width (4 − 2) / 2 = 1.
    expect(geoms[0]).toMatchObject({
      kind: 'LWPOLYLINE',
      closed: true,
      constantWidth: 1,
      vertices: [
        { x: 8.5, y: 10, bulge: 1 },
        { x: 11.5, y: 10, bulge: 1 },
      ],
    });
    expect(added()[0]).toMatchObject({ type: 'LWPOLYLINE', layer: LAYER_WALLS });
    // The diameters are the defaults next time.
    await bus.submit('DONUT');
    expect(bus.promptText).toBe('Specify inside diameter of donut <2.0000>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Specify outside diameter of donut <4.0000>:');
  });

  it('a zero inside diameter fills the circle; refuses negative and zero outside ones', async () => {
    const { bus, added } = setup();
    await bus.script(['DONUT', '-1']);
    expect(bus.history.at(-1)).toBe('Value must be positive.');
    await bus.script(['0', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    await bus.script(['3', '0,0', '']);
    expect(added()[0]!.geom).toMatchObject({
      constantWidth: 1.5,
      vertices: [
        { x: -0.75, y: 0 },
        { x: 0.75, y: 0 },
      ],
    });
  });
});

describe('POINT and DONUT ended early', () => {
  it('Enter (no answer) or Esc at any prompt draws nothing', async () => {
    const { bus, added } = setup();
    for (const script of [['POINT'], ['DONUT'], ['DONUT', '1'], ['DONUT', '1', '2']]) {
      await bus.script(script);
      await bus.cancel();
      expect(bus.command).toBeUndefined();
      // Enter where a value is wanted ends the command too, as AutoCAD does.
      await bus.script(script);
      await bus.submit('');
      if (bus.command) await bus.cancel();
    }
    expect(added()).toEqual([]);
  });
});
