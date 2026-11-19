// M5-04 part 12: -XREF Attach and Overlay on the PromptBus, AutoCAD 2024's command-line forms
// (AutoCAD Help, "-XREF (Command)"): "Enter an option [?/Bind/Detach/Unload/Reload/Overlay/Attach]
// <Attach>"; Attach and Overlay ask "Enter name of file to attach" (to overlay), as AutoCAD asks
// with FILEDIA 0, the app finding the file by name among the drawings it holds (`xrefFile`);
// `~` opens the Attach External Reference dialog (XATTACH's) instead. The xref is made, loaded
// and placed as XATTACH's is (xref-attach.test.ts): one -XREF undo step with its load.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  XREF_FLAG,
  XREF_OVERLAY_FLAG,
  builtinCommands,
  xrefLoadChange,
  type BusEvent,
  type DialogRequest,
  type InsertGeometry,
  type PromptAnswer,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, sampleInit } from '../model/fixtures';

/** What the app holds, by file name: its INSUNITS. */
const HELD: Readonly<Record<string, number>> = { 'plan.dxf': 4, 'Site Plan.dwg': 6 };

/**
 * The host drawing (millimetres) and a bus whose app finds the files of `HELD` by name (folders,
 * case and the extension aside) and loads `sampleInit()` as each one's drawing.
 */
function drawing(o: { unreadable?: boolean } = {}) {
  const model = DocumentModel.create(sampleInit());
  const b = new ChangeSetBuilder(model);
  b.setHeader('$INSUNITS', 4);
  model.apply(b.build());
  const requests: ViewRequest[] = [];
  const log: string[] = [];
  const bus: PromptBus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        requests.push(r);
        if (r.op === 'xrefFile') {
          if (o.unreadable) return Promise.resolve({ ok: false, message: 'plan.dxf is broken' });
          const key = r.file.split(/[\\/]/).pop()!.toUpperCase();
          const name = Object.keys(HELD).find(
            (n) => n.toUpperCase() === key || n.toUpperCase().replace(/\.[^.]*$/, '') === key,
          );
          return Promise.resolve(
            name ? { ok: true, xrefFile: { fileName: name, units: HELD[name]! } } : { ok: true },
          );
        }
        if (r.op !== 'xref' || r.action !== 'attach')
          return Promise.resolve({ ok: false, message: 'no' });
        for (const block of r.blocks) {
          const change = xrefLoadChange(model, block, sampleInit());
          model.apply(change);
          bus.joinLoad(change);
        }
        const names = r.blocks.map((h) => model.tables.blockRecords.get(h)!.name);
        return Promise.resolve({ ok: true, messages: names.map((n) => `"${n}" loaded.`) });
      },
    },
  });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const xrefs = () =>
    [...model.tables.blockRecords.values()].filter((r) => model.blocks.get(r.handle)?.xrefPath);
  const inserts = () =>
    model
      .blockEntities(MODEL_SPACE)
      .map((id) => model.entity(id)!.geom)
      .filter((g): g is InsertGeometry => g.kind === 'INSERT');
  return { model, bus, log, requests, xrefs, inserts };
}

describe('-XREF Attach and Overlay (M5-04 part 12)', () => {
  it('offers Overlay and Attach, Attach by default', async () => {
    const t = drawing();
    await t.bus.script(['-XREF']);
    expect(t.bus.promptText).toBe(
      'Enter an option [?/Bind/Detach/Path/pathType/Unload/Reload/Overlay/Attach] <Attach>:',
    );
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Enter name of file to attach:');
    await t.bus.cancel();
    await t.bus.script(['-XREF', 'O']);
    expect(t.bus.promptText).toBe('Enter name of file to overlay:');
  });

  it('attaches the file named, loads it and asks the insertion point, scale and rotation', async () => {
    const t = drawing();
    await t.bus.script(['-XREF', 'A', 'plan']);
    expect(t.requests).toContainEqual({ op: 'xrefFile', file: 'plan' });
    const [r] = t.xrefs();
    expect(r).toMatchObject({ name: 'plan', flags: XREF_FLAG, units: 4 });
    expect(t.model.blocks.get(r!.handle)?.xrefPath).toBe('plan.dxf');
    expect(t.model.blocks.get(r!.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
    expect(t.log).toEqual(
      expect.arrayContaining(['Attach Xref "plan": plan.dxf', '"plan" loaded.']),
    );
    expect(t.bus.prompt).toMatchObject({
      message: 'Specify insertion point or',
      options: ['Scale', 'X', 'Y', 'Z', 'Rotate'],
    });
    await t.bus.script(['10,20', '2', '', '0']);
    expect(t.inserts()).toEqual([
      expect.objectContaining({
        block: r!.handle,
        position: { x: 10, y: 20 },
        scale: { x: 2, y: 2, z: 2 },
      }),
    ]);
    expect(t.bus.command).toBeUndefined();
    // One undo step with the load.
    expect(t.bus.undo.state.nextUndo).toBe('XREF');
    await t.bus.script(['U']);
    expect(t.xrefs()).toEqual([]);
    expect(t.inserts()).toEqual([]);
  });

  it('overlays: DXF 70 bits 4 and 8; a name with spaces, a path and quotes', async () => {
    const t = drawing();
    await t.bus.script(['-XREF', 'Overlay', '"C:\\work\\site plan.dwg"']);
    const [r] = t.xrefs();
    expect(r).toMatchObject({ name: 'Site Plan', flags: XREF_FLAG | XREF_OVERLAY_FLAG, units: 6 });
    expect(t.log).toContain('Overlay Xref "Site Plan": Site Plan.dwg');
    // A drawing in metres overlaid on one in millimetres.
    await t.bus.script(['0,0', '', '', '']);
    expect(t.inserts()[0]?.scale).toEqual({ x: 1000, y: 1000, z: 1000 });
  });

  it('offers the file it last attached as the default', async () => {
    const t = drawing();
    await t.bus.script(['-XREF', 'A', 'plan.dxf', '0,0', '', '', '']);
    await t.bus.script(['-XREF', 'O']);
    expect(t.bus.promptText).toBe('Enter name of file to overlay <plan.dxf>:');
    await t.bus.script(['', '5,5', '', '', '']);
    // The drawing's xref of the file, whatever the option: AutoCAD keeps the type it has.
    expect(t.xrefs()).toHaveLength(1);
    expect(t.xrefs()[0]?.flags).toBe(XREF_FLAG);
    expect(t.inserts()).toHaveLength(2);
  });

  it('says when the file is not found or cannot be read, attaching nothing', async () => {
    const t = drawing();
    await t.bus.script(['-XREF', 'A', 'elevation']);
    expect(t.log).toContain('File "elevation" not found.');
    expect(t.bus.command).toBeUndefined();
    expect(t.xrefs()).toEqual([]);
    const u = drawing({ unreadable: true });
    await u.bus.script(['-XREF', 'A', 'plan']);
    expect(u.log).toContain('plan.dxf is broken');
    expect(u.xrefs()).toEqual([]);
    expect(u.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('ends at an empty name with no default, attaching nothing', async () => {
    const t = drawing();
    await t.bus.script(['-XREF', 'A', '']);
    expect(t.bus.command).toBeUndefined();
    expect(t.requests.filter((r) => r.op === 'xrefFile')).toEqual([]);
  });

  it('opens the Attach External Reference dialog at ~, Overlay chosen for Overlay', async () => {
    const t = drawing();
    await t.bus.script(['-XREF', 'O', '~']);
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.dialog).toMatchObject({ type: 'xrefattach', settings: { overlay: true } });
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      xrefAttach: {
        file: { fileName: 'plan.dxf', units: 4 },
        settings: {
          ...(p!.dialog as Extract<DialogRequest, { type: 'xrefattach' }>).settings,
          pointOnScreen: false,
          point: { x: 3, y: 4 },
        },
      },
    } as PromptAnswer);
    expect(t.xrefs()[0]?.flags).toBe(XREF_FLAG | XREF_OVERLAY_FLAG);
    expect(t.inserts()[0]?.position).toEqual({ x: 3, y: 4 });
    expect(t.bus.command).toBeUndefined();
    // Attach's dialog opens on Attachment.
    await t.bus.script(['-XREF', 'A', '~']);
    const q = t.bus.prompt as { dialog?: DialogRequest };
    expect(q.dialog).toMatchObject({ type: 'xrefattach', settings: { overlay: false } });
  });
});
