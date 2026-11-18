// M3-07 part 2: LIST writes each selected object's property data (AutoCAD 2024 Help, "LIST
// (Command)"): type, layer, space and handle; colour, linetype, lineweight and transparency
// where not BYLAYER; thickness where not zero; then what its type has, in the drawing's units.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type Color,
  type DocumentInit,
  type EntityGeometry,
  type EntityInit,
  type EntityId,
  type HeaderValue,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { listObject } from '../../src/commands/inquiry/list';
import { LAYER_0, blockRecord, entityInit, linetype, sampleInit } from '../model/fixtures';

function host(picked: () => EntityId[], lwunits?: number): ViewHost {
  return {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(
        r.op === 'pick'
          ? { ok: true, ids: picked() }
          : r.op === 'sysvar' && r.name === 'LWUNITS' && lwunits !== undefined
            ? { ok: true, value: lwunits }
            : { ok: false, message: 'no' },
      ),
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
      entityInit('47', {
        kind: 'LINE',
        start: { x: 0, y: 0 },
        end: { x: 3, y: 4 },
        heights: [1, 13],
      }),
    ],
  };
}

function setup(header: [string, HeaderValue][] = [], lwunits?: number) {
  const model = DocumentModel.create(drawing(header));
  let picks: EntityId[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => picks, lwunits),
  });
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

  // M3-18 (DEC-063): a sloped line lists each end's height, its 3D length and Delta Z.
  it('lists a sloped line with its heights', async () => {
    const s = setup();
    expect((await s.list('47')).slice(3)).toEqual([
      '              from point, X=0.0000  Y=0.0000  Z=1.0000',
      '                to point, X=3.0000  Y=4.0000  Z=13.0000',
      '                 Length = 13.0000,  Angle in XY Plane = 53',
      '                Delta X = 3.0000, Delta Y = 4.0000, Delta Z = 12.0000',
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

  // M5-12: AutoCAD lists a lineweight in LWUNITS' units (AutoCAD 2024 Help, "LWUNITS").
  it('writes the lineweight in inches under LWUNITS 0, millimetres under 1', async () => {
    expect(await setup([], 0).list('40')).toContain('              Lineweight: 0.012"');
    expect(await setup([], 1).list('40')).toContain('              Lineweight: 0.30 mm');
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

describe('listObject', () => {
  const DIM = {
    kind: 'DIMENSION',
    style: '27',
    definitionPoint: { x: 0, y: 0 },
    textPosition: { x: 5, y: 6 },
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  } as const;
  const TEXT = {
    style: '16',
    position: { x: 1, y: 2 },
    height: 1,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
  } as const;

  /** LIST's lines for `geom` (with `extra` entity properties), past its header and handle. */
  function lines(geom: object, extra: Partial<EntityInit> = {}, skip = 3): string[] {
    const base = drawing();
    const model = DocumentModel.create({
      ...base,
      entities: [...(base.entities ?? []), entityInit('90', geom as EntityGeometry, extra)],
    });
    return listObject(model, model.entityByHandle('90')!).slice(skip);
  }

  it('writes BYBLOCK and true colours, and an extrusion that is not +Z', () => {
    expect(
      lines(
        { kind: 'POINT', position: { x: 0, y: 0 }, normal: { x: 0, y: 0, z: -1 } },
        {
          color: { kind: 'byBlock' },
          linetype: 'ByBlock',
          lineweight: 'ByBlock',
          transparency: 'ByBlock',
        },
        2,
      ).slice(0, 6),
    ).toEqual([
      '                   Color: BYBLOCK',
      '                Linetype: "BYBLOCK"',
      '              Lineweight: BYBLOCK',
      '            Transparency: BYBLOCK',
      '                 Handle = 90',
      '      Extrusion direction relative to UCS: X=0.0000  Y=0.0000  Z=-1.0000',
    ]);
    const color = (c: Color, lw: EntityInit['lineweight'] = 'ByLayer') =>
      lines({ kind: 'POINT', position: { x: 0, y: 0 } }, { color: c, lineweight: lw }, 2);
    expect(color({ kind: 'rgb', r: 1, g: 2, b: 3 })[0]).toBe('                   Color: RGB:1,2,3');
    expect(color({ kind: 'rgb', r: 1, g: 2, b: 3, bookName: 'BOOK', colorName: 'TEAL' })[0]).toBe(
      '                   Color: BOOK$TEAL',
    );
    expect(color({ kind: 'aci', index: 30 }, 'Default')).toEqual(
      expect.arrayContaining(['                   Color: 30', '              Lineweight: Default']),
    );
  });

  it('lists xlines and rays by base and second point', () => {
    for (const kind of ['XLINE', 'RAY']) {
      expect(lines({ kind, base: { x: 1, y: 1 }, direction: { x: 0, y: 1 } })).toEqual([
        '              base point, X=1.0000  Y=1.0000  Z=0.0000',
        '            second point, X=1.0000  Y=2.0000  Z=0.0000',
      ]);
    }
  });

  it('lists the widths of each vertex of a polyline whose widths vary, and its elevation', () => {
    const out = lines({
      kind: 'LWPOLYLINE',
      closed: false,
      elevation: 3,
      vertices: [
        { x: 0, y: 0, bulge: 0, startWidth: 1, endWidth: 0 },
        { x: 5, y: 0, bulge: 0 },
      ],
    });
    expect(out.slice(0, 5)).toEqual([
      '                     Open',
      '                elevation 3.0000',
      '                     area 0.0000',
      '                   length 5.0000',
      '',
    ]);
    expect(out.slice(5, 8)).toEqual([
      '                 at point X=0.0000  Y=0.0000  Z=3.0000',
      '           starting width 1.0000',
      '             ending width 0.0000',
    ]);
    const heavy = lines({
      kind: 'POLYLINE',
      closed: false,
      is3d: false,
      vertices: [{ x: 0, y: 0, bulge: 0 }],
    });
    expect(heavy).toEqual([
      '                     Open',
      '           Constant width 0.0000',
      '',
      '                 at point X=0.0000  Y=0.0000  Z=0.0000',
    ]);
  });

  it('lists an elliptical arc with its length and angles', () => {
    const out = lines({
      kind: 'ELLIPSE',
      center: { x: 0, y: 0 },
      majorAxis: { x: 2, y: 0 },
      ratio: 1,
      startParam: 0,
      endParam: Math.PI,
    });
    expect(out[1]).toBe(`                  Length: ${(2 * Math.PI).toFixed(4)}`);
    expect(out.slice(-2)).toEqual(['             Start Angle: 0', '               End Angle: 180']);
  });

  it('lists a spline: order, properties, range, control and fit points', () => {
    const out = lines({
      kind: 'SPLINE',
      degree: 1,
      knots: [0, 0, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      weights: [1, 2],
      fitPoints: [{ x: 0, y: 0 }],
      closed: false,
      periodic: true,
    });
    expect(out).toEqual([
      '                  Length: 5.0000',
      '                   Order: 2',
      '              Properties: Planar, Rational, Periodic',
      '        Parametric Range: Start 0.0000',
      '                          End 1.0000',
      'Number of control points: 2',
      '          Control Points: X=0.0000  Y=0.0000  Z=0.0000',
      '                          X=3.0000  Y=4.0000  Z=0.0000',
      '    Number of fit points: 1',
      '    User Data: Fit Points X=0.0000  Y=0.0000  Z=0.0000',
    ]);
    const closed = lines({
      kind: 'SPLINE',
      degree: 1,
      knots: [0, 0, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      closed: true,
      periodic: false,
    });
    expect(closed[0]).toMatch(/^ +Perimeter: /);
    expect(closed).toContain('              Properties: Planar, Non-Rational, Non-Periodic');
    expect(closed.at(-1)).toBe('    Number of fit points: 0');
  });

  it('lists an attribute definition and how a text is mirrored', () => {
    const out = lines({
      kind: 'ATTDEF',
      ...TEXT,
      value: 'D1',
      tag: 'NUM',
      prompt: 'Number?',
      flags: 0,
      backward: true,
      upsideDown: true,
    });
    expect(out.slice(0, 4)).toEqual([
      '                  Style = "Standard"',
      '                     Tag: NUM',
      '                  Prompt: Number?',
      '                 Default: D1',
    ]);
    expect(out.at(-1)).toBe('               generation backward, upside down');
    const text = (backward: boolean, upsideDown: boolean) =>
      lines({ kind: 'TEXT', ...TEXT, value: 'A', backward, upsideDown }).at(-1);
    expect(text(true, false)).toBe('               generation backward');
    expect(text(false, true)).toBe('               generation upside down');
  });

  it('lists an mtext', () => {
    expect(
      lines({
        kind: 'MTEXT',
        contents: 'one\\Ptwo',
        style: '16',
        position: { x: 1, y: 2 },
        height: 2.5,
        width: 30,
        rotation: 0,
        attachment: 1,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      }),
    ).toEqual([
      '                Location: X=1.0000  Y=2.0000  Z=0.0000',
      '                   Width: 30.0000',
      '                Rotation: 0',
      '              Text style: "Standard"',
      '             Text height: 2.5000',
      '              Attachment: TopLeft',
      '                Contents: one\\Ptwo',
    ]);
    expect(
      lines({
        kind: 'MTEXT',
        contents: '',
        style: '99',
        position: { x: 0, y: 0 },
        height: 1,
        width: 0,
        rotation: 0,
        attachment: 12,
        direction: 1,
        lineSpacingStyle: 1,
        lineSpacing: 1,
      }).slice(3, 6),
    ).toEqual([
      '              Text style: ""',
      '             Text height: 1.0000',
      '              Attachment: 12',
    ]);
  });

  it('lists a block reference array and its attributes, and one of an unknown block', () => {
    const out = lines({
      kind: 'INSERT',
      block: '17',
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      array: { columns: 2, rows: 3, columnSpacing: 4, rowSpacing: 5 },
      attributes: [
        {
          ...TEXT,
          handle: '9A',
          layer: LAYER_0,
          tag: 'NUM',
          value: '7',
          flags: 0,
          backward: false,
          upsideDown: false,
        },
      ],
    });
    expect(out.slice(8)).toEqual([
      '                 Columns: 2',
      '                    Rows: 3',
      '          Column spacing: 4.0000',
      '             Row spacing: 5.0000',
      '',
      `${' '.repeat(18)}ATTRIBUTE  Layer: "0"`,
      '                 Handle = 9a',
      '                  Style = "Standard"',
      '                     Tag: NUM',
      '                   Value: 7',
      '             start point, X=1.0000  Y=2.0000  Z=0.0000',
      '                   height 1.0000',
      '           rotation angle 0',
    ]);
    const unknown = lines({
      kind: 'INSERT',
      block: '99',
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    });
    expect(unknown[0]).toBe('              Block Name: ""');
    expect(unknown).toHaveLength(6);
  });

  it('lists a dimension: type, measurement, text override and style', () => {
    const dim = (geom: object) => lines({ ...DIM, ...geom });
    expect(
      dim({ dimType: 'aligned', first: { x: 0, y: 0 }, second: { x: 3, y: 4 }, text: 'W=<>' }),
    ).toEqual([
      '                    type: Aligned',
      '             measurement: 5.0000',
      '           text override: W=<>',
      '           text position, X=5.0000  Y=6.0000  Z=0.0000',
      '         dimension style: ""',
    ]);
    const measured = (geom: object) => dim(geom)[1];
    expect(
      measured({
        dimType: 'linear',
        first: { x: 0, y: 0 },
        second: { x: 3, y: 4 },
        rotation: Math.PI / 2,
      }),
    ).toBe('             measurement: 4.0000');
    expect(measured({ dimType: 'linear', first: { x: 0, y: 0 }, second: { x: 3, y: 4 } })).toBe(
      '             measurement: 3.0000',
    );
    for (const dimType of ['radius', 'diameter']) {
      expect(measured({ dimType, chordPoint: { x: 0, y: 2 }, leaderLength: 0, text: '<>' })).toBe(
        '             measurement: 2.0000',
      );
    }
    expect(
      measured({
        kind: 'LARGE_RADIAL_DIMENSION',
        dimType: 'jogged',
        chordPoint: { x: 3, y: 0 },
        overrideCenter: { x: 0, y: 0 },
        jogPoint: { x: 0, y: 0 },
        leaderLength: 0,
      }),
    ).toBe('             measurement: 3.0000');
    for (const second of [
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: -1, y: -0.0001 },
    ]) {
      expect(
        measured({
          dimType: 'angular3pt',
          vertex: { x: 0, y: 0 },
          first: { x: 1, y: 0 },
          second,
        }),
      ).toMatch(/measurement: (90|180)$/);
    }
    expect(
      measured({
        kind: 'ARC_DIMENSION',
        dimType: 'arc',
        first: { x: 2, y: 0 },
        second: { x: -2, y: 0 },
        center: { x: 0, y: 0 },
        startAngle: Math.PI,
        endAngle: 0,
        partial: false,
      }),
    ).toBe(`             measurement: ${(2 * Math.PI).toFixed(4)}`);
    const angular = dim({
      dimType: 'angular',
      line1Start: { x: 0, y: 0 },
      line1End: { x: 1, y: 0 },
      line2Start: { x: 0, y: 0 },
      arcPoint: { x: 1, y: 1 },
    });
    expect(angular[0]).toBe('                    type: Angular');
    expect(angular[1]).toMatch(/text position,/);
    expect(
      dim({
        dimType: 'ordinate',
        axis: 'x',
        feature: { x: 0, y: 0 },
        leaderEnd: { x: 0, y: 0 },
      })[0],
    ).toBe('                    type: Ordinate');
  });

  it('lists a hatch: pattern, scale and angle, associativity', () => {
    const hatch = (solid: boolean) =>
      lines({
        kind: 'HATCH',
        pattern: solid ? 'SOLID' : 'ANSI31',
        solid,
        associative: solid,
        style: 0,
        patternType: 1,
        patternAngle: Math.PI / 4,
        patternScale: 2,
        double: false,
        loops: [],
        patternLines: [],
        seedPoints: [],
      });
    expect(hatch(true)).toEqual([
      '            Hatch pattern SOLID',
      '             Associative: Yes',
    ]);
    expect(hatch(false)).toEqual([
      '            Hatch pattern ANSI31',
      '              Hatch scale 2.0000',
      '              Hatch angle 45',
      '             Associative: No',
    ]);
  });

  it('lists only the header of a type it does not read further', () => {
    expect(lines({ kind: 'REGION' }, {}, 0)).toEqual([
      ...HEADER('REGION'),
      '                 Handle = 90',
    ]);
  });
});
