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
  UNDO_COMMANDS,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type HeaderValue,
} from '../../src/index';
import { MODEL_SPACE, entityInit, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

function setup(init: DocumentInit = sampleInit()) {
  const model = DocumentModel.create(init);
  const registry = builtinCommands();
  for (const def of UNDO_COMMANDS) registry.register(def);
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
    ]) {
      expect(r.resolve(alias!)?.def.name).toBe(name);
    }
  });
});
