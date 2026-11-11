// M2-06: ERASE, MOVE, COPY, ROTATE, SCALE and MIRROR on the PromptBus, driven as the command line
// drives them, with AutoCAD 2024's prompts and options (AutoCAD 2024 Help, "MOVE (Command)",
// "COPY (Command)", "ROTATE (Command)", "SCALE (Command)", "MIRROR (Command)", "ERASE (Command)").
// The sample drawing's model space holds 20 (0,0)-(10,0), 21 a circle at (5,5) r 2 and
// 23 (0,0)-(0,10); 24 is in paper space. "ALL" selects the model-space three.
import { describe, expect, it } from 'vitest';
import {
  type CommandRegistry,
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type HeaderValue,
  type DragMotion,
  type Prompt,
  type ViewReply,
  type ViewRequest,
  applyPoint,
  dragMotion,
  inBox,
} from '../../src/index';
import { MODEL_SPACE, entityInit, lineGeom, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

function setup(init: DocumentInit = sampleInit()) {
  const model = DocumentModel.create(init);
  const registry = builtinCommands();
  const bus = new PromptBus({ model, registry });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const original = new Set([...model.entities()].map((e) => e.id));
  const byHandle = (h: string) => model.entityByHandle(h)!;
  const added = (): Entity[] => [...model.entities()].filter((e) => !original.has(e.id));
  const ends = (e: Entity) => {
    const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
    return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
  };
  const circle = (e: Entity) => {
    const g = e.geom as { center: { x: number; y: number }; radius: number };
    return [g.center.x, g.center.y, g.radius].map(r6);
  };
  return { model, bus, log, byHandle, added, ends, circle };
}

const withHeader = (entries: [string, HeaderValue][]): DocumentInit => {
  const base = sampleInit();
  return { ...base, header: new Map([...(base.header ?? []), ...entries]) };
};

describe('ERASE', () => {
  it('erases the selection, and OOPS brings it back', async () => {
    const s = setup();
    await s.bus.script(['E', 'ALL', '']);
    expect(s.model.blockEntities(MODEL_SPACE)).toHaveLength(0);
    expect(s.model.entityByHandle('24')).toBeDefined();
    await s.bus.script(['OOPS']);
    expect(s.model.blockEntities(MODEL_SPACE)).toHaveLength(3);
  });

  it('ends without a word when nothing is selected', async () => {
    const s = setup();
    await s.bus.script(['ERASE', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.model.blockEntities(MODEL_SPACE)).toHaveLength(3);
  });

  it('takes the PICKFIRST pre-selection', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.script(['ERASE']);
    expect(s.bus.command).toBeUndefined();
    expect(s.model.blockEntities(MODEL_SPACE)).toHaveLength(0);
  });
});

describe('MOVE', () => {
  it('moves from a base point to a second point', async () => {
    const s = setup();
    await s.bus.script(['M', 'ALL', '', '0,0']);
    expect(s.bus.promptText).toBe('Specify second point or <use first point as displacement>:');
    expect(s.bus.prompt).toMatchObject({ rubberBand: { from: { x: 0, y: 0 } } });
    await s.bus.submit('@5,5');
    expect(s.ends(s.byHandle('20'))).toEqual([5, 5, 15, 5]);
    expect(s.circle(s.byHandle('21'))).toEqual([10, 10, 2]);
    expect(s.added()).toEqual([]);
  });

  it('takes the base point as the displacement on Enter', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL', '', '3,4', '']);
    expect(s.ends(s.byHandle('20'))).toEqual([3, 4, 13, 4]);
  });

  it('asks for a displacement, the last one by default', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL', '']);
    expect(s.bus.promptText).toBe('Specify base point or [Displacement] <Displacement>:');
    await s.bus.script(['D']);
    expect(s.bus.promptText).toBe('Specify displacement <0.0000,0.0000>:');
    await s.bus.script(['1,2']);
    await s.bus.script(['MOVE', 'ALL', '', '', '']);
    expect(s.ends(s.byHandle('20'))).toEqual([2, 4, 12, 4]);
  });

  it('is one undo step', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL', '', '0,0', '5,0', 'U']);
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 10, 0]);
  });
});

describe('COPY', () => {
  it('copies to each second point until Enter (COPYMODE Multiple)', async () => {
    const s = setup();
    await s.bus.script(['CO', 'ALL', '']);
    expect(s.log).toContain('Current settings:  Copy mode = Multiple');
    await s.bus.script(['0,0', '20,0']);
    expect(s.bus.promptText).toBe('Specify second point or [Array/Exit/Undo] <Exit>:');
    await s.bus.script(['40,0', '']);
    expect(s.bus.command).toBeUndefined();
    const lines = s
      .added()
      .filter((e) => e.type === 'LINE')
      .map(s.ends);
    expect(lines).toEqual([
      [20, 0, 30, 0],
      [20, 0, 20, 10],
      [40, 0, 50, 0],
      [40, 0, 40, 10],
    ]);
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 10, 0]);
    // The copies are new objects: handles of their own, on the source's layer.
    const handles = new Set(s.added().map((e) => e.handle));
    expect(handles.size).toBe(6);
    expect(s.added().find((e) => e.type === 'CIRCLE')?.layer).toBe(s.byHandle('21').layer);
  });

  it('takes the last copy back with Undo', async () => {
    const s = setup();
    await s.bus.script(['COPY', 'ALL', '', '0,0', '20,0', '40,0', 'U']);
    expect(s.added()).toHaveLength(3);
    await s.bus.script(['U']);
    expect(s.added()).toHaveLength(0);
    // Exit and Undo stay offered; Enter now ends the command without a copy.
    expect(s.bus.promptText).toBe('Specify second point or [Array/Exit/Undo] <Exit>:');
    await s.bus.script(['U', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.added()).toHaveLength(0);
  });

  it('makes one copy in Single mode, and remembers the mode', async () => {
    const s = setup();
    await s.bus.script(['COPY', 'ALL', '', 'O']);
    expect(s.bus.promptText).toBe('Enter a copy mode option [Single/Multiple] <Multiple>:');
    await s.bus.script(['S', '0,0', '5,0']);
    expect(s.bus.command).toBeUndefined();
    expect(s.added()).toHaveLength(3);
    await s.bus.script(['COPY', 'ALL', '']);
    expect(s.log.at(-1)).toBe('Current settings:  Copy mode = Single');
  });

  it('copies by a displacement, or by the base point on Enter', async () => {
    const s = setup();
    await s.bus.script(['COPY', 'ALL', '', 'D', '0,20']);
    expect(
      s
        .added()
        .filter((e) => e.type === 'CIRCLE')
        .map(s.circle),
    ).toEqual([[5, 25, 2]]);
    // Last is the newest object, the copy of 23: Enter takes the base point as the vector.
    await s.bus.script(['COPY', 'L', '', '0,-40', '']);
    expect(s.added()).toHaveLength(4);
    expect(s.ends(s.added().at(-1)!)).toEqual([0, -20, 0, -10]);
  });

  it('arrays copies by the spacing given, or fitted to the distance (Array, Fit)', async () => {
    const s = setup();
    await s.bus.script(['COPY', 'ALL', '', '0,0', 'A', '1']);
    expect(s.log.at(-1)).toBe('Value must be an integer greater than 1.');
    await s.bus.script(['4', '10,0']);
    const xs = () =>
      s
        .added()
        .filter((e) => e.type === 'CIRCLE')
        .map((e) => s.circle(e)[0]);
    expect(xs()).toEqual([15, 25, 35]);
    await s.bus.script(['A', '3', 'F', '0,10', '']);
    expect(xs()).toEqual([15, 25, 35, 5, 5]);
    expect(
      s
        .added()
        .filter((e) => e.type === 'CIRCLE')
        .map((e) => s.circle(e)[1]),
    ).toEqual([5, 5, 5, 10, 15]);
  });
});

describe('ROTATE', () => {
  it('says the angle convention, and turns about the base point', async () => {
    const s = setup();
    await s.bus.script(['RO']);
    expect(s.log).toContain('Current positive angle in UCS:  ANGDIR=counterclockwise  ANGBASE=0');
    await s.bus.script(['ALL', '', '0,0']);
    expect(s.bus.promptText).toBe('Specify rotation angle or [Copy/Reference] <0>:');
    await s.bus.script(['90']);
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 0, 10]);
    expect(s.circle(s.byHandle('21'))).toEqual([-5, 5, 2]);
    // The last angle is the next default.
    await s.bus.script(['ROTATE', 'ALL', '', '0,0']);
    expect(s.bus.promptText).toBe('Specify rotation angle or [Copy/Reference] <90>:');
  });

  it('takes a typed angle, wherever the cursor moved meanwhile (M2-34)', async () => {
    const s = setup();
    await s.bus.script(['ROTATE', 'ALL', '', '0,0']);
    // The command line sends the cursor with what was typed; the drag follows it, the typed
    // value wins.
    for (const p of [
      { x: 5, y: 0 },
      { x: -3, y: 0.001 },
      { x: 0, y: -7 },
    ])
      s.bus.pointer(p);
    await s.bus.submit('90');
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 0, 10]);
  });

  it('rotates by the angle to a picked point', async () => {
    const s = setup();
    await s.bus.script(['ROTATE', 'ALL', '', '0,0']);
    await s.bus.answer({ kind: 'point', point: { x: -1, y: 0 } });
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, -10, 0]);
  });

  it('rotates a copy (Copy)', async () => {
    const s = setup();
    await s.bus.script(['ROTATE', 'ALL', '', '0,0', 'C']);
    expect(s.log.at(-1)).toBe('Rotating a copy of the selected objects.');
    await s.bus.script(['180']);
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 10, 0]);
    expect(
      s
        .added()
        .filter((e) => e.type === 'CIRCLE')
        .map(s.circle),
    ).toEqual([[-5, -5, 2]]);
  });

  it('turns from a reference angle to a new one (Reference, Points)', async () => {
    const s = setup();
    await s.bus.script(['ROTATE', 'ALL', '', '0,0', 'R', '30', '120']);
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, 0, 10]);
    // From 90° to the angle of (0,0)→(-1,0), 180°: a further quarter turn.
    await s.bus.script(['ROTATE', 'ALL', '', '0,0', 'R', '90', 'P', '0,0', '-1,0']);
    expect(s.ends(s.byHandle('20'))).toEqual([0, 0, -10, 0]);
  });
});

describe('SCALE', () => {
  it('scales about the base point', async () => {
    const s = setup();
    await s.bus.script(['SC', 'ALL', '', '0,0']);
    expect(s.bus.promptText).toBe('Specify scale factor or [Copy/Reference] <1.0000>:');
    await s.bus.script(['2']);
    expect(s.circle(s.byHandle('21'))).toEqual([10, 10, 4]);
    expect(s.ends(s.byHandle('23'))).toEqual([0, 0, 0, 20]);
  });

  it('refuses a factor that is not positive', async () => {
    const s = setup();
    await s.bus.script(['SCALE', 'ALL', '', '0,0', '0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    expect(s.bus.command).toBe('SCALE');
    await s.bus.script(['0.5']);
    expect(s.circle(s.byHandle('21'))).toEqual([2.5, 2.5, 1]);
  });

  it('scales a copy (Copy), and from a reference length (Reference, Points)', async () => {
    const s = setup();
    await s.bus.script(['SCALE', 'ALL', '', '0,0', 'C']);
    expect(s.log.at(-1)).toBe('Scaling a copy of the selected objects.');
    await s.bus.script(['3']);
    expect(
      s
        .added()
        .filter((e) => e.type === 'CIRCLE')
        .map(s.circle),
    ).toEqual([[15, 15, 6]]);
    await s.bus.script(['SCALE', 'ALL', '', '0,0', 'R', '-1']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['5', '10']);
    expect(s.circle(s.byHandle('21'))).toEqual([10, 10, 4]);
    await s.bus.script(['SCALE', 'ALL', '', '0,0', 'R', '4', 'P', '0,0', '0,2']);
    expect(s.circle(s.byHandle('21'))).toEqual([5, 5, 2]);
  });
});

describe('MIRROR', () => {
  it('mirrors copies, keeping the originals by default', async () => {
    const s = setup();
    await s.bus.script(['MI', 'ALL', '', '-1,0']);
    expect(s.bus.prompt).toMatchObject({ rubberBand: { from: { x: -1, y: 0 } } });
    await s.bus.script(['-1,10']);
    expect(s.bus.promptText).toBe('Erase source objects? [Yes/No] <No>:');
    await s.bus.script(['']);
    expect(
      s
        .added()
        .filter((e) => e.type === 'CIRCLE')
        .map(s.circle),
    ).toEqual([[-7, 5, 2]]);
    expect(s.circle(s.byHandle('21'))).toEqual([5, 5, 2]);
  });

  it('mirrors the objects themselves when the source goes (Yes)', async () => {
    const s = setup();
    await s.bus.script(['MIRROR', 'ALL', '', '0,-1', '10,-1', 'Y']);
    expect(s.added()).toEqual([]);
    expect(s.circle(s.byHandle('21'))).toEqual([5, -7, 2]);
    expect(s.ends(s.byHandle('20'))).toEqual([0, -2, 10, -2]);
  });

  it('asks again for a mirror line of one point', async () => {
    const s = setup();
    await s.bus.script(['MIRROR', 'ALL', '', '1,1', '1,1']);
    expect(s.log.at(-1)).toBe('Mirror line points must be different.');
    expect(s.bus.promptText).toBe('Specify second point of mirror line:');
  });

  it('keeps text readable (MIRRTEXT 0), or mirrors it (MIRRTEXT 1)', async () => {
    const text = (handle: string) =>
      entityInit(handle, {
        kind: 'TEXT',
        value: 'A',
        style: '0',
        position: { x: 2, y: 0 },
        height: 1,
        rotation: 0,
        widthFactor: 1,
        oblique: 0,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: false,
      });
    for (const [mirrtext, expected] of [
      [0, { position: { x: -2, y: 0 }, halign: 2, backward: false, rotation: 0 }],
      [1, { position: { x: -2, y: 0 }, halign: 0, backward: true, rotation: 0 }],
    ] as const) {
      const init = withHeader([['$MIRRTEXT', mirrtext]]);
      const s = setup({ ...init, entities: [text('30')] });
      await s.bus.script(['MIRROR', 'ALL', '', '0,0', '0,1', 'Y']);
      const g = s.byHandle('30').geom as { position: { x: number; y: number } };
      expect({ ...g, position: { x: r6(g.position.x), y: r6(g.position.y) } }).toMatchObject(
        expected,
      );
    }
  });
});

describe('refusals', () => {
  it('names what an edit left out and why', async () => {
    const base = sampleInit();
    const s = setup({
      ...base,
      entities: [
        ...(base.entities ?? []),
        entityInit('31', {
          kind: 'REGION',
          loops: [{ face: 0, edges: [{ kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 1 }] }],
        }),
      ],
    });
    await s.bus.script(['MIRROR', 'ALL', '', '0,0', '0,1', 'Y']);
    expect(s.log).toContain('1 object was not mirrored: a region cannot be mirrored.');
    await s.bus.script(['COPY', 'ALL', '', '0,0', '5,0', '']);
    expect(s.log).toContain('1 object was not copied: a region cannot be copied.');
    expect(s.added().some((e) => e.type === 'REGION')).toBe(false);
  });
});

describe('registry', () => {
  it('registers the edit commands with their acad.pgp aliases', () => {
    const r: CommandRegistry = builtinCommands();
    for (const [alias, name] of [
      ['E', 'ERASE'],
      ['M', 'MOVE'],
      ['CP', 'COPY'],
      ['RO', 'ROTATE'],
      ['SC', 'SCALE'],
      ['MI', 'MIRROR'],
      ['S', 'STRETCH'],
    ]) {
      expect(r.resolve(alias!)?.def.name).toBe(name);
    }
  });
});

describe('Enter where no default is offered ends the command unchanged', () => {
  it.each([
    [['ROTATE', 'ALL', '', '']],
    [['ROTATE', 'ALL', '', '0,0', 'R', '0', 'P', '']],
    [['ROTATE', 'ALL', '', '0,0', 'R', '0', 'P', '0,0', '']],
    [['SCALE', 'ALL', '', '']],
    [['SCALE', 'ALL', '', '0,0', 'R', '1', 'P', '']],
    [['SCALE', 'ALL', '', '0,0', 'R', '1', 'P', '0,0', '']],
    [['MIRROR', 'ALL', '', '']],
    [['MIRROR', 'ALL', '', '0,0', '']],
    [['MOVE', 'ALL', '', '0,0', 'X']],
    [['MOVE', '']],
    [['ROTATE', '']],
    [['SCALE', '']],
    [['MIRROR', '']],
    [['COPY', '']],
  ])('%j', async (steps) => {
    const s = setup();
    const before = [...s.model.entities()];
    await s.bus.script(steps);
    if (s.bus.command) await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    expect([...s.model.entities()]).toEqual(before);
  });

  it("leaves COPY's Array unmade on Enter, and offers the base point again", async () => {
    const s = setup();
    await s.bus.script(['COPY', 'ALL', '', '0,0', 'A', '']);
    expect(s.bus.promptText).toBe(
      'Specify second point or [Array] <use first point as displacement>:',
    );
    await s.bus.script(['A', '3', '']);
    expect(s.added()).toHaveLength(0);
    expect(s.bus.command).toBe('COPY');
  });
});

describe('settings and toggles', () => {
  it('says a clockwise ANGDIR and a fractional ANGBASE', async () => {
    const s = setup(
      withHeader([
        ['$ANGDIR', 1],
        ['$ANGBASE', 0.5],
      ]),
    );
    await s.bus.script(['ROTATE']);
    expect(s.log).toContain('Current positive angle in UCS:  ANGDIR=clockwise  ANGBASE=28.6479');
  });

  it('shows angles to AUPREC places', async () => {
    const s = setup(withHeader([['$AUPREC', 2]]));
    await s.bus.script(['ROTATE', 'ALL', '', '0,0']);
    expect(s.bus.promptText).toBe('Specify rotation angle or [Copy/Reference] <0.00>:');
  });

  it('turns Copy off again when asked twice (ROTATE, SCALE)', async () => {
    const s = setup();
    await s.bus.script(['ROTATE', 'ALL', '', '0,0', 'C', 'C']);
    expect(s.log.at(-1)).toBe('Rotating the selected objects.');
    await s.bus.script(['90']);
    await s.bus.script(['SCALE', 'ALL', '', '0,0', 'C', 'C']);
    expect(s.log.at(-1)).toBe('Scaling the selected objects.');
    await s.bus.script(['2']);
    expect(s.added()).toHaveLength(0);
    expect(s.circle(s.byHandle('21'))).toEqual([-10, 10, 4]);
  });

  it('reads MIRRTEXT given as a boolean', async () => {
    const s = setup({
      ...withHeader([['$MIRRTEXT', true]]),
      entities: [
        entityInit('30', {
          kind: 'TEXT',
          value: 'A',
          style: '0',
          position: { x: 2, y: 0 },
          height: 1,
          rotation: 0,
          widthFactor: 1,
          oblique: 0,
          halign: 0,
          valign: 0,
          backward: false,
          upsideDown: false,
        }),
      ],
    });
    await s.bus.script(['MIRROR', 'ALL', '', '0,0', '0,1', 'Y']);
    expect(s.byHandle('30').geom).toMatchObject({ backward: true });
  });

  it('says when a copy loses its annotation scales', async () => {
    const base = sampleInit();
    const s = setup({
      ...base,
      entities: [
        entityInit('30', lineGeom(0, 0, 1, 0), {
          annotative: { representations: [{ handle: '31' }] },
        }),
        entityInit('32', lineGeom(0, 0, 1, 0), {
          annotative: { representations: [{ handle: '33' }] },
        }),
      ],
    });
    await s.bus.script(['COPY', 'ALL', '', 'D', '1,1']);
    expect(s.log).toContain('2 copies are not annotative (annotative copies are not saved yet).');
    // The copies are not annotative: copying one of them says nothing more.
    const said = s.log.length;
    await s.bus.script(['COPY', 'L', '', 'D', '1,1']);
    expect(s.log.slice(said).some((l) => l.includes('annotative'))).toBe(false);
    const one = setup({
      ...base,
      entities: [
        entityInit('30', lineGeom(0, 0, 1, 0), {
          annotative: { representations: [{ handle: '31' }] },
        }),
      ],
    });
    await one.bus.script(['COPY', 'ALL', '', 'D', '1,1']);
    expect(one.log).toContain('1 copy is not annotative (annotative copies are not saved yet).');
  });
});

/**
 * A bus whose canvas takes a window or crossing by the lines' end points (the renderer's exact
 * rules are tested in packages/render): a window holds a line with both ends inside, a
 * crossing one with either.
 */
function withCanvas(init: DocumentInit = sampleInit()) {
  const model = DocumentModel.create(init);
  const registry = builtinCommands();
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op !== 'select') return { ok: true, ids: [] };
    const box = {
      minX: Math.min(r.a.x, r.b.x),
      minY: Math.min(r.a.y, r.b.y),
      maxX: Math.max(r.a.x, r.b.x),
      maxY: Math.max(r.a.y, r.b.y),
    };
    const ids = [...model.blockEntities(MODEL_SPACE)].filter((id) => {
      const g = model.entity(id)!.geom;
      const pts = g.kind === 'LINE' ? [g.start, g.end] : g.kind === 'CIRCLE' ? [g.center] : [];
      const ins = pts.filter(inBox(box)).length;
      return r.crossing ? ins > 0 : ins === pts.length && ins > 0;
    });
    return { ok: true, ids };
  };
  const bus = new PromptBus({
    model,
    registry,
    view: { request: (r) => Promise.resolve(answer(r)) },
  });
  const log: string[] = [];
  const prompts: Prompt[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
    if (e.type === 'prompt') prompts.push(e.prompt);
  });
  const ends = (h: string) => {
    const g = model.entityByHandle(h)!.geom as {
      start: { x: number; y: number };
      end: { x: number; y: number };
    };
    return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
  };
  return { model, bus, log, prompts, ends, id: (h: string) => model.entityByHandle(h)!.id };
}

describe('STRETCH', () => {
  it('stretches what the crossing window crosses and moves what it holds', async () => {
    // 20 (0,0)-(10,0), 23 (0,0)-(0,10), circle 21 at (5,5).
    const s = withCanvas();
    await s.bus.script(['STRETCH']);
    expect(s.log).toContain('Select objects to stretch by crossing-window or crossing-polygon...');
    // A crossing window around x = 10 takes 20's end; one around (0,10) takes 23's end.
    await s.bus.script(['C', '8,-1', '12,1', '', '0,0', '5,2']);
    expect(s.ends('20')).toEqual([0, 0, 15, 2]);
    expect(s.ends('23')).toEqual([0, 0, 0, 10]);
    expect(s.bus.command).toBeUndefined();
  });

  it('moves objects picked individually and those wholly inside', async () => {
    const s = withCanvas();
    await s.bus.script(['S', 'C', '-1,-1', '1,11', '']);
    expect(s.bus.promptText).toBe('Specify base point or [Displacement] <Displacement>:');
    await s.bus.script(['D', '3,0']);
    // 23 lies wholly in the window: moved. 20 has its start inside: stretched.
    expect(s.ends('23')).toEqual([3, 0, 3, 10]);
    expect(s.ends('20')).toEqual([3, 0, 10, 0]);
  });

  it('stretches by a displacement, the last one by default', async () => {
    const s = withCanvas();
    await s.bus.script(['STRETCH', 'C', '8,-1', '12,1', '', 'D', '2,0']);
    expect(s.ends('20')).toEqual([0, 0, 12, 0]);
    await s.bus.script(['STRETCH', 'C', '11,-1', '13,1', '', '', '']);
    expect(s.ends('20')).toEqual([0, 0, 14, 0]);
    // Enter at the second point takes the base point as the displacement.
    await s.bus.script(['STRETCH', 'C', '13,-1', '15,1', '', '1,1', '']);
    expect(s.ends('20')).toEqual([0, 0, 15, 1]);
    await s.bus.script(['STRETCH', '']);
    expect(s.bus.command).toBeUndefined();
  });

  it('just moves a selection made without a window', async () => {
    const s = withCanvas();
    await s.bus.script(['STRETCH', 'ALL', '', '0,0', '1,1']);
    expect(s.ends('20')).toEqual([1, 1, 11, 1]);
    expect(s.ends('23')).toEqual([1, 1, 1, 11]);
  });

  it('drags the objects it moves and stretches with the cursor', async () => {
    const s = withCanvas();
    await s.bus.script(['STRETCH', 'C', '-1,-1', '1,11', '', '0,0']);
    expect(s.bus.prompt).toMatchObject({
      drag: {
        kind: 'stretch',
        ids: [s.id('23')],
        shape: [s.id('20')],
        window: { minX: -1, minY: -1, maxX: 1, maxY: 11 },
        from: { x: 0, y: 0 },
      },
    });
  });

  it('takes the window of a pre-selection', async () => {
    const s = withCanvas();
    await s.bus.pick({ x: 12, y: 1 });
    await s.bus.pick({ x: 8, y: -1 });
    await s.bus.script(['STRETCH', '0,0', '2,0']);
    expect(s.ends('20')).toEqual([0, 0, 12, 0]);
  });
});

describe('dragging', () => {
  it('drags the selection at each command’s point, angle and scale prompts', async () => {
    const s = withCanvas();
    const all = [s.id('20'), s.id('21'), s.id('23')];
    await s.bus.script(['MOVE', 'ALL', '', '1,2']);
    expect(s.bus.prompt?.drag).toEqual({ kind: 'move', ids: all, from: { x: 1, y: 2 } });
    await s.bus.cancel();
    await s.bus.script(['COPY', 'ALL', '', '1,2']);
    expect(s.bus.prompt?.drag).toEqual({ kind: 'move', ids: all, from: { x: 1, y: 2 } });
    await s.bus.cancel();
    await s.bus.script(['ROTATE', 'ALL', '', '1,2']);
    expect(s.bus.prompt?.drag).toEqual({
      kind: 'rotate',
      ids: all,
      base: { x: 1, y: 2 },
      reference: 0,
    });
    await s.bus.script(['R', '90']);
    expect(s.bus.prompt?.drag).toMatchObject({ kind: 'rotate', base: { x: 1, y: 2 } });
    expect(r6((s.bus.prompt?.drag as { reference: number }).reference)).toBe(r6(Math.PI / 2));
    await s.bus.cancel();
    await s.bus.script(['SCALE', 'ALL', '', '1,2']);
    expect(s.bus.prompt?.drag).toEqual({
      kind: 'scale',
      ids: all,
      base: { x: 1, y: 2 },
      reference: 1,
    });
    await s.bus.script(['R', '4']);
    expect(s.bus.prompt?.drag).toMatchObject({ kind: 'scale', reference: 4 });
    await s.bus.cancel();
    await s.bus.script(['MIRROR', 'ALL', '', '1,2']);
    expect(s.bus.prompt?.drag).toEqual({ kind: 'mirror', ids: all, from: { x: 1, y: 2 } });
  });
});

describe('dragMotion', () => {
  const at = (m: DragMotion | undefined, x: number, y: number) => {
    const p = applyPoint(m!.m, { x, y });
    return [r6(p.x), r6(p.y)];
  };
  it('is the motion the answer makes', () => {
    const ids = [1];
    expect(
      at(dragMotion({ kind: 'move', ids, from: { x: 1, y: 1 } }, { x: 4, y: 5 }), 0, 0),
    ).toEqual([3, 4]);
    const turn = dragMotion(
      { kind: 'rotate', ids, base: { x: 1, y: 0 }, reference: 0 },
      { x: 1, y: 3 },
    );
    expect(at(turn, 2, 0)).toEqual([1, 1]);
    const ref = dragMotion(
      { kind: 'rotate', ids, base: { x: 0, y: 0 }, reference: Math.PI / 2 },
      { x: 0, y: 1 },
    );
    expect(at(ref, 2, 0)).toEqual([2, 0]);
    const k = dragMotion(
      { kind: 'scale', ids, base: { x: 0, y: 0 }, reference: 2 },
      { x: 0, y: 6 },
    );
    expect(at(k, 1, 1)).toEqual([3, 3]);
    const mirror = dragMotion({ kind: 'mirror', ids, from: { x: 0, y: 0 } }, { x: 0, y: 1 });
    expect(at(mirror, 2, 3)).toEqual([-2, 3]);
    const stretch = dragMotion(
      {
        kind: 'stretch',
        ids,
        shape: [2],
        window: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        from: { x: 0, y: 0 },
      },
      { x: 2, y: 0 },
    );
    expect(stretch?.stretch).toEqual({
      ids: [2],
      window: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      d: { x: 2, y: 0 },
    });
  });

  it('moves a grip by the cursor less its base point', () => {
    const m = dragMotion(
      { kind: 'grip', ids: [1], grip: { x: 10, y: 0 }, from: { x: 0, y: 0 } },
      { x: 1, y: 2 },
    );
    expect(m?.grip).toEqual({ ids: [1], from: { x: 10, y: 0 }, to: { x: 11, y: 2 } });
  });

  it('makes none where the cursor gives no motion', () => {
    const ids = [1];
    const o = { x: 0, y: 0 };
    expect(dragMotion({ kind: 'rotate', ids, base: o, reference: 0 }, o)).toBeUndefined();
    expect(dragMotion({ kind: 'scale', ids, base: o, reference: 1 }, o)).toBeUndefined();
    expect(dragMotion({ kind: 'mirror', ids, from: o }, o)).toBeUndefined();
  });
});
