// M5-02 part 6: REFEDIT of an external reference, as AutoCAD 2024's (AutoCAD Help, "REFEDIT
// (Command)", "REFCLOSE (Command)", "About Editing Referenced Drawings in Place"):
//   - an attached or overlaid xref is edited in place like a block reference: its objects are
//     carried out of its block where the reference draws them;
//   - REFCLOSE Save carries them back and writes the edits to the xref's own file: the app reads
//     the file (`xrefDrawing`) and writes the engine's change to it (`writeXref`), objects the
//     xref had keeping their handles there, new ones getting the file's next handles and the
//     records they use copied in by name;
//   - the host keeps none of it: the objects stay the xref's loaded content, which no save of the
//     host writes.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  applyToReplica,
  builtinCommands,
  withoutXrefContent,
  xrefLoadChange,
  type BusEvent,
  type ChangeSet,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type NestedPick,
  type Vec2,
  type ViewHost,
  type ViewRequest,
} from '../../src/index';
import {
  blockRecord,
  circleGeom,
  entityInit,
  layer,
  lineGeom,
  linetype,
  sampleInit,
} from '../model/fixtures';
import { host } from './edit-harness';

const XREF = '30';
const REF = '31';
const NOTES = '25';
const REF_AT = { x: 100, y: 0 };

const insert = (block: string, at: Vec2): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: at,
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

/** The sample drawing with layer NOTES current and an attached xref PLAN, referenced at 100,0. */
function hostInit(loaded = true): DocumentInit {
  const s = sampleInit();
  return {
    ...s,
    header: new Map([...(s.header ?? []), ['$CLAYER', 'NOTES']]),
    tables: {
      ...s.tables,
      layers: [...(s.tables?.layers ?? []), layer(NOTES, 'NOTES')],
      blockRecords: [...(s.tables?.blockRecords ?? []), { ...blockRecord(XREF, 'PLAN'), flags: 4 }],
    },
    blocks: [
      ...(s.blocks ?? []),
      {
        handle: XREF,
        name: 'PLAN',
        basePoint: { x: 0, y: 0 },
        xrefPath: loaded ? '.\\plan.dxf' : 'gone.dxf',
      },
    ],
    entities: [...(s.entities ?? []), entityInit(REF, insert(XREF, REF_AT))],
  };
}

/**
 * The xref's drawing: layers 0 and A-WALL; model space holds line 20 (0,0)-(10,0) and line 22
 * (0,10)-(10,10) on A-WALL and circle 21 at (5,5) r 1 on 0.
 */
function planInit(door = false): DocumentInit {
  const plan: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '60',
    tables: {
      layers: [layer('10', '0'), layer('11', 'A-WALL')],
      linetypes: [linetype('14', 'Continuous')],
      blockRecords: [blockRecord('1F', '*Model_Space'), blockRecord('1B', '*Paper_Space')],
    },
    blocks: [
      { handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: '1B', name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22A', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    objects: [{ handle: 'C', type: 'DICTIONARY', owner: '0' }],
    entities: [
      entityInit('20', lineGeom(0, 0, 10, 0), { layer: '11', owner: '1F' }),
      entityInit('21', circleGeom(5, 5, 1), { layer: '10', owner: '1F' }),
      entityInit('22', lineGeom(0, 10, 10, 10), { layer: '11', owner: '1F' }),
    ],
  };
  return door ? withDoor(plan) : plan;
}

const DOOR = '40';
const DOOR_REF = '43';

/**
 * The xref's drawing with a block DOOR: line 41 (0,0)-(2,0) on A-WALL and circle 42 at (1,1)
 * r 0.5 on 0, referenced by 43 at (20,0) in model space (where the host draws it at 120,0).
 */
function withDoor(plan: DocumentInit): DocumentInit {
  return {
    ...plan,
    tables: {
      ...plan.tables,
      blockRecords: [...(plan.tables?.blockRecords ?? []), blockRecord(DOOR, 'DOOR')],
    },
    blocks: [...(plan.blocks ?? []), { handle: DOOR, name: 'DOOR', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...(plan.entities ?? []),
      entityInit('41', lineGeom(0, 0, 2, 0), { layer: '11', owner: DOOR }),
      entityInit('42', circleGeom(1, 1, 0.5), { layer: '10', owner: DOOR }),
      entityInit(DOOR_REF, insert(DOOR, { x: 20, y: 0 }), { layer: '10', owner: '1F' }),
    ],
  };
}

/** A drawing's content as a DocumentInit again: the file as the app would read it back. */
function initOf(m: DocumentModel): DocumentInit {
  const entities = [...m.blocks.keys()].flatMap((b) =>
    m.blockEntities(b).map((id) => {
      const { id: _id, ...e } = m.entity(id)!;
      return e;
    }),
  );
  return {
    meta: m.meta,
    handSeed: m.handSeed,
    header: m.header,
    tables: Object.fromEntries(
      Object.entries(m.tables).map(([k, t]) => [k, [...t.values()]]),
    ) as NonNullable<DocumentInit['tables']>,
    blocks: [...m.blocks.values()],
    layouts: [...m.layouts],
    objects: [...m.objects.values()],
    entities,
  };
}

function setup(
  o: {
    loaded?: boolean;
    file?: boolean | 'unreadable';
    write?: 'download' | 'fail';
    door?: boolean;
  } = {},
) {
  const loaded = o.loaded ?? true;
  const door = o.door ?? false;
  const model = DocumentModel.create(hostInit(loaded));
  if (loaded) model.apply(xrefLoadChange(model, XREF, planInit(door)));
  const base = host(() => model);
  const id = (h: string) => model.ids.idOf(h)!;
  /** The xref's file as it stands: what each write left. */
  let file = planInit(door);
  const writes: { block: string; file: string; changes: readonly ChangeSet[] }[] = [];
  /** At "Select reference": a pick on the xref's content picks the reference. */
  let selectingReference = false;
  const view: ViewHost = {
    request: (r: ViewRequest) => {
      if (r.op === 'pick' && selectingReference)
        return Promise.resolve({ ok: true, ids: [id(REF)] });
      if (r.op === 'nested') {
        // With DOOR, a pick goes through the xref's reference to it (the host's handle of 43).
        const inner = door ? xrefHandleOf(model, DOOR_REF) : undefined;
        const nested: NestedPick = { path: inner ? [id(REF), model.ids.idOf(inner)!] : [id(REF)] };
        return Promise.resolve({ ok: true, nested });
      }
      if (r.op === 'xrefDrawing') {
        if (o.file === false) return Promise.resolve({ ok: true });
        if (o.file === 'unreadable')
          return Promise.resolve({ ok: false, message: 'plan.dxf could not be read: damaged' });
        return Promise.resolve({ ok: true, xrefDrawing: { name: 'plan.dxf', init: file } });
      }
      if (r.op === 'writeXref') {
        if (o.write === 'fail')
          return Promise.resolve({ ok: false, message: 'plan.dxf was not written: disk full' });
        writes.push({ block: r.block, file: r.file, changes: r.changes });
        const m = DocumentModel.create(file);
        for (const cs of r.changes) applyToReplica(m, cs, 'xref file');
        file = initOf(m);
        const downloaded = o.write === 'download';
        return Promise.resolve({ ok: true, written: { file: 'plan.dxf', downloaded } });
      }
      return base.request(r);
    },
  };
  const bus = new PromptBus({ model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  /** The host's objects of the xref's block, in its order. */
  const content = () => model.blockEntities(XREF).map((i) => model.entity(i)!);
  const name = async () => {
    await bus.script(['SETVAR', 'REFEDITNAME']);
    return log.at(-1)!;
  };
  const pickReference = async () => {
    selectingReference = true;
    await bus.pick({ x: 105, y: 0 });
    selectingReference = false;
  };
  /** -REFEDIT on the reference, every object of the xref in the working set. */
  const refedit = async () => {
    await bus.script(['-REFEDIT']);
    await pickReference();
    await bus.script(['', '']);
  };
  /** The xref's file as the last write left it. */
  const saved = () => DocumentModel.create(file);
  return { model, bus, log, writes, content, name, refedit, pickReference, saved };
}

/** The host's handle of the xref file's object `h`. */
function xrefHandleOf(model: DocumentModel, h: string): string | undefined {
  return model.blocks.get(XREF)!.xrefHandles?.find(([, x]) => x === h)?.[0];
}

const geomOf = (m: DocumentModel, h: string) => m.entity(m.ids.idOf(h)!)?.geom;
const lineOf = (g: EntityGeometry | undefined) => g as Extract<EntityGeometry, { kind: 'LINE' }>;
const layerName = (m: DocumentModel, e: Entity) => m.tables.layers.get(e.layer)?.name;

describe('REFEDIT of an external reference (M5-02 part 6)', () => {
  it("edits the xref in place and REFCLOSE Save writes the edits to the xref's file", async () => {
    const t = setup();
    await t.refedit();
    expect(t.log).toContain('3 objects in the working set.');
    expect(await t.name()).toMatch(/REFEDITNAME = "PLAN"/);
    // Line 20 is carried out where the reference draws it, and moved up 5.
    await t.bus.script(['MOVE', '105,0', '', '0,0', '0,5']);
    // Circle 21 erased; a new line drawn on the current layer NOTES, the drawing's own.
    await t.bus.script(['ERASE', '105,6', '']);
    await t.bus.script(['LINE', '100,20', '110,20', '']);
    await t.bus.script(['REFCLOSE', '']);
    expect(t.log.at(-1)).toBe('Xref "PLAN" saved: reference edits written to plan.dxf.');
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);

    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toMatchObject({ block: XREF, file: '.\\plan.dxf' });
    const cs = t.writes[0]!.changes;
    // Only what was edited is in the change: line 22 is not.
    const touched = cs.flatMap((c) => [
      ...(c.entities?.updated ?? []).map((u) => u.after.handle),
      ...(c.entities?.removed ?? []).map((r) => r.entity.handle),
    ]);
    expect(touched.sort()).toEqual(['20', '21']);

    const x = t.saved();
    // Line 20 keeps its handle and layer, moved in the xref's own coordinates.
    const moved = lineOf(geomOf(x, '20'));
    expect(moved.start).toMatchObject({ x: 0, y: 5 });
    expect(moved.end).toMatchObject({ x: 10, y: 5 });
    expect(x.entity(x.ids.idOf('20')!)!.layer).toBe('11');
    expect(geomOf(x, '21')).toBeUndefined();
    expect(lineOf(geomOf(x, '22')).start).toMatchObject({ x: 0, y: 10 });
    // The new line: a handle above the file's $HANDSEED, on a copy of NOTES.
    const ms = x.blockEntities('1F').map((i) => x.entity(i)!);
    expect(ms.map((e) => e.handle).slice(0, 2)).toEqual(['20', '22']);
    const drawn = ms[2]!;
    expect(parseInt(drawn.handle, 16)).toBeGreaterThanOrEqual(0x60);
    expect(lineOf(drawn.geom).start).toMatchObject({ x: 0, y: 20 });
    expect(lineOf(drawn.geom).end).toMatchObject({ x: 10, y: 20 });
    expect(layerName(x, drawn)).toBe('NOTES');
    expect(x.tables.layers.get(drawn.layer)!.flags ?? 0).toBe(0);
    expect(parseInt(x.handSeed, 16)).toBeGreaterThan(parseInt(drawn.handle, 16));

    // The host shows the edits as the xref's content, and saves none of it.
    expect(t.content()).toHaveLength(3);
    const def = t.model.blocks.get(XREF)!;
    for (const e of t.content()) expect(def.xrefLoaded).toContain(e.handle);
    const kept = withoutXrefContent(t.model);
    expect(kept.blockEntities(XREF)).toEqual([]);
    expect([...kept.entities()].map((e) => e.handle).sort()).toEqual(
      ['20', '21', '23', '24', REF].sort(),
    );
  });

  it('a write after U and Save again updates what the first wrote, adding nothing twice', async () => {
    const t = setup();
    await t.refedit();
    await t.bus.script(['LINE', '100,20', '110,20', '']);
    await t.bus.script(['REFCLOSE', 'S']);
    const first = t.saved().blockEntities('1F').length;
    await t.bus.script(['U']);
    expect(await t.name()).toMatch(/REFEDITNAME = "PLAN"/);
    await t.bus.script(['MOVE', '105,20', '', '0,0', '0,1']);
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.writes).toHaveLength(2);
    const second = t.writes[1]!.changes;
    expect(second.flatMap((c) => c.entities?.added ?? [])).toEqual([]);
    const x = t.saved();
    expect(x.blockEntities('1F')).toHaveLength(first);
    const drawn = x.entity(x.blockEntities('1F').at(-1)!)!;
    expect(lineOf(drawn.geom).start).toMatchObject({ x: 0, y: 21 });
  });

  it("an edit that changed nothing writes nothing to the xref's file", async () => {
    const t = setup();
    await t.refedit();
    await t.bus.script(['REFCLOSE', 'S']);
    expect(t.writes).toEqual([]);
    expect(t.log.at(-1)).toBe('Xref "PLAN": no reference edits to save.');
  });

  it("keeps the edit open when the xref's file is not at hand", async () => {
    const t = setup({ file: false });
    await t.refedit();
    await t.bus.script(['ERASE', '106,5', '', 'REFCLOSE', 'S']);
    expect(t.log.at(-1)).toBe(
      '** The file of xref "PLAN" (.\\plan.dxf) is not at hand: drop it on the window, then REFCLOSE again **',
    );
    expect(await t.name()).toMatch(/REFEDITNAME = "PLAN"/);
    expect(t.writes).toEqual([]);
    // Discard still ends it, taking the erase back.
    await t.bus.script(['REFCLOSE', 'D']);
    expect(t.content()).toHaveLength(3);
  });

  it("REFSET Remove leaves the xref's own objects in the working set", async () => {
    const t = setup();
    await t.refedit();
    await t.bus.script(['REFSET', 'R', '105,0', '']);
    expect(t.log.slice(-2)).toEqual([
      '1 belongs to xref "PLAN" and stays in the working set.',
      '0 Removed from working set',
    ]);
  });

  it('refuses an xref whose file is not loaded', async () => {
    const t = setup({ loaded: false });
    await t.bus.script(['-REFEDIT']);
    await t.pickReference();
    expect(t.log.at(-1)).toBe('** The external reference is not loaded **');
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);
  });

  it('says where the file went when it was downloaded, and why when it was not written', async () => {
    const d = setup({ write: 'download' });
    await d.refedit();
    await d.bus.script(['ERASE', '105,6', '', 'REFCLOSE', 'S']);
    expect(d.log.slice(-2)).toEqual([
      'Xref "PLAN" saved: reference edits written to plan.dxf.',
      "plan.dxf was downloaded: put it in place of the xref's file to keep the edits.",
    ]);
    const f = setup({ write: 'fail' });
    await f.refedit();
    await f.bus.script(['LINE', '100,20', '110,20', '', 'REFCLOSE', 'S']);
    expect(f.log.at(-1)).toBe('** plan.dxf was not written: disk full **');
    // The line is the xref's content all the same: the host never saves it.
    const drawn = f.content().at(-1)!;
    expect(f.model.blocks.get(XREF)!.xrefLoaded).toContain(drawn.handle);
    expect(f.model.blocks.get(XREF)!.xrefHandles?.some(([h]) => h === drawn.handle)).toBe(false);
    const u = setup({ file: 'unreadable' });
    await u.refedit();
    await u.bus.script(['REFCLOSE', 'S']);
    expect(u.log.at(-1)).toBe('** plan.dxf could not be read: damaged **');
    expect(await u.name()).toMatch(/REFEDITNAME = "PLAN"/);
  });
});

// M5-02 part 7: a block the xref brought in (`PLAN|DOOR`, the file's DOOR) is edited in place
// through the xref's reference, and REFCLOSE Save writes the edits to that block in the xref's
// file (AutoCAD 2024 Help, "About Editing Referenced Drawings in Place": "you can edit blocks
// nested in an xref"; the changes are saved back to the referenced drawing).
describe('REFEDIT of a block an xref brought in (M5-02 part 7)', () => {
  /** -REFEDIT on DOOR through the xref's reference: Next to DOOR, Ok, every object. */
  const refeditDoor = async (t: ReturnType<typeof setup>) => {
    await t.bus.script(['-REFEDIT']);
    await t.pickReference();
    await t.bus.script(['N', 'O', '', '']);
  };

  it("edits PLAN|DOOR in place and REFCLOSE Save writes DOOR in the xref's file", async () => {
    const t = setup({ door: true });
    const door = [...t.model.tables.blockRecords.values()].find((r) => r.name === 'PLAN|DOOR')!;
    await refeditDoor(t);
    expect(t.log).toContain('2 objects in the working set.');
    expect(await t.name()).toMatch(/REFEDITNAME = "PLAN\|DOOR"/);
    // Line 41 is where the host draws it, (120,0)-(122,0): moved up 3.
    await t.bus.script(['MOVE', '121,0', '', '0,0', '0,3']);
    await t.bus.script(['LINE', '120,5', '122,5', '']);
    await t.bus.script(['REFCLOSE', '']);
    expect(t.log.at(-1)).toBe(
      'Xref "PLAN" saved: reference edits to "PLAN|DOOR" written to plan.dxf.',
    );
    expect(await t.name()).toMatch(/REFEDITNAME = ""/);

    // The xref's file is written, and only DOOR's objects in it changed.
    expect(t.writes).toHaveLength(1);
    expect(t.writes[0]).toMatchObject({ block: XREF, file: '.\\plan.dxf' });
    const cs = t.writes[0]!.changes;
    expect(cs.flatMap((c) => (c.entities?.updated ?? []).map((u) => u.after.handle))).toEqual([
      '41',
    ]);
    expect(cs.flatMap((c) => c.entities?.removed ?? [])).toEqual([]);

    const x = t.saved();
    const moved = lineOf(geomOf(x, '41'));
    expect(moved.start).toMatchObject({ x: 0, y: 3 });
    expect(moved.end).toMatchObject({ x: 2, y: 3 });
    const inDoor = x.blockEntities(DOOR).map((i) => x.entity(i)!);
    expect(inDoor.map((e) => e.handle).slice(0, 2)).toEqual(['41', '42']);
    expect(inDoor).toHaveLength(3);
    const drawn = inDoor[2]!;
    expect(parseInt(drawn.handle, 16)).toBeGreaterThanOrEqual(0x60);
    expect(drawn.owner).toBe(DOOR);
    expect(lineOf(drawn.geom).start).toMatchObject({ x: 0, y: 5 });
    expect(lineOf(drawn.geom).end).toMatchObject({ x: 2, y: 5 });
    expect(layerName(x, drawn)).toBe('NOTES');
    // Model space is as the file had it.
    expect(x.blockEntities('1F').map((i) => x.entity(i)!.handle)).toEqual([
      '20',
      '21',
      '22',
      DOOR_REF,
    ]);

    // The host shows the edits in PLAN|DOOR as the xref's content, and saves none of it.
    const def = t.model.blocks.get(XREF)!;
    const now = t.model.blockEntities(door.handle).map((i) => t.model.entity(i)!);
    expect(now).toHaveLength(3);
    for (const e of now) expect(def.xrefLoaded).toContain(e.handle);
    expect(def.xrefHandles).toContainEqual([now[2]!.handle, drawn.handle]);
    const kept = withoutXrefContent(t.model);
    expect(kept.blocks.has(door.handle)).toBe(false);
    expect([...kept.entities()].map((e) => e.handle).sort()).toEqual(
      ['20', '21', '23', '24', REF].sort(),
    );
  });

  it('erasing an object of the block takes it out of the block in the file', async () => {
    const t = setup({ door: true });
    await refeditDoor(t);
    await t.bus.script(['ERASE', '121.5,1', '', 'REFCLOSE', 'S']);
    const x = t.saved();
    expect(x.blockEntities(DOOR).map((i) => x.entity(i)!.handle)).toEqual(['41']);
    expect(x.blockEntities('1F')).toHaveLength(4);
  });

  it("REFSET Remove leaves the block's own objects in the working set", async () => {
    const t = setup({ door: true });
    await refeditDoor(t);
    await t.bus.script(['REFSET', 'R', '121,0', '']);
    expect(t.log.slice(-2)).toEqual([
      '1 belongs to xref "PLAN" and stays in the working set.',
      '0 Removed from working set',
    ]);
  });

  it("keeps the edit open when the xref's file is not at hand", async () => {
    const t = setup({ door: true, file: false });
    await refeditDoor(t);
    await t.bus.script(['ERASE', '121,0', '', 'REFCLOSE', 'S']);
    expect(t.log.at(-1)).toBe(
      '** The file of xref "PLAN" (.\\plan.dxf) is not at hand: drop it on the window, then REFCLOSE again **',
    );
    expect(await t.name()).toMatch(/REFEDITNAME = "PLAN\|DOOR"/);
  });
});

describe('REFEDIT of an xref-dependent block no xref has loaded (M5-02 part 7)', () => {
  it('is refused', async () => {
    const s = sampleInit();
    const model = DocumentModel.create({
      ...s,
      tables: {
        ...s.tables,
        blockRecords: [
          ...(s.tables?.blockRecords ?? []),
          { ...blockRecord('50', 'GONE|DOOR'), flags: 48 },
        ],
      },
      blocks: [...(s.blocks ?? []), { handle: '50', name: 'GONE|DOOR', basePoint: { x: 0, y: 0 } }],
      entities: [
        ...(s.entities ?? []),
        entityInit('51', lineGeom(0, 0, 2, 0), { owner: '50' }),
        entityInit('52', insert('50', { x: 200, y: 0 })),
      ],
    });
    const bus = new PromptBus({ model, registry: builtinCommands(), view: host(() => model) });
    const log: string[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['-REFEDIT']);
    await bus.answer({ kind: 'selection', ids: [model.ids.idOf('52')!] });
    expect(log.at(-1)).toBe('** The external reference that brought the block in is not loaded **');
  });
});
