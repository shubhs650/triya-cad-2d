// M8-03: what the engine does for the library palette. LIBRARY (alias LIB) and LIBRARYCLOSE open
// and close the palette, which the app shows; a library block reaches the drawing as one
// DesignCenter copies (`designCenterItem`), drawn in the drawing's units, and is inserted where
// the drafter picks, as the Blocks palette's click-to-insert asks (one INSERT undo step); the
// palette's preview draws the copied block without adding it to the drawing.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  EngineSession,
  PromptBus,
  builtinCommands,
  designCenterItem,
  stylePreviewModel,
  type DesignCenterItem,
  type InsertGeometry,
  type ViewRequest,
} from '../../src/index';
import { setup } from './edit-harness';
import { sampleInit } from '../model/fixtures';

// Engine tests have no Node or DOM types (TESTING.md); Node has it.
declare const structuredClone: <T>(value: T) => T;

/** A block SYMBOL (a circle of radius 5, in millimetres) copied out of a drawing of its own. */
function symbol(): DesignCenterItem {
  const model = DocumentModel.create(sampleInit());
  const b = new ChangeSetBuilder(model);
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
  const block = b.addBlock({ name: 'SYMBOL', basePoint: { x: 0, y: 0 }, units: 4 }).handle;
  b.addEntity({
    owner: block,
    layer: zero,
    geom: { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 5 },
    color: { kind: 'byBlock' },
  });
  model.apply(b.build());
  return structuredClone(designCenterItem(model, 'blocks', 'SYMBOL')!);
}

const inserts = (t: ReturnType<typeof setup>) => t.space().filter((e) => e.geom.kind === 'INSERT');

describe('LIBRARY and LIBRARYCLOSE', () => {
  it('ask the app to open and close the library palette (alias LIB)', async () => {
    const requests: ViewRequest[] = [];
    const bus = new PromptBus({
      model: DocumentModel.create(sampleInit()),
      registry: builtinCommands(),
      view: {
        request: (r) => {
          requests.push(r);
          return Promise.resolve({ ok: true });
        },
      },
    });
    await bus.script(['LIBRARY', 'LIB', 'LIBRARYCLOSE']);
    expect(requests).toEqual([
      { op: 'palette', palette: 'library', open: true },
      { op: 'palette', palette: 'library', open: true },
      { op: 'palette', palette: 'library', open: false },
    ]);
  });
});

describe('a library block inserted on screen', () => {
  it('asks for the insertion point, then adds and inserts the block at scale 1, one INSERT step', async () => {
    const t = setup();
    await t.bus.designCenter({
      items: [symbol()],
      insert: { block: 'SYMBOL', onScreen: true },
      library: true,
    });
    expect(t.bus.prompt?.kind).toBe('point');
    expect(t.bus.prompt?.message).toMatch(/^Specify insertion point/);
    // The block is in the drawing while its insertion point is asked, as INSERT drags it.
    expect([...t.model.tables.blockRecords.values()].some((r) => r.name === 'SYMBOL')).toBe(true);
    await t.bus.submit('10,20');
    expect(t.bus.command).toBeUndefined();
    const [ref] = inserts(t);
    const g = ref!.geom as InsertGeometry;
    expect(g.position).toEqual({ x: 10, y: 20 });
    expect(g.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(g.rotation).toBe(0);
    expect(t.bus.undo.state.nextUndo).toBe('INSERT');
    await t.bus.script(['U']);
    expect(inserts(t)).toHaveLength(0);
    expect([...t.model.tables.blockRecords.values()].some((r) => r.name === 'SYMBOL')).toBe(false);
  });

  it('inserts the drawing’s own block when it has the block already', async () => {
    const t = setup();
    await t.bus.designCenter({
      items: [symbol()],
      insert: { block: 'SYMBOL', at: { x: 0, y: 0 } },
    });
    await t.bus.designCenter({
      items: [],
      insert: { block: 'SYMBOL', onScreen: true },
      library: true,
    });
    await t.bus.submit('5,5');
    expect(inserts(t).map((e) => (e.geom as InsertGeometry).position)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('comes from the app as a design-center input with the library’s flags', async () => {
    const s = new EngineSession(sampleInit());
    await s.command({
      kind: 'design-center',
      drop: { items: [symbol()], insert: { block: 'SYMBOL', onScreen: true }, library: true },
    });
    await s.command({ kind: 'submit', text: '1,2' });
    expect(s.undoState.nextUndo).toBe('INSERT');
    const ref = [...s.model.entities()].find((e) => e.geom.kind === 'INSERT');
    expect((ref?.geom as InsertGeometry).position).toEqual({ x: 1, y: 2 });
  });
});

describe('the library preview', () => {
  it('draws the copied block in a drawing of its own, leaving the drawing alone', () => {
    const model = DocumentModel.create(sampleInit());
    const pm = stylePreviewModel(model, {
      kind: 'library',
      block: 'SYMBOL',
      content: symbol().content,
    });
    const space = [...pm!.tables.blockRecords.values()].find((r) => r.name === '*Model_Space')!;
    const [ref] = [...pm!.blockEntities(space.handle)].map((id) => pm!.entity(id)!);
    const g = ref!.geom as InsertGeometry;
    expect(pm!.blocks.get(g.block)?.name).toBe('SYMBOL');
    expect([...pm!.blockEntities(g.block)].map((id) => pm!.entity(id)!.geom.kind)).toEqual([
      'CIRCLE',
    ]);
    expect([...model.tables.blockRecords.values()].some((r) => r.name === 'SYMBOL')).toBe(false);
  });
});
