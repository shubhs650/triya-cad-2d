// M5-04 part 19: COPYCLIP, CUTCLIP and PASTECLIP of an xref reference, as AutoCAD 2024 pastes
// one (AutoCAD Help, "PASTECLIP (Command)", "About Attaching Drawing References (Xrefs)"):
//   - the Clipboard carries the reference and its xref's record and path, never the content the
//     xref's load brought (that is its file's) nor the `xref|name` records it names;
//   - a paste into the same drawing references the same xref;
//   - a paste into another drawing attaches the xref there (DXF 70 bit 4, an overlay 4 + 8, its
//     path and units the source's), says "Attach Xref "name": path" and has the app load the
//     file, the load joining the paste's undo step; a drawing with an xref of that name, or of
//     that file, references its own;
//   - an xref brought in by another loaded xref (nested) has no reference a drafter can pick:
//     one in a block copied with it stays out of the copy, counted.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  XREF_FLAG,
  XREF_OVERLAY_FLAG,
  attachXref,
  builtinCommands,
  drawingContent,
  xrefLoadChange,
  type BusEvent,
  type Clipboard,
  type DocumentInit,
  type Entity,
  type EntityId,
  type InsertGeometry,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, entityInit, layer, lineGeom, sampleInit } from '../model/fixtures';

// Engine tests have no DOM or Node types: the global every runtime they run in has.
declare function structuredClone<T>(value: T): T;

/** The xref's file: `sampleInit()` with a layer of its own, which the load names `plan|DOORS`. */
function planFile(): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    tables: {
      ...init.tables,
      layers: [...init.tables!.layers!, layer('30', 'DOORS')],
    },
    entities: [...init.entities!, entityInit('31', lineGeom(0, 0, 4, 4), { layer: '30' })],
  };
}

/** Two drawings sharing one Clipboard, whose app loads `planFile()` for every xref of plan.dxf. */
function app() {
  let held: { from: number; content: Clipboard } | undefined;
  /** The drawing files the app has, by name, as `drawingContent` reads them. */
  const sheets = new Map<string, () => Clipboard>();
  const drawing = (n: number, o: { found?: boolean } = {}) => {
    const model = DocumentModel.create(sampleInit());
    const requests: ViewRequest[] = [];
    const log: string[] = [];
    let joined: boolean[] = [];
    const answer = (r: ViewRequest): ViewReply => {
      requests.push(r);
      if (r.op === 'clipboard') {
        if (r.content) {
          held = { from: n, content: structuredClone(r.content) };
          return { ok: true };
        }
        return held
          ? { ok: true, clipboard: structuredClone(held.content), sameDrawing: held.from === n }
          : { ok: true };
      }
      if (r.op === 'xref' && r.action === 'attach') {
        const messages = r.blocks.map((block) => {
          const name = model.tables.blockRecords.get(block)!.name;
          if (o.found === false)
            return `Xref "${name}" not found: drop its file, or the folder that holds it, on the window.`;
          const change = xrefLoadChange(model, block, planFile());
          model.apply(change);
          joined = [...joined, bus.joinLoad(change)];
          return `"${name}" loaded.`;
        });
        return { ok: true, messages };
      }
      if (r.op === 'drawingFile') {
        // -INSERT `name=file`: drawing 1 as the app reads a drawing file for a block.
        const sheet = sheets.get(r.file);
        return sheet ? { ok: true, drawing: { name: r.file, content: sheet() } } : { ok: true };
      }
      return { ok: false, message: 'There is no view to change.' };
    };
    const bus: PromptBus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: (r) => Promise.resolve(answer(r)) },
    });
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    /** Xref `name` of plan.dxf (an overlay with `overlay`), loaded, referenced at `at`. */
    const attach = (at: { x: number; y: number }, overlay = false, fileName = 'plan.dxf') => {
      const b = new ChangeSetBuilder(model);
      const block = attachXref(b, model, { fileName, units: 4 }, overlay);
      model.apply(b.build());
      model.apply(xrefLoadChange(model, block, planFile()));
      const r = new ChangeSetBuilder(model);
      const ref = r.addEntity({
        owner: MODEL_SPACE,
        layer: LAYER_0,
        geom: {
          kind: 'INSERT',
          block,
          position: { ...at, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes: [],
        },
      } as never);
      model.apply(r.build());
      return { block, ref };
    };
    const xrefs = () =>
      [...model.tables.blockRecords.values()].filter((r) => model.blocks.get(r.handle)?.xrefPath);
    const inserts = (): (Entity & { geom: InsertGeometry })[] =>
      model
        .blockEntities(MODEL_SPACE)
        .map((id) => model.entity(id)!)
        .filter((e): e is Entity & { geom: InsertGeometry } => e.geom.kind === 'INSERT');
    /** `command` on the objects `ids` (answered at its "Select objects:"). */
    const run = async (command: string, ids: readonly EntityId[]) => {
      await bus.script([command]);
      await bus.answer({ kind: 'selection', ids });
      expect(bus.command).toBeUndefined();
    };
    const layerNames = () => [...model.tables.layers.values()].map((l) => l.name);
    return {
      model,
      bus,
      log,
      requests,
      attach,
      xrefs,
      inserts,
      layerNames,
      run,
      joined: () => joined,
    };
  };
  return { drawing, held: () => held, sheets };
}

describe('COPYCLIP of an xref reference (M5-04 part 19)', () => {
  it("carries the reference and its xref's record and path, not the loaded content", async () => {
    const a = app();
    const one = a.drawing(1);
    const { block, ref } = one.attach({ x: 50, y: 0 });
    expect(one.layerNames()).toContain('plan|DOORS');
    await one.run('COPYCLIP', [ref.id]);
    expect(one.log.join('\n')).not.toMatch(/cannot be pasted/);
    const clip = a.held()!.content;
    expect(clip.entities.map((e) => e.handle)).toEqual([ref.handle]);
    expect(clip.tables.blockRecords?.map((r) => r.name)).toEqual(['plan']);
    expect(clip.blocks).toEqual([
      expect.objectContaining({ handle: block, name: 'plan', xrefPath: 'plan.dxf' }),
    ]);
    expect(clip.blocks[0]).not.toHaveProperty('xrefLoaded');
    // The xref's content and its `plan|` records are its file's.
    expect(clip.blockEntities).toEqual([]);
    expect((clip.tables.layers ?? []).map((l) => l.name)).not.toContain('plan|DOORS');
  });
});

describe('PASTECLIP of an xref reference (M5-04 part 19)', () => {
  it('references the same xref in the same drawing, loading nothing', async () => {
    const a = app();
    const one = a.drawing(1);
    const { block, ref } = one.attach({ x: 0, y: 0 });
    await one.run('COPYCLIP', [ref.id]);
    await one.bus.script(['PASTECLIP', '100,0']);
    expect(one.bus.command).toBeUndefined();
    expect(one.xrefs()).toHaveLength(1);
    expect(one.inserts().map((e) => [e.geom.block, e.geom.position.x])).toEqual([
      [block, 0],
      [block, 100],
    ]);
    expect(one.requests.some((r) => r.op === 'xref')).toBe(false);
  });

  it('attaches the xref in another drawing and loads it, in the paste’s one undo step', async () => {
    const a = app();
    const one = a.drawing(1);
    const { ref } = one.attach({ x: 0, y: 0 });
    await one.run('COPYCLIP', [ref.id]);

    const two = a.drawing(2);
    await two.bus.script(['PASTECLIP', '20,30']);
    expect(two.bus.command).toBeUndefined();
    const [xref] = two.xrefs();
    expect(xref).toMatchObject({ name: 'plan', flags: XREF_FLAG, units: 4 });
    expect(Number.parseInt(xref!.handle, 16)).toBeGreaterThanOrEqual(0x40);
    expect(two.model.blocks.get(xref!.handle)?.xrefPath).toBe('plan.dxf');
    // Loaded: its content and its `plan|` layer are there.
    expect(two.model.blocks.get(xref!.handle)?.xrefLoaded?.length).toBeGreaterThan(0);
    expect(two.layerNames()).toContain('plan|DOORS');
    const [pasted] = two.inserts();
    expect(pasted!.geom).toMatchObject({ block: xref!.handle, position: { x: 20, y: 30 } });
    expect(two.log).toEqual(
      expect.arrayContaining(['Attach Xref "plan": plan.dxf', '"plan" loaded.']),
    );
    expect(two.requests.filter((r) => r.op === 'xref')).toEqual([
      { op: 'xref', action: 'attach', blocks: [xref!.handle] },
    ]);
    expect(two.joined()).toEqual([true]);

    // U takes the reference, the xref and its content back; redo brings them back loaded.
    await two.bus.script(['U']);
    expect(two.xrefs()).toHaveLength(0);
    expect(two.inserts()).toHaveLength(0);
    expect(two.layerNames()).not.toContain('plan|DOORS');
    await two.bus.script(['REDO']);
    expect(two.xrefs().map((r) => r.name)).toEqual(['plan']);
    expect(two.layerNames()).toContain('plan|DOORS');
    expect(two.inserts()).toHaveLength(1);
  });

  it('keeps an overlay an overlay, and a cut reference pastes as a copied one', async () => {
    const a = app();
    const one = a.drawing(1);
    const { ref } = one.attach({ x: 0, y: 0 }, true);
    await one.run('CUTCLIP', [ref.id]);
    expect(one.inserts()).toHaveLength(0);
    const two = a.drawing(2);
    await two.bus.script(['PASTECLIP', '0,0']);
    expect(two.xrefs()).toEqual([
      expect.objectContaining({ name: 'plan', flags: XREF_FLAG | XREF_OVERLAY_FLAG }),
    ]);
    expect(two.log).toContain('Overlay Xref "plan": plan.dxf');
  });

  it("references a drawing's own xref of the same name, or of the same file", async () => {
    const a = app();
    const one = a.drawing(1);
    const { ref } = one.attach({ x: 0, y: 0 });
    await one.run('COPYCLIP', [ref.id]);

    // The same name.
    const two = a.drawing(2);
    const own = two.attach({ x: 5, y: 5 });
    await two.bus.script(['PASTECLIP', '0,0']);
    expect(two.xrefs()).toHaveLength(1);
    expect(two.inserts().map((e) => e.geom.block)).toEqual([own.block, own.block]);

    // Another name, the same file (its saved path's file name, case aside).
    const three = a.drawing(3);
    const b = new ChangeSetBuilder(three.model);
    const renamed = attachXref(b, three.model, { fileName: 'PLAN.DXF', units: 4 }, false);
    b.updateTableRecord('blockRecords', renamed, { name: 'site plan' });
    b.updateBlock(renamed, { name: 'site plan' });
    three.model.apply(b.build());
    await three.bus.script(['PASTECLIP', '0,0']);
    expect(three.xrefs().map((r) => r.name)).toEqual(['site plan']);
    expect(three.inserts().map((e) => e.geom.block)).toEqual([renamed]);
    expect(three.requests.some((r) => r.op === 'xref')).toBe(false);
  });

  it('attaches an xref a copied block holds a reference to, and with PASTEBLOCK', async () => {
    const a = app();
    const one = a.drawing(1);
    const { ref } = one.attach({ x: 0, y: 0 });
    await one.bus.script(['-BLOCK', 'SHEET', '0,0']);
    await one.bus.answer({ kind: 'selection', ids: [ref.id] });
    await one.bus.script(['-INSERT', 'SHEET', '0,0', '1', '', '0']);
    const sheetRef = one.inserts().at(-1)!;
    await one.run('COPYCLIP', [sheetRef.id]);

    const two = a.drawing(2);
    await two.bus.script(['PASTECLIP', '0,0']);
    const xref = two.xrefs()[0]!;
    expect(xref.name).toBe('plan');
    const sheet = [...two.model.tables.blockRecords.values()].find((r) => r.name === 'SHEET')!;
    const held = two.model.blockEntities(sheet.handle).map((id) => two.model.entity(id)!.geom);
    expect(held).toEqual([expect.objectContaining({ kind: 'INSERT', block: xref.handle })]);
    expect(two.model.blocks.get(xref.handle)?.xrefLoaded?.length).toBeGreaterThan(0);

    const three = a.drawing(3);
    await three.bus.script(['PASTEBLOCK', '0,0']);
    expect(three.xrefs().map((r) => r.name)).toEqual(['plan']);
    expect(three.log).toContain('"plan" loaded.');
  });

  it('says the app did not find the file, and the xref waits for it', async () => {
    const a = app();
    const one = a.drawing(1);
    const { ref } = one.attach({ x: 0, y: 0 });
    await one.run('COPYCLIP', [ref.id]);
    const two = a.drawing(2, { found: false });
    await two.bus.script(['PASTEORIG']);
    expect(two.log).toContain(
      'Xref "plan" not found: drop its file, or the folder that holds it, on the window.',
    );
    const xref = two.xrefs()[0]!;
    expect(two.model.blocks.get(xref.handle)?.xrefLoaded).toBeUndefined();
    expect(two.inserts()).toHaveLength(1);
  });

  it('comes with a drawing inserted as a block (-INSERT name=file), attached and loaded', async () => {
    const a = app();
    const one = a.drawing(1);
    one.attach({ x: 0, y: 0 });
    a.sheets.set('sheet.dxf', () => drawingContent(one.model).clipboard);
    const two = a.drawing(2);
    await two.bus.script(['-INSERT', 'SHEET=sheet.dxf', '0,0', '1', '', '0']);
    expect(two.bus.command).toBeUndefined();
    const xref = two.xrefs()[0]!;
    expect(xref.name).toBe('plan');
    const sheet = [...two.model.tables.blockRecords.values()].find((r) => r.name === 'SHEET')!;
    expect(two.model.blockEntities(sheet.handle).map((id) => two.model.entity(id)!.geom)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'INSERT', block: xref.handle })]),
    );
    expect(two.log).toEqual(
      expect.arrayContaining(['Attach Xref "plan": plan.dxf', '"plan" loaded.']),
    );
    await two.bus.script(['U']);
    expect(two.xrefs()).toHaveLength(0);
  });
});
