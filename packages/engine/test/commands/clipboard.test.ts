// M2-14 part 2: COPYCLIP, CUTCLIP, COPYBASE, PASTECLIP, PASTEBLOCK and PASTEORIG on the
// PromptBus, two drawings sharing one Clipboard as the app's do (AutoCAD 2024 Help, "COPYCLIP",
// "CUTCLIP", "COPYBASE", "PASTECLIP", "PASTEBLOCK", "PASTEORIG"). The sample drawing's model space
// holds 20 (0,0)-(10,0), 21 a circle at (5,5) r 2 on WALLS and 23 (0,0)-(0,10).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type Clipboard,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type HeaderValue,
  type MTextGeometry,
  type Prompt,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, sampleInit } from '../model/fixtures';

// Engine tests have no DOM or Node types: the global every runtime they run in has.
declare function structuredClone<T>(value: T): T;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** The app's side: one Clipboard for every drawing, tagged with the drawing that filled it. */
function app() {
  let held: { from: number; content: Clipboard } | undefined;
  const requests: ViewRequest[] = [];
  const drawing = (n: number, init: DocumentInit = sampleInit(), box?: ViewReply) => {
    const model = DocumentModel.create(init);
    const registry = builtinCommands();
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
      if (r.op === 'bounds') return box ?? { ok: false, message: 'There is no view to change.' };
      return { ok: false, message: 'There is no view to change.' };
    };
    const bus = new PromptBus({
      model,
      registry,
      view: { request: (r) => Promise.resolve(answer(r)) },
    });
    const prompts: Prompt[] = [];
    const previews: (readonly EntityGeometry[])[] = [];
    let undoable = 0;
    bus.on((e: BusEvent) => {
      if (e.type === 'undo') undoable = e.state.undoable;
      if (e.type === 'prompt') prompts.push(e.prompt);
      if (e.type === 'preview') previews.push(e.geometry);
    });
    const original = new Set([...model.entities()].map((e) => e.id));
    const added = (): Entity[] => [...model.entities()].filter((e) => !original.has(e.id));
    return { model, bus, prompts, previews, added, undoable: () => undoable };
  };
  return { drawing, requests, held: () => held };
}

const ends = (e: Entity) => {
  const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
  return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
};

const BOX: ViewReply = { ok: true, box: { minX: 0, minY: 0, maxX: 10, maxY: 10 } };

describe('COPYCLIP and PASTECLIP', () => {
  it('copies objects from one drawing and pastes them into another at the point given', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    const two = a.drawing(2);
    await one.bus.script(['COPYCLIP', 'ALL', '']);
    expect(one.bus.command).toBeUndefined();
    // Copying changes nothing in the drawing copied from.
    expect(one.added()).toHaveLength(0);
    expect(one.undoable()).toBe(0);
    expect(a.held()?.content.entities.map((e) => e.handle)).toEqual(['20', '21', '23']);
    expect(a.held()?.content.base).toEqual({ x: 0, y: 0 });

    await two.bus.script(['PASTECLIP']);
    expect(two.bus.promptText).toBe('Specify insertion point:');
    expect(two.prompts.at(-1)).toMatchObject({ drag: { kind: 'preview', from: { x: 0, y: 0 } } });
    // The curves are dragged, with the extents' frame.
    expect(two.previews.at(-1)?.map((g) => g.kind)).toEqual([
      'LINE',
      'CIRCLE',
      'LINE',
      'LWPOLYLINE',
    ]);
    await two.bus.script(['100,50']);
    expect(two.bus.command).toBeUndefined();
    const pasted = two.added();
    expect(pasted.map((e) => e.type)).toEqual(['LINE', 'CIRCLE', 'LINE']);
    expect(ends(pasted[0]!)).toEqual([100, 50, 110, 50]);
    expect(pasted.every((e) => e.owner === MODEL_SPACE)).toBe(true);
    expect(pasted.every((e) => Number.parseInt(e.handle, 16) >= 0x40)).toBe(true);
    // The preview goes once the objects are pasted.
    expect(two.previews.at(-1)).toEqual([]);
    // One paste, one undo step.
    await two.bus.script(['U']);
    expect(two.added()).toHaveLength(0);
  });

  it('takes the PICKFIRST pre-selection', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    await one.bus.selectAll();
    await one.bus.script(['COPYCLIP']);
    expect(one.bus.command).toBeUndefined();
    expect(a.held()?.content.entities).toHaveLength(3);
  });

  it('says so when there is nothing to paste', async () => {
    const two = app().drawing(2);
    await two.bus.script(['PASTECLIP']);
    expect(two.bus.command).toBeUndefined();
    expect(two.bus.history.at(-1)).toBe('The Clipboard holds no objects to paste.');
  });

  it('without a renderer, takes the origin as the base point', async () => {
    const a = app();
    const one = a.drawing(1);
    await one.bus.script(['COPYCLIP', 'ALL', '']);
    expect(a.held()?.content.base).toEqual({ x: 0, y: 0 });
    expect(a.held()?.content).not.toHaveProperty('extents');
  });
});

describe('PASTECLIP between drawings of other units (M2-32)', () => {
  it('drags and pastes the objects scaled into the units of the drawing pasted into', async () => {
    const a = app();
    // The sample drawing is in millimetres; the one pasted into, in inches.
    const one = a.drawing(1, sampleInit(), BOX);
    const inches = sampleInit();
    const two = a.drawing(2, { ...inches, meta: { ...inches.meta, insUnits: 1 } });
    await one.bus.script(['COPYCLIP', 'ALL', '']);
    expect(a.held()?.content.insUnits).toBe(4);
    await two.bus.script(['PASTECLIP']);
    const k = 1 / 25.4;
    // What is dragged is as it will be pasted: the line 10 mm long, the frame 10 mm wide.
    const dragged = two.previews.at(-1)!;
    const [line] = dragged as unknown as { start: { x: number }; end: { x: number } }[];
    expect(r6(line!.end.x - line!.start.x)).toBe(r6(10 * k));
    const frame = dragged.at(-1) as unknown as { vertices: { x: number }[] };
    expect(r6(frame.vertices[1]!.x - frame.vertices[0]!.x)).toBe(r6(10 * k));
    await two.bus.script(['100,50']);
    const pasted = two.added();
    expect(ends(pasted[0]!)).toEqual([100, 50, r6(100 + 10 * k), 50]);
    expect(pasted[1]!.geom).toMatchObject({ radius: expect.closeTo(2 * k, 9) });
  });
});

describe('CUTCLIP', () => {
  it('puts the objects on the Clipboard and removes them, as one undo step', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    await one.bus.script(['CUTCLIP', 'ALL', '']);
    expect(one.model.blockEntities(MODEL_SPACE)).toHaveLength(0);
    expect(a.held()?.content.entities).toHaveLength(3);
    await one.bus.script(['U']);
    expect(one.model.blockEntities(MODEL_SPACE)).toHaveLength(3);
  });
});

describe('COPYBASE', () => {
  it('asks the base point first and pastes it at the insertion point', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    const two = a.drawing(2);
    await one.bus.script(['COPYBASE']);
    expect(one.bus.promptText).toBe('Specify base point:');
    await one.bus.script(['10,0', 'ALL', '']);
    expect(a.held()?.content.base).toEqual({ x: 10, y: 0 });
    await two.bus.script(['PASTECLIP', '0,0']);
    expect(ends(two.added()[0]!)).toEqual([-10, 0, 0, 0]);
  });
});

describe('PASTEBLOCK', () => {
  it('pastes the objects as one block reference on the current layer', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    const two = a.drawing(2);
    await one.bus.script(['COPYCLIP', 'ALL', '']);
    await two.bus.script(['PASTEBLOCK']);
    expect(two.bus.promptText).toBe('Specify insertion point:');
    await two.bus.script(['5,5']);
    const [ref] = two.added().filter((e) => e.owner === MODEL_SPACE);
    expect(ref?.type).toBe('INSERT');
    // $CLAYER is WALLS in the sample.
    expect(two.model.tables.layers.get(ref!.layer)?.name).toBe('WALLS');
    const g = ref!.geom as { block: string; position: object };
    expect(g.position).toEqual({ x: 5, y: 5 });
    expect(two.model.blocks.get(g.block)?.name).toMatch(/^A\$C[0-9A-F]{8}$/);
    expect(two.model.blockEntities(g.block)).toHaveLength(3);
  });
});

describe('PASTEORIG', () => {
  it('pastes objects from another drawing at their own coordinates', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    const two = a.drawing(2);
    await one.bus.script(['COPYCLIP', 'ALL', '']);
    await two.bus.script(['PASTEORIG']);
    expect(two.bus.command).toBeUndefined();
    expect(ends(two.added()[0]!)).toEqual([0, 0, 10, 0]);
  });

  it('refuses objects copied from the same drawing', async () => {
    const a = app();
    const one = a.drawing(1, sampleInit(), BOX);
    await one.bus.script(['COPYCLIP', 'ALL', '', 'PASTEORIG']);
    expect(one.added()).toHaveLength(0);
    expect(one.bus.history.at(-1)).toBe(
      'PASTEORIG pastes objects copied from another drawing only.',
    );
  });
});

describe('the system clipboard (M2-32 part 5)', () => {
  const STANDARD = '30';
  /** A drawing whose app found `text` from another app on the system clipboard. */
  function withText(text: string, header: [string, HeaderValue][] = []) {
    const init = sampleInit();
    const model = DocumentModel.create({
      ...init,
      header: new Map([...init.header!, ...header]),
      tables: {
        ...init.tables,
        textStyles: [
          {
            handle: STANDARD,
            name: 'Standard',
            font: 'arial.ttf',
            height: 0,
            widthFactor: 1,
            obliqueAngle: 0,
            lastHeight: 2.5,
            generation: 0,
            trueTypeFlags: 0,
          } satisfies TextStyleRecord,
        ],
      },
    });
    const before = new Set([...model.entities()].map((e) => e.id));
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve<ViewReply>(
            r.op === 'clipboard' ? { ok: true, text } : { ok: false, message: 'none' },
          ),
      },
    });
    const added = () => [...model.entities()].filter((e) => !before.has(e.id));
    return { model, bus, added };
  }

  it("pastes another app's text as multiline text at the insertion point, as AutoCAD does", async () => {
    const { model, bus, added } = withText('Note 1: {see} C:\\temp\r\nsecond\tline\r\n', [
      ['$TEXTSIZE', 3.5],
    ]);
    await bus.script(['PASTECLIP']);
    expect(bus.promptText).toBe('Specify insertion point:');
    await bus.script(['20,30']);
    expect(bus.command).toBeUndefined();
    const [e] = added();
    expect(e?.type).toBe('MTEXT');
    expect(e!.owner).toBe(MODEL_SPACE);
    // The MTEXT defaults: the current style and TEXTSIZE, top left at the point, no wrapping.
    expect(e!.geom).toMatchObject({
      kind: 'MTEXT',
      contents: 'Note 1: \\{see\\} C:\\\\temp\\Psecond^Iline',
      style: STANDARD,
      position: { x: 20, y: 30 },
      height: 3.5,
      width: 0,
      rotation: 0,
      attachment: 1,
    } satisfies Partial<MTextGeometry>);
    // On the current layer, as anything drawn.
    expect(model.tables.layers.get(e!.layer)?.name).toBe('WALLS');
    await bus.script(['U']);
    expect(added()).toHaveLength(0);
  });

  it('pastes text with PASTECLIP only', async () => {
    const { bus, added } = withText('words');
    await bus.script(['PASTEBLOCK']);
    expect(added()).toHaveLength(0);
    expect(bus.history.at(-1)).toBe(
      'The Clipboard holds text, which PASTECLIP pastes as multiline text.',
    );
    await bus.script(['PASTEORIG']);
    expect(bus.history.at(-1)).toBe(
      'The Clipboard holds text, which PASTECLIP pastes as multiline text.',
    );
  });

  it('pastes nothing for text that is only line breaks', async () => {
    const { bus, added } = withText('\r\n');
    await bus.script(['PASTECLIP']);
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(0);
    expect(bus.history.at(-1)).toBe('The Clipboard holds no objects to paste.');
  });
});
