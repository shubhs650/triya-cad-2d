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
const lineAt = (y: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: 0, y },
  end: { x: 10, y },
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

describe('CHPROP defaults and refusals', () => {
  it('shows each colour the objects share and refuses what is not a colour', async () => {
    const { bus, byHandle, log } = setup([
      [lineAt(30), { color: { kind: 'byBlock' } }],
      [lineAt(32), { color: { kind: 'aci', index: 9 } }],
      [lineAt(34), { color: { kind: 'rgb', r: 1, g: 2, b: 3 } }],
    ]);
    for (const [y, label] of [
      [30, 'BYBLOCK'],
      [32, '9'],
      [34, '1,2,3'],
    ] as const) {
      await bus.script(['CHPROP']);
      await bus.pick({ x: 5, y });
      await bus.script(['', 'C']);
      expect(bus.promptText).toBe(`New color [Truecolor] <${label}>:`);
      await bus.script(['', '']);
    }
    await bus.script(['CHPROP']);
    await bus.pick({ x: 5, y: 30 });
    await bus.script(['', 'C', 'pink', 'C', 'T', '300,0,0', 'C', 'T', '', 'C', '256']);
    expect(log.filter((l) => l === 'Invalid color.')).toHaveLength(2);
    expect(byHandle('40')!.color).toEqual({ kind: 'byLayer' });
    await bus.script(['C', '0']);
    expect(byHandle('40')!.color).toEqual({ kind: 'byBlock' });
    await bus.script(['']);
    expect(colorFromText('x9')).toBeUndefined();
  });

  it('shows no defaults for objects that differ, and refuses unknown names and values', async () => {
    const { bus, log } = setup([
      [lineAt(30), { linetype: '15', lineweight: 'Default', transparency: { alpha: 0 } }],
      [lineAt(32), { linetype: 'ByBlock', lineweight: 50, ltScale: 2 }],
    ]);
    await bus.script(['CHPROP', 'C', '-1,29', '11,33', '']);
    await bus.script(['LA']);
    expect(bus.promptText).toBe('Enter new layer name <WALLS>:');
    await bus.script(['', 'LT']);
    expect(bus.promptText).toBe('Enter new linetype name:');
    await bus.script(['NOPE']);
    expect(log).toContain('Linetype NOPE not found.  Use the LINETYPE command to load it.');
    await bus.script(['S']);
    expect(bus.promptText).toBe('Specify new linetype scale:');
    await bus.script(['0']);
    expect(log).toContain('Value must be positive and nonzero.');
    await bus.script(['LW']);
    expect(bus.promptText).toBe('Enter new lineweight:');
    await bus.script(['0.33']);
    expect(log).toContain('Invalid lineweight.');
    await bus.script(['TR']);
    expect(bus.promptText).toBe('Enter transparency value [ByLayer/ByBlock]:');
    await bus.script(['', '']);
    // Each alone shows its own.
    for (const [y, lt, lwt] of [
      [30, 'DASHED', 'Default'],
      [32, 'ByBlock', '0.50'],
    ] as const) {
      await bus.script(['CHPROP']);
      await bus.pick({ x: 5, y });
      await bus.script(['', 'LT']);
      expect(bus.promptText).toBe(`Enter new linetype name <${lt}>:`);
      await bus.script(['', 'LW']);
      expect(bus.promptText).toBe(`Enter new lineweight <${lwt}>:`);
      await bus.script(['', '']);
    }
  });

  it('sets ByLayer and ByBlock linetypes, lineweights and transparency', async () => {
    const { bus, byHandle } = setup([lineAt(30)]);
    await bus.script(['CHPROP']);
    await bus.pick({ x: 5, y: 30 });
    await bus.script(['', 'LT', 'byblock']);
    expect(byHandle('40')!.linetype).toBe('ByBlock');
    await bus.script(['LT', 'BYLAYER']);
    expect(byHandle('40')!.linetype).toBe('ByLayer');
    await bus.script(['LW', 'byblock']);
    expect(byHandle('40')!.lineweight).toBe('ByBlock');
    await bus.script(['LW', 'ByLayer', 'TR', 'ByBlock']);
    expect(byHandle('40')!.lineweight).toBe('ByLayer');
    expect(byHandle('40')!.transparency).toBe('ByBlock');
    await bus.script(['S', '', 'T', '', 'LW', '', 'LT', '', 'LA', '', 'C', '', '']);
    expect(bus.command).toBeUndefined();
    expect(lineweightFromText('abc')).toBeUndefined();
    expect(lineweightFromText(' ')).toBeUndefined();
  });

  it('sets materials and, in a named plot style drawing, plot styles', async () => {
    const a = setup([lineAt(30)]);
    await a.bus.script(['CHPROP']);
    await a.bus.pick({ x: 5, y: 30 });
    await a.bus.script(['', 'M']);
    expect(a.bus.promptText).toBe('Enter new material name <ByLayer>:');
    await a.bus.script(['global']);
    expect(a.byHandle('40')!.material).toBe('70');
    await a.bus.script(['M', 'NOPE', 'M', 'bylayer', 'M', '', 'PL', '']);
    expect(a.log).toContain('Material "NOPE" not found.');
    expect(a.byHandle('40')!.material).toBeUndefined();
    expect(a.log).toContain(
      'Plot styles are by colour in this drawing (color-dependent plot styles).',
    );
    const b = setup([lineAt(30)], { namedPlotStyles: true });
    await b.bus.script(['CHPROP']);
    await b.bus.pick({ x: 5, y: 30 });
    await b.bus.script(['', 'PL']);
    expect(b.bus.promptText).toBe('Enter Plot Style <ByLayer>:');
    await b.bus.script(['heavy']);
    expect(b.byHandle('40')!.plotStyle).toBe('81');
    await b.bus.script(['PL', 'NOPE', 'PL', 'ByLayer', 'PL', '', '']);
    expect(b.log).toContain('Plot style "NOPE" not found.');
    expect(b.byHandle('40')!.plotStyle).toBeUndefined();
  });

  it('changes elevation of what has one, skipping locked layers and 3D polylines', async () => {
    const s = setup([
      [lineAt(30), { layer: LAYER_0 }],
      {
        kind: 'POLYLINE',
        is3d: true,
        closed: false,
        vertices: [
          { x: 0, y: 32, bulge: 0 },
          { x: 10, y: 32, bulge: 0 },
        ],
      } as EntityGeometry,
      { kind: 'XLINE', base: { x: 0, y: 34 }, direction: { x: 1, y: 0 } } as EntityGeometry,
      lineAt(36),
    ]);
    await s.bus.script(['CHANGE', 'ALL', '', 'P', 'E']);
    expect(s.bus.promptText).toBe('Specify new elevation <0.0000>:');
    await s.bus.script(['3']);
    expect((s.byHandle('40')!.geom as { elevation?: number }).elevation).toBe(3);
    expect((s.byHandle('41')!.geom as { elevation?: number }).elevation).toBeUndefined();
    await s.bus.script(['E']);
    expect(s.bus.promptText).toBe('Specify new elevation:');
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
    await s.bus.script(['0', 'E', '']);
    expect((s.byHandle('40')!.geom as { elevation?: number }).elevation).toBeUndefined();
    expect((s.byHandle('43')!.geom as { elevation?: number }).elevation).toBe(3);
    await s.bus.script(['']);
  });
});

describe('CHANGE without a change point', () => {
  it('leaves lines, asks circles and block references, and skips other objects', async () => {
    const { bus, byHandle } = setup([
      {
        kind: 'INSERT',
        block: '50',
        position: { x: 20, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [],
      } as unknown as EntityGeometry,
      { kind: 'ARC', center: { x: 80, y: 0 }, radius: 2, startAngle: 0, endAngle: 1 },
    ]);
    await bus.script(['CHANGE', 'ALL', '', '']);
    expect(bus.promptText).toBe('Specify new circle radius <no change>:');
    await bus.script(['0']);
    expect(bus.promptText).toBe('Specify new block insertion point:');
    await bus.script(['']);
    expect(bus.promptText).toBe('Specify new block rotation angle <0>:');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
    expect((byHandle('31')!.geom as { radius: number }).radius).toBe(5);
    expect((byHandle('40')!.geom as { position: { x: number } }).position.x).toBe(20);
    // The start is nearer this change point; Enter leaves the circle's radius.
    await bus.script(['CHANGE']);
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['', '-2,1', 'CHANGE']);
    expect(byHandle('30')!.geom).toMatchObject({ start: { x: -2, y: 1 }, end: { x: 10, y: 0 } });
    await bus.pick({ x: 55, y: 0 });
    await bus.script(['', '', '']);
    expect((byHandle('31')!.geom as { radius: number }).radius).toBe(5);
    // A change point moves a block reference there, then asks its rotation.
    await bus.script(['CHANGE', 'C', '19,-1', '22,1', '', '25,5']);
    expect(bus.promptText).toBe('Specify new block rotation angle <0>:');
    await bus.script(['']);
    expect((byHandle('40')!.geom as { position: { x: number } }).position.x).toBe(25);
  });

  it('asks a text’s insertion point, refuses unknown styles and keeps what is entered', async () => {
    const aligned = { ...(text('KEEP') as object), halign: 1, alignmentPoint: { x: 25, y: 20 } };
    const { bus, byHandle, log } = setup([aligned as EntityGeometry]);
    await bus.script(['CHANGE', 'C', '19,19', '30,23', '', '']);
    expect(bus.promptText).toBe('Specify new text insertion point <no change>:');
    await bus.script(['35,20', 'NOPE']);
    expect(log).toContain('Cannot find text style "NOPE".');
    await bus.script(['', '', '']);
    const g = byHandle('40')!.geom as { position: { x: number }; value: string; height: number };
    expect(r6(g.position.x)).toBe(30);
    expect(g.value).toBe('KEEP');
    expect(g.height).toBe(2.5);
    await bus.script(['CHANGE', 'C', '19,19', '40,23', '', '', '', '', '', '', '']);
    expect(r6((byHandle('40')!.geom as { position: { x: number } }).position.x)).toBe(30);
  });

  it('changes an attribute definition’s tag, prompt and default', async () => {
    const attdef = {
      ...(text('D') as object),
      kind: 'ATTDEF',
      tag: 'OLD',
      prompt: 'Old?',
      flags: 0,
    } as EntityGeometry;
    const { bus, byHandle, log } = setup([attdef]);
    await bus.script(['CHANGE', 'C', '19,19', '30,23', '', '', '', '', '', '']);
    expect(bus.promptText).toBe('Enter new tag <OLD>:');
    await bus.script(['A B']);
    expect(log).toContain('Tag may not contain spaces.');
    expect(bus.promptText).toBe('Enter new prompt <Old?>:');
    await bus.script(['New prompt']);
    expect(bus.promptText).toBe('Enter new default value <D>:');
    await bus.script(['E']);
    expect(byHandle('40')!.geom).toMatchObject({ tag: 'OLD', prompt: 'New prompt', value: 'E' });
    // The same tag typed again is no change.
    await bus.script(['CHANGE', 'C', '19,19', '30,23', '', '', '', '', '', '', 'OLD', '', '']);
    expect(byHandle('40')!.geom).toMatchObject({ tag: 'OLD' });
    await bus.script(['CHANGE', 'C', '19,19', '30,23', '', '', '', '', '', '', 'new', '', '']);
    expect(byHandle('40')!.geom).toMatchObject({ tag: 'NEW', prompt: 'New prompt', value: 'E' });
  });
});

describe('CHANGE keeps what is typed as it was', () => {
  it('moves a text by its position when it has no alignment point, keeping height and text', async () => {
    const t = { ...(text('SAME') as object), valign: 1 } as EntityGeometry;
    const attdef = { ...(text('D', 20, 40) as object), kind: 'ATTDEF', tag: 'T', flags: 0 };
    const { bus, byHandle } = setup([t, attdef as EntityGeometry]);
    await bus.script(['CHANGE', 'C', '19,19', '30,23', '', '25,25', '', '2.5', '', 'SAME']);
    const g = byHandle('40')!.geom as { position: { x: number; y: number }; value: string };
    expect([r6(g.position.x), r6(g.position.y)]).toEqual([25, 25]);
    expect(g.value).toBe('SAME');
    expect(byHandle('40')!.geom).toMatchObject({ height: 2.5 });
    // An attribute definition without a prompt shows an empty one.
    await bus.script(['CHANGE', 'C', '19,39', '30,43', '', '', '', '', '', '', '', 'Why?', '']);
    expect(byHandle('41')!.geom).toMatchObject({ tag: 'T', prompt: 'Why?', value: 'D' });
  });
});
