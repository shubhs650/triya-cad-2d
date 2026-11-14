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
  type ImageDefinition,
  type ImageGeometry,
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

describe("another app's picture (M2-54)", () => {
  const PICTURE = { fileName: 'pasted-0a1b2c3d.png', width: 192, height: 96 } as const;
  /** A drawing whose app found `picture` on the system clipboard (and kept its file). */
  function withPicture(
    picture: NonNullable<Extract<ViewReply, { ok: true }>['picture']>,
    header: [string, HeaderValue][] = [],
    meta: Partial<DocumentInit['meta']> = {},
  ) {
    const init = sampleInit();
    const model = DocumentModel.create({
      ...init,
      header: new Map([...init.header!, ...header]),
      meta: { ...init.meta, ...meta } as DocumentInit['meta'],
    });
    const before = new Set([...model.entities()].map((e) => e.id));
    let held = picture;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve<ViewReply>(
            r.op === 'clipboard' ? { ok: true, picture: held } : { ok: false, message: 'none' },
          ),
      },
    });
    const copy = (p: typeof picture) => {
      held = p;
    };
    const previews: (readonly EntityGeometry[])[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'preview') previews.push(e.geometry);
    });
    const added = () => [...model.entities()].filter((e) => !before.has(e.id));
    const definitions = () =>
      [...model.objects.values()].filter((o): o is ImageDefinition => o.type === 'IMAGEDEF');
    return { model, bus, added, definitions, previews, copy };
  }

  it('pastes it as a raster image at the insertion point, its size at 96 pixels an inch', async () => {
    // Millimetres: 192 × 96 pixels at 96 per inch are 2 × 1 inches, 50.8 × 25.4 mm.
    const { model, bus, added, definitions, previews } = withPicture(PICTURE, [['$INSUNITS', 4]]);
    await bus.script(['PASTECLIP']);
    expect(bus.promptText).toBe('Specify insertion point:');
    // The picture's frame is dragged by its lower-left corner.
    const frame = previews.at(-1)?.[0] as unknown as {
      kind: string;
      vertices: { x: number; y: number }[];
    };
    expect(frame.kind).toBe('LWPOLYLINE');
    expect(frame.vertices.map((p) => [r6(p.x), r6(p.y)])).toEqual([
      [0, 0],
      [50.8, 0],
      [50.8, 25.4],
      [0, 25.4],
    ]);
    await bus.script(['20,30']);
    expect(bus.command).toBeUndefined();
    expect(previews.at(-1)).toEqual([]);
    const [image] = added();
    expect(image?.type).toBe('IMAGE');
    expect(image!.owner).toBe(MODEL_SPACE);
    expect(model.tables.layers.get(image!.layer)?.name).toBe('WALLS');
    const g = image!.geom as ImageGeometry;
    expect(g.position).toEqual({ x: 20, y: 30 });
    expect(r6(g.u.x)).toBe(r6(25.4 / 96));
    expect(g.u.y).toBe(0);
    expect(g.v.x).toBe(0);
    expect(r6(g.v.y)).toBe(r6(25.4 / 96));
    expect(g.size).toEqual({ x: 192, y: 96 });
    // As AutoCAD attaches an image: shown, shown unaligned, clip flag; not clipped.
    expect(g).toMatchObject({
      displayFlags: 7,
      clipping: false,
      brightness: 50,
      contrast: 50,
      fade: 0,
      clip: {
        type: 'rectangle',
        vertices: [
          { x: -0.5, y: -0.5 },
          { x: 191.5, y: 95.5 },
        ],
        inverted: false,
      },
    });
    const [def] = definitions();
    expect(g.definition).toBe(def!.handle);
    expect(def).toMatchObject({
      name: 'pasted-0a1b2c3d',
      fileName: 'pasted-0a1b2c3d.png',
      size: { x: 192, y: 96 },
      loaded: true,
      units: 5,
    } satisfies Partial<ImageDefinition>);
    expect(r6(def!.pixelSize.x)).toBe(r6(1 / 96));
    // No image dictionary yet: the save makes one under a new handle.
    expect(Number.parseInt(def!.owner!, 16)).toBeGreaterThanOrEqual(0x40);
    // One paste, one undo step, which takes the definition too.
    await bus.script(['U']);
    expect(added()).toHaveLength(0);
    expect(definitions()).toHaveLength(0);
  });

  it("takes the picture's own resolution, and inches or millimetres in a unitless drawing", async () => {
    // 288 pixels an inch (a screenshot on a 3× screen): 192 pixels are 2/3 inch.
    const imperial = withPicture({ ...PICTURE, ppi: { x: 288, y: 288 } }, [['$INSUNITS', 0]], {
      insUnits: 0,
      measurement: 'imperial',
    });
    await imperial.bus.script(['PASTECLIP', '0,0']);
    const a = imperial.added()[0]!.geom as ImageGeometry;
    expect(r6(a.u.x * 192)).toBe(r6(2 / 3));
    expect(r6(imperial.definitions()[0]!.pixelSize.x)).toBe(r6(1 / 288));

    const metric = withPicture(PICTURE, [['$INSUNITS', 0]], { insUnits: 0, measurement: 'metric' });
    await metric.bus.script(['PASTECLIP', '0,0']);
    expect(r6((metric.added()[0]!.geom as ImageGeometry).u.x * 192)).toBe(50.8);

    // Feet: 2 inches are 1/6 foot.
    const feet = withPicture(PICTURE, [['$INSUNITS', 2]]);
    await feet.bus.script(['PASTECLIP', '0,0']);
    expect(r6((feet.added()[0]!.geom as ImageGeometry).u.x * 192)).toBe(r6(1 / 6));

    // A resolution that is no resolution counts as none; a file named only by its extension
    // and a folder is still named.
    const odd = withPicture(
      { fileName: 'C:\\temp\\.png', width: 96, height: 96, ppi: { x: 0, y: 72 } },
      [['$INSUNITS', 1]],
    );
    await odd.bus.script(['PASTECLIP', '0,0']);
    expect(r6((odd.added()[0]!.geom as ImageGeometry).u.x * 96)).toBe(1);
    expect(odd.definitions()[0]!.name).toBe('picture');
  });

  it('shows the same picture pasted twice from one definition, filed with the others', async () => {
    const { model, bus, added, definitions } = withPicture(PICTURE, [], {
      imageDictionary: '3F',
    });
    await bus.script(['PASTECLIP', '0,0']);
    await bus.script(['PASTECLIP', '100,0']);
    expect(added().map((e) => e.type)).toEqual(['IMAGE', 'IMAGE']);
    expect(definitions()).toHaveLength(1);
    expect(definitions()[0]!.owner).toBe('3F');
    const shown = added().map((e) => (e.geom as ImageGeometry).definition);
    expect(shown).toEqual([definitions()[0]!.handle, definitions()[0]!.handle]);
    expect(model.meta.imageDictionary).toBe('3F');
  });

  it('gives another picture whose name the drawing has a name of its own', async () => {
    const { bus, definitions, copy } = withPicture(PICTURE);
    await bus.script(['PASTECLIP', '0,0']);
    // Another file whose name, without its extension, is the first one's image name.
    copy({ ...PICTURE, fileName: 'PASTED-0A1B2C3D.jpg' });
    await bus.script(['PASTECLIP', '0,0']);
    copy({ ...PICTURE, fileName: 'pasted-0a1b2c3d.gif' });
    await bus.script(['PASTECLIP', '0,0']);
    expect(definitions().map((d) => [d.name, d.fileName])).toEqual([
      ['pasted-0a1b2c3d', 'pasted-0a1b2c3d.png'],
      ['PASTED-0A1B2C3D-1', 'PASTED-0A1B2C3D.jpg'],
      ['pasted-0a1b2c3d-2', 'pasted-0a1b2c3d.gif'],
    ]);
  });

  it('pastes a picture with PASTECLIP only, and nothing for an empty one', async () => {
    const { bus, added } = withPicture(PICTURE);
    await bus.script(['PASTEBLOCK']);
    expect(added()).toHaveLength(0);
    expect(bus.history.at(-1)).toBe(
      'The Clipboard holds a picture, which PASTECLIP pastes as an image.',
    );
    await bus.script(['PASTEORIG']);
    expect(bus.history.at(-1)).toBe(
      'The Clipboard holds a picture, which PASTECLIP pastes as an image.',
    );
    const empty = withPicture({ ...PICTURE, width: 0 });
    await empty.bus.script(['PASTECLIP']);
    expect(empty.added()).toHaveLength(0);
    expect(empty.bus.history.at(-1)).toBe('The Clipboard holds no objects to paste.');
  });

  it('pastes nothing when the insertion point is cancelled', async () => {
    const { bus, added, definitions, previews } = withPicture(PICTURE);
    await bus.script(['PASTECLIP']);
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(added()).toHaveLength(0);
    expect(definitions()).toHaveLength(0);
    expect(previews.at(-1)).toEqual([]);
  });
});
