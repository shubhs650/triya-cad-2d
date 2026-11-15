// M3-02 part 5: CHPROP and CHANGE on the PromptBus, with AutoCAD 2024's prompts (AutoCAD Help,
// "CHPROP (Command)", "CHANGE (Command)").
import { describe, expect, it } from 'vitest';
import { colorFromText, lineweightFromText, type EntityGeometry } from '../../src/index';
import { LAYER_0, LAYER_WALLS } from '../model/fixtures';
import { r6, setup } from './edit-harness';

const text = (value: string, x = 20, y = 20): EntityGeometry => ({
  kind: 'TEXT',
  value,
  style: '16',
  position: { x, y },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});
const PROPS =
  'Enter property to change [Color/LAyer/LType/ltScale/LWeight/Thickness/TRansparency/Material/PLotstyle]:';

describe('CHPROP', () => {
  it('changes colour, layer, linetype, scale, lineweight, thickness and transparency in turn', async () => {
    const { bus, byHandle, log } = setup();
    await bus.script(['CHPROP']);
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['']);
    expect(bus.promptText).toBe(PROPS);
    await bus.script(['C']);
    expect(bus.promptText).toBe('New color [Truecolor] <BYLAYER>:');
    await bus.script(['red']);
    expect(byHandle('30')!.color).toEqual({ kind: 'aci', index: 1 });
    await bus.script(['C', 'T']);
    expect(bus.promptText).toBe('Red, Green, Blue:');
    await bus.script(['10,20,30']);
    expect(byHandle('30')!.color).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    await bus.script(['LA']);
    expect(bus.promptText).toBe('Enter new layer name <0>:');
    await bus.script(['walls']);
    expect(byHandle('30')!.layer).toBe(LAYER_WALLS);
    await bus.script(['LA', 'NOPE']);
    expect(log).toContain('Cannot find layer "NOPE".');
    await bus.script(['LT']);
    expect(bus.promptText).toBe('Enter new linetype name <ByLayer>:');
    await bus.script(['dashed']);
    expect(byHandle('30')!.linetype).toBe('15');
    await bus.script(['S']);
    expect(bus.promptText).toBe('Specify new linetype scale <1.0000>:');
    await bus.script(['2']);
    expect(byHandle('30')!.ltScale).toBe(2);
    await bus.script(['LW']);
    expect(bus.promptText).toBe('Enter new lineweight <ByLayer>:');
    await bus.script(['0.3']);
    expect(byHandle('30')!.lineweight).toBe(30);
    await bus.script(['T', '4']);
    expect((byHandle('30')!.geom as { thickness?: number }).thickness).toBe(4);
    await bus.script(['TR']);
    expect(bus.promptText).toBe('Enter transparency value [ByLayer/ByBlock] <ByLayer>:');
    await bus.script(['50']);
    expect(byHandle('30')!.transparency).toEqual({ alpha: 128 });
    await bus.script(['TR', '95']);
    expect(log).toContain('Value must be ByLayer, ByBlock or between 0 and 90.');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('reads colours and lineweights as AutoCAD types them', () => {
    expect(colorFromText('BYLAYER')).toBe('ByLayer');
    expect(colorFromText('byblock')).toBe('ByBlock');
    expect(colorFromText('Cyan')).toBe('aci:4');
    expect(colorFromText('254')).toBe('aci:254');
    expect(colorFromText('300')).toBeUndefined();
    expect(lineweightFromText('0.25')).toBe(25);
    expect(lineweightFromText('0.26')).toBeUndefined();
    expect(lineweightFromText('default')).toBe('Default');
  });

  it('shows no default when the objects differ, and leaves locked layers alone', async () => {
    const s = setup([[{ kind: 'CIRCLE', center: { x: 0, y: 20 }, radius: 2 }, { layer: LAYER_0 }]]);
    s.model.apply({
      tables: {
        layers: {
          updated: [
            {
              before: s.model.tables.layers.get(LAYER_WALLS)!,
              after: { ...s.model.tables.layers.get(LAYER_WALLS)!, locked: true },
            },
          ],
        },
      },
    } as never);
    // Line 30 and the circle on layer 0 differ in nothing but geometry.
    await s.bus.script(['CHPROP', 'ALL', '', 'LA']);
    expect(s.bus.promptText).toBe('Enter new layer name <0>:');
    await s.bus.script(['WALLS', '']);
    expect(s.byHandle('40')!.layer).toBe(LAYER_WALLS);
  });
});

describe('CHANGE', () => {
  it('moves the nearer end of each line to the change point', async () => {
    const { bus, byHandle, ends } = setup([
      { kind: 'LINE', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
    ]);
    await bus.script(['-CH', 'C', '-1,-1', '11,6', '']);
    expect(bus.promptText).toBe('Specify change point or [Properties]:');
    await bus.script(['12,3']);
    expect(ends(byHandle('30')!)).toEqual([0, 0, 12, 3]);
    expect(ends(byHandle('40')!)).toEqual([0, 5, 12, 3]);
  });

  it('passes a circle through the point, or asks its radius', async () => {
    const { bus, byHandle } = setup();
    await bus.script(['CHANGE']);
    await bus.pick({ x: 55, y: 0 });
    await bus.script(['', '50,8']);
    expect(r6((byHandle('31')!.geom as { radius: number }).radius)).toBe(8);
    await bus.script(['CHANGE']);
    await bus.pick({ x: 58, y: 0 });
    await bus.script(['', '']);
    expect(bus.promptText).toBe('Specify new circle radius <no change>:');
    await bus.script(['3']);
    expect((byHandle('31')!.geom as { radius: number }).radius).toBe(3);
  });

  it('moves a text and asks its style, height, rotation and text', async () => {
    const { bus, byHandle } = setup([text('OLD')]);
    await bus.script(['CHANGE', 'C', '19,19', '30,23', '', '40,40']);
    expect(bus.promptText).toBe('Enter new text style <Standard>:');
    await bus.script(['']);
    expect(bus.promptText).toBe('Specify new height <2.5000>:');
    await bus.script(['5']);
    expect(bus.promptText).toBe('Specify new rotation angle <0>:');
    await bus.script(['90']);
    expect(bus.promptText).toBe('Enter new text <OLD>:');
    await bus.script(['NEW TEXT']);
    const g = byHandle('40')!.geom as Extract<EntityGeometry, { kind: 'TEXT' }>;
    expect([r6(g.position.x), r6(g.position.y)]).toEqual([40, 40]);
    expect(g.height).toBe(5);
    expect(r6(g.rotation)).toBe(r6(Math.PI / 2));
    expect(g.value).toBe('NEW TEXT');
    // A fixed-height style gives the text its height and is not asked one.
    await bus.script(['CHANGE', 'C', '35,35', '45,45', '', '', '', 'NOTES', '', '']);
    expect((byHandle('40')!.geom as { height: number }).height).toBe(3.5);
    expect(bus.command).toBeUndefined();
  });

  it('moves and turns a block reference', async () => {
    const { bus, byHandle } = setup([
      {
        kind: 'INSERT',
        block: '50',
        position: { x: 20, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      } as unknown as EntityGeometry,
    ]);
    await bus.script(['CHANGE', 'C', '19,-1', '22,1', '', '']);
    expect(bus.promptText).toBe('Specify new block insertion point:');
    await bus.script(['30,5']);
    expect(bus.promptText).toBe('Specify new block rotation angle <0>:');
    await bus.script(['45']);
    const g = byHandle('40')!.geom as { position: { x: number; y: number }; rotation: number };
    expect([g.position.x, g.position.y]).toEqual([30, 5]);
    expect(r6(g.rotation)).toBe(r6(Math.PI / 4));
  });

  it('changes properties and elevation with Properties', async () => {
    const { bus, byHandle } = setup();
    await bus.script(['CHANGE']);
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['', 'P']);
    expect(bus.promptText).toBe(
      'Enter property to change [Color/Elev/LAyer/LType/ltScale/LWeight/Thickness/TRansparency/Material/PLotstyle]:',
    );
    await bus.script(['E', '7', 'C', '3', '']);
    expect((byHandle('30')!.geom as { elevation?: number }).elevation).toBe(7);
    expect(byHandle('30')!.color).toEqual({ kind: 'aci', index: 3 });
  });
});
