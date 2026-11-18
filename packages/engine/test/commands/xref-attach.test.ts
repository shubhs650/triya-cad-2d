// M5-04 part 6: XATTACH on the PromptBus, as AutoCAD 2024's (AutoCAD Help, "XATTACH (Command)",
// "Attach External Reference Dialog Box"):
//   - the Attach External Reference dialog lists the drawing's xrefs and opens with Attachment,
//     Insertion point Specify On-screen, Scale 1 and Rotation 0, then on what it last closed with;
//   - OK makes the xref (DXF 70 bit 4, overlay 4 + 8; named after the file; its units the file's
//     INSUNITS; its path the file's name), says "Attach Xref "name": path", has the app load the
//     file, then places a reference as -INSERT does (no Basepoint), scaled by the units;
//   - the load joins the command's undo step (`joinLoad`), so U takes it all back and redo
//     brings it back loaded;
//   - a file the drawing has an xref of is referenced through that xref.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  XREF_FLAG,
  XREF_OVERLAY_FLAG,
  builtinCommands,
  xrefLoadChange,
  xrefNameFor,
  type BusEvent,
  type DialogRequest,
  type InsertGeometry,
  type PromptAnswer,
  type ViewReply,
  type ViewRequest,
  type XrefAttachSettings,
} from '../../src/index';
import { MODEL_SPACE, sampleInit } from '../model/fixtures';
import { r6 } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'xrefattach' }>;

/** The host drawing (millimetres) and a bus whose app loads `sampleInit()` as every xref's file. */
function drawing(o: { insUnits?: number; load?: boolean } = {}) {
  const model = DocumentModel.create(sampleInit());
  const b = new ChangeSetBuilder(model);
  b.setHeader('$INSUNITS', o.insUnits ?? 4);
  model.apply(b.build());
  const requests: ViewRequest[] = [];
  const log: string[] = [];
  let joined: boolean[] = [];
  const bus: PromptBus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        requests.push(r);
        if (r.op !== 'xref' || r.action !== 'attach' || o.load === false)
          return Promise.resolve({ ok: false, message: 'no' });
        // The app loads the file into each xref, as the session's `xref-load` edit applies it.
        for (const block of r.blocks) {
          const change = xrefLoadChange(model, block, sampleInit());
          model.apply(change);
          joined = [...joined, bus.joinLoad(change)];
        }
        const names = r.blocks.map((h) => model.tables.blockRecords.get(h)!.name);
        return Promise.resolve({ ok: true, messages: names.map((n) => `"${n}" loaded.`) });
      },
    },
  });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const request = () => {
    const p = bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('xrefattach');
    return p!.dialog as Request;
  };
  /** OK with `file` and the dialog's settings changed by `patch`. */
  const ok = (file: unknown, patch: Partial<XrefAttachSettings> = {}) =>
    bus.answer({
      kind: 'dialog',
      action: 'ok',
      xrefAttach: { file, settings: { ...request().settings, ...patch } },
    } as PromptAnswer);
  const xrefs = () =>
    [...model.tables.blockRecords.values()].filter((r) => model.blocks.get(r.handle)?.xrefPath);
  const inserts = () =>
    model
      .blockEntities(MODEL_SPACE)
      .map((id) => model.entity(id)!.geom)
      .filter((g): g is InsertGeometry => g.kind === 'INSERT');
  return { model, bus, log, requests, request, ok, xrefs, inserts, joined: () => joined };
}

const PLAN = { fileName: 'plan.dxf', units: 4 };
const FIXED = { pointOnScreen: false, scaleOnScreen: false, rotationOnScreen: false };

describe('XATTACH: the Attach External Reference dialog', () => {
  it('opens with Attachment, the point on screen, scale 1 and rotation 0; lists the xrefs', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    expect(t.request()).toEqual({
      type: 'xrefattach',
      settings: {
        overlay: false,
        pointOnScreen: true,
        point: { x: 0, y: 0 },
        scaleOnScreen: false,
        scale: { x: 1, y: 1, z: 1 },
        uniformScale: false,
        rotationOnScreen: false,
        rotation: 0,
      },
      xrefs: [],
      units: 4,
    });
    await t.ok(PLAN, { ...FIXED, point: { x: 5, y: 5 } });
    await t.bus.script(['XA']);
    expect(t.request().xrefs).toEqual([
      { name: 'plan', fileName: 'plan.dxf', units: 4, overlay: false },
    ]);
    // The settings it closed with last.
    expect(t.request().settings).toMatchObject({ pointOnScreen: false, point: { x: 5, y: 5 } });
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
  });

  it('says why OK attaches nothing: no file, a zero scale', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.ok({ fileName: '', units: 4 });
    expect(t.request().note).toBe('Select a drawing file.');
    await t.ok({ fileName: 'a.dxf', units: -1 });
    expect(t.request().note).toBe('Select a drawing file.');
    await t.ok(PLAN, { ...FIXED, scale: { x: 1, y: 0, z: 1 } });
    expect(t.request().note).toBe('Value must be nonzero.');
    // Uniform scale takes X alone.
    await t.ok(PLAN, { ...FIXED, scale: { x: 2, y: 0, z: 0 }, uniformScale: true });
    expect(t.inserts().map((g) => g.scale)).toEqual([{ x: 2, y: 2, z: 2 }]);
    expect(t.xrefs()).toHaveLength(1);
  });

  it('ends at Cancel, or at an answer that is no dialog values, attaching nothing', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', xrefAttach: { file: PLAN } } as never);
    expect(t.bus.command).toBeUndefined();
    expect(t.xrefs()).toEqual([]);
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });
});

describe('XATTACH: the xref and its reference', () => {
  it('attaches the file as an xref the app loads, then places the reference from the dialog', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN, { ...FIXED, point: { x: 10, y: 20 }, scale: { x: 2, y: 3, z: 1 } });
    const [r] = t.xrefs();
    expect(r).toMatchObject({ name: 'plan', flags: XREF_FLAG, units: 4 });
    const def = t.model.blocks.get(r!.handle)!;
    expect(def.xrefPath).toBe('plan.dxf');
    // Loaded: the file's model space is the block's, its layer WALLS is `plan|WALLS`.
    expect(def.xrefLoaded?.length).toBeGreaterThan(0);
    expect(t.model.blockEntities(r!.handle)).toHaveLength(3);
    expect([...t.model.tables.layers.values()].map((l) => l.name)).toContain('plan|WALLS');
    expect(t.requests).toContainEqual({ op: 'xref', action: 'attach', blocks: [r!.handle] });
    expect(t.joined()).toEqual([true]);
    expect(t.log).toEqual(
      expect.arrayContaining(['Attach Xref "plan": plan.dxf', '"plan" loaded.']),
    );
    expect(t.inserts()).toEqual([
      expect.objectContaining({
        block: r!.handle,
        position: { x: 10, y: 20 },
        scale: { x: 2, y: 3, z: 1 },
        rotation: 0,
      }),
    ]);
    expect(t.bus.command).toBeUndefined();
  });

  it('overlays: DXF 70 bits 4 and 8', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN, { ...FIXED, overlay: true });
    expect(t.xrefs()[0]?.flags).toBe(XREF_FLAG | XREF_OVERLAY_FLAG);
    expect(t.log).toContain('Overlay Xref "plan": plan.dxf');
  });

  it('asks what is on screen as -INSERT does, without Basepoint', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN, { pointOnScreen: true, scaleOnScreen: true, rotationOnScreen: true });
    expect(t.bus.prompt).toMatchObject({
      message: 'Specify insertion point or',
      options: ['Scale', 'X', 'Y', 'Z', 'Rotate'],
    });
    await t.bus.script(['30,40', '2', '', '90']);
    const [g] = t.inserts();
    expect(g).toMatchObject({ position: { x: 30, y: 40 }, scale: { x: 2, y: 2, z: 2 } });
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 2));
  });

  it('scales the reference from the file’s units to the drawing’s', async () => {
    const t = drawing({ insUnits: 4 });
    await t.bus.script(['XATTACH']);
    // A drawing in metres attached to one in millimetres.
    await t.ok({ fileName: 'site.dxf', units: 6 }, FIXED);
    expect(t.inserts()[0]?.scale).toEqual({ x: 1000, y: 1000, z: 1000 });
  });

  it('references a file the drawing has an xref of through that xref', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN, FIXED);
    await t.bus.script(['XATTACH']);
    await t.ok({ fileName: 'PLAN.DXF', units: 4 }, { ...FIXED, overlay: true });
    expect(t.xrefs()).toHaveLength(1);
    expect(t.xrefs()[0]?.flags).toBe(XREF_FLAG);
    expect(t.inserts().map((g) => g.block)).toEqual([t.xrefs()[0]!.handle, t.xrefs()[0]!.handle]);
    // The second asks the app for nothing.
    expect(t.requests.filter((r) => r.op === 'xref')).toHaveLength(1);
  });

  it('numbers a name another block has', () => {
    const t = drawing();
    const b = new ChangeSetBuilder(t.model);
    b.addBlock({ name: 'plan', basePoint: { x: 0, y: 0 } });
    t.model.apply(b.build());
    expect(xrefNameFor(t.model, 'plan.dxf')).toBe('plan-1');
    expect(xrefNameFor(t.model, 'C:\\work\\a,b.dwg')).toBe('a_b');
    expect(xrefNameFor(t.model, '.dxf')).toBe('.dxf');
    expect(xrefNameFor(t.model, '*x.dxf')).toBe('_x');
  });

  it('leaves the xref attached and unreferenced at Esc, as AutoCAD lists it Unreferenced', async () => {
    const t = drawing();
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN);
    expect(t.bus.prompt).toMatchObject({ message: 'Specify insertion point or' });
    await t.bus.cancel();
    expect(t.xrefs()).toHaveLength(1);
    expect(t.inserts()).toEqual([]);
  });

  it('keeps the xref waiting for its file when the app cannot load it', async () => {
    const t = drawing({ load: false });
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN, FIXED);
    expect(t.log).toContain('no');
    const [r] = t.xrefs();
    expect(t.model.blocks.get(r!.handle)?.xrefLoaded).toBeUndefined();
    expect(t.inserts()).toHaveLength(1);
  });

  it('is one undo step with its load: U takes it all back, redo brings it back loaded', async () => {
    const t = drawing();
    const layers = t.model.tables.layers.size;
    const entities = [...t.model.entities()].length;
    await t.bus.script(['XATTACH']);
    await t.ok(PLAN, FIXED);
    expect(t.bus.undo.state.nextUndo).toBe('XATTACH');
    const loaded = [...t.model.entities()].length;
    await t.bus.script(['U']);
    expect(t.xrefs()).toEqual([]);
    expect(t.model.tables.layers.size).toBe(layers);
    expect([...t.model.entities()]).toHaveLength(entities);
    await t.bus.script(['REDO']);
    const [r] = t.xrefs();
    expect(t.model.blocks.get(r!.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
    expect([...t.model.entities()]).toHaveLength(loaded);
  });

  it('leaves loads outside XATTACH out of every undo step', () => {
    const t = drawing();
    const b = new ChangeSetBuilder(t.model);
    const block = b.addBlock({ name: 'x', basePoint: { x: 0, y: 0 }, flags: XREF_FLAG }).handle;
    t.model.apply(b.build());
    const change = xrefLoadChange(t.model, block, sampleInit());
    t.model.apply(change);
    expect(t.bus.joinLoad(change)).toBe(false);
  });
});
