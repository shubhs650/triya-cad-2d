// M3-07 part 2: LIST writes each selected object's property data (AutoCAD 2024 Help, "LIST
// (Command)"): type, layer, space and handle; colour, linetype, lineweight and transparency
// where not BYLAYER; thickness where not zero; then what its type has, in the drawing's units.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { blockRecord, entityInit, linetype, sampleInit } from '../model/fixtures';

function host(picked: () => EntityId[]): ViewHost {
  return {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(r.op === 'pick' ? { ok: true, ids: picked() } : { ok: false, message: 'no' }),
  };
}

function drawing(header: [string, HeaderValue][] = []): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    header: new Map([...(base.header ?? []), ...header]),
    tables: {
      ...base.tables,
      linetypes: [...(base.tables?.linetypes ?? []), linetype('15', 'DASHED')],
      textStyles: [
        {
          handle: '16',
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord('17', 'Door')],
    },
    blocks: [...(base.blocks ?? []), { handle: '17', name: 'Door', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...(base.entities ?? []),
      entityInit(
        '40',
        { kind: 'LINE', start: { x: 1, y: 1 }, end: { x: 4, y: 5 }, thickness: 2 },
        {
          color: { kind: 'aci', index: 1 },
          linetype: '15',
          lineweight: 30,
          transparency: { alpha: 127 },
        },
      ),
      entityInit('41', {
        kind: 'ARC',
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: Math.PI / 2,
      }),
      entityInit('42', {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 4, y: 0, bulge: 1 },
          { x: 4, y: 2, bulge: 0 },
          { x: 0, y: 2, bulge: 0 },
        ],
      }),
      entityInit('43', {
        kind: 'TEXT',
        value: 'Hello',
        style: '16',
        position: { x: 2, y: 3 },
        height: 2.5,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      }),
      entityInit('44', {
        kind: 'INSERT',
        block: '17',
        position: { x: 5, y: 6 },
        scale: { x: 2, y: 2, z: 1 },
        rotation: Math.PI / 2,
        attributes: [],
      }),
      entityInit('45', {
        kind: 'ELLIPSE',
        center: { x: 0, y: 0 },
        majorAxis: { x: 3, y: 0 },
        ratio: 0.5,
        startParam: 0,
        endParam: 2 * Math.PI,
      }),
      entityInit('46', { kind: 'POINT', position: { x: 7, y: 8 } }),
    ],
  };
}

function setup(header: [string, HeaderValue][] = []) {
  const model = DocumentModel.create(drawing(header));
  let picks: EntityId[] = [];
  const bus = new PromptBus({ model, registry: builtinCommands(), view: host(() => picks) });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  /** LIST of the objects `handles`, picked at once; the lines it wrote. */
  const list = async (...handles: string[]): Promise<string[]> => {
    await bus.script(['LIST']);
    expect(bus.promptText).toBe('Select objects:');
    const before = log.length;
    // One object a click, as a pick takes.
    for (const h of handles) {
      picks = [model.entityByHandle(h)!.id];
      await bus.script(['1,1']);
    }
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
    // The selection's own lines are not LIST's.
    return log.slice(before).filter((l) => !/^Select objects:|found/.test(l));
  };
  return { model, bus, list };
}

const HEADER = (type: string, layer = '0', space = 'Model space') => [
  `${' '.repeat(18)}${type.padEnd(8)}  Layer: "${layer}"`,
  `                   Space: ${space}`,
];

describe('LIST', () => {
  it('lists a line: its ends, length, angle and deltas', async () => {
    const s = setup();
    expect(await s.list('20')).toEqual([
      ...HEADER('LINE'),
      '                 Handle = 20',
      '              from point, X=0.0000  Y=0.0000  Z=0.0000',
      '                to point, X=10.0000  Y=0.0000  Z=0.0000',
      '                 Length = 10.0000,  Angle in XY Plane = 0',
      '                Delta X = 10.0000, Delta Y = 0.0000, Delta Z = 0.0000',
    ]);
  });

  it('writes the properties that are not BYLAYER, and a thickness', async () => {
    const s = setup();
    expect((await s.list('40')).slice(2, 9)).toEqual([
      '                   Color: 1 (red)',
      '                Linetype: "DASHED"',
      '              Lineweight: 0.30 mm',
      '            Transparency: 50',
      '                 Handle = 40',
      '              Thickness = 2.0000',
      '              from point, X=1.0000  Y=1.0000  Z=0.0000',
    ]);
  });

  it('lists a circle on its layer, and a paper space object', async () => {
    const s = setup();
    expect(await s.list('21')).toEqual([
      ...HEADER('CIRCLE', 'WALLS'),
      '                 Handle = 21',
      '            center point, X=5.0000  Y=5.0000  Z=0.0000',
      '                   radius 2.0000',
      '            circumference 12.5664',
      '                     area 12.5664',
    ]);
    expect((await s.list('24')).slice(0, 2)).toEqual(HEADER('LINE', '0', 'Paper space'));
  });

  it('lists an arc with its length and angles', async () => {
    const s = setup();
    expect((await s.list('41')).slice(3)).toEqual([
      '            center point, X=0.0000  Y=0.0000  Z=0.0000',
      '                   radius 10.0000',
      '                   length 15.7080',
      '              total angle 90',
      '              start angle 0',
      '                end angle 90',
    ]);
  });

  it('lists a polyline: closed, width, area, perimeter and each vertex with its arcs', async () => {
    const s = setup();
    expect((await s.list('42')).slice(3)).toEqual([
      '                   Closed',
      '           Constant width 0.0000',
      `                     area ${(8 + Math.PI / 2).toFixed(4)}`,
      `                perimeter ${(10 + Math.PI).toFixed(4)}`,
      '',
      '                 at point X=0.0000  Y=0.0000  Z=0.0000',
      '                 at point X=4.0000  Y=0.0000  Z=0.0000',
      '                    bulge 1.0000',
      '                   center X=4.0000  Y=1.0000  Z=0.0000',
      '                   radius 1.0000',
      '              start angle 270',
      '                end angle 90',
      '                 at point X=4.0000  Y=2.0000  Z=0.0000',
      '                 at point X=0.0000  Y=2.0000  Z=0.0000',
    ]);
  });

  it('lists a text, a block reference, an ellipse and a point', async () => {
    const s = setup();
    expect((await s.list('43')).slice(3)).toEqual([
      '                  Style = "Standard"',
      '             start point, X=2.0000  Y=3.0000  Z=0.0000',
      '                   height 2.5000',
      '                     text Hello',
      '           rotation angle 0',
      '       width scale factor 1.0000',
      '          obliquing angle 0',
      '               generation normal',
    ]);
    const insert = await s.list('44');
    expect(insert[0]).toBe(`${' '.repeat(18)}BLOCK REFERENCE  Layer: "0"`);
    expect(insert.slice(3)).toEqual([
      '              Block Name: "Door"',
      '                at point, X=5.0000  Y=6.0000  Z=0.0000',
      '          X scale factor: 2.0000',
      '          Y scale factor: 2.0000',
      '          rotation angle: 90',
      '          Z scale factor: 1.0000',
      '         Scale uniformly: No',
      '         Allow exploding: Yes',
    ]);
    expect((await s.list('45')).slice(3)).toEqual([
      `                    Area: ${(1.5 * 3 * Math.PI).toFixed(4)}`,
      '           Circumference: 14.5327',
      '                  Center: X=0.0000  Y=0.0000  Z=0.0000',
      '              Major Axis: X=3.0000  Y=0.0000  Z=0.0000',
      '              Minor Axis: X=0.0000  Y=1.5000  Z=0.0000',
      '            Radius Ratio: 0.5000',
    ]);
    expect((await s.list('46')).slice(3)).toEqual([
      '                at point, X=7.0000  Y=8.0000  Z=0.0000',
    ]);
  });

  it('lists several objects with a blank line between them, in the drawing units', async () => {
    const s = setup([
      ['$LUNITS', 4],
      ['$LUPREC', 4],
    ]);
    const lines = await s.list('20', '23');
    expect(lines.filter((l) => l === '')).toHaveLength(1);
    expect(lines).toContain(`                to point, X=0'-10"  Y=0'-0"  Z=0'-0"`);
    expect(lines).toContain(`                to point, X=0'-0"  Y=0'-10"  Z=0'-0"`);
  });

  it('takes the objects selected before it starts', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.script(['LI']);
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.history).toContain('                at point, X=7.0000  Y=8.0000  Z=0.0000');
  });
});
