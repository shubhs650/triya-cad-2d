// M5-04 part 7: XBIND and -XBIND on the PromptBus, as AutoCAD 2024's (AutoCAD Help, "XBIND
// (Command)", "Xbind Dialog Box", "-XBIND (Command)", "About Binding Xrefs"):
//   - the Xbind dialog lists each xref with its xref-dependent Block, Dimstyle, Layer, Linetype
//     and Textstyle definitions; OK binds the Definitions to Bind;
//   - -XBIND asks "Enter symbol type to bind [Block/Dimstyle/LAyer/LType/Style]", then the
//     dependent names (wildcards, commas);
//   - a bound definition is a copy named `xref$n$name` (n the lowest free), not xref-dependent,
//     with the xref-dependent definitions it names bound with it; the xref keeps its own;
//   - one XBIND undo step.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  xbindChange,
  xbindXrefs,
  loadedXrefHandles,
  xrefLoadChange,
  type BusEvent,
  type DialogRequest,
  type DimStyleRecord,
  type DocumentInit,
  type EntityGeometry,
  type ImageDefinition,
  type LayerRecord,
  type NonGraphicalObject,
  type PdfDefinition,
  type PromptAnswer,
  type TextStyleRecord,
} from '../../src/index';
import {
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  linetype,
  circleGeom,
  sampleInit,
  MODEL_SPACE,
} from '../model/fixtures';

const XREF = '30';
const insert = (block: string, x = 0, y = 0): EntityGeometry => ({
  kind: 'INSERT',
  block,
  position: { x, y },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  attributes: [],
});

/** The sample drawing with an attached xref PLAN, referenced once. */
function hostInit(): DocumentInit {
  const s = sampleInit();
  return {
    ...s,
    tables: {
      ...s.tables,
      blockRecords: [...(s.tables?.blockRecords ?? []), { ...blockRecord(XREF, 'PLAN'), flags: 4 }],
    },
    blocks: [
      ...(s.blocks ?? []),
      { handle: XREF, name: 'PLAN', basePoint: { x: 0, y: 0 }, xrefPath: 'plan.dxf' },
    ],
    entities: [...(s.entities ?? []), entityInit('31', insert(XREF, 100, 0))],
  };
}

const style = (handle: string, name: string, font: string): TextStyleRecord => ({
  handle,
  name,
  font,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

/**
 * The xref's drawing: layers 0, WALLS (DASHED) and DOORS, text styles Standard (no font) and
 * NOTES, a dimension style ISO naming NOTES, a block DOOR (a line on DOORS, a circle on 0 and a
 * reference to a nested xref GRAND) and a block FRAME holding a DOOR.
 */
function planInit(): DocumentInit {
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '60',
    tables: {
      layers: [
        layer('10', '0'),
        { ...layer('11', 'WALLS'), linetype: '15', color: { kind: 'aci', index: 3 } },
        layer('12', 'DOORS'),
      ],
      linetypes: [linetype('14', 'Continuous'), linetype('15', 'DASHED')],
      textStyles: [style('16', 'Standard', ''), style('17', 'NOTES', 'romans.shx')],
      dimStyles: [{ handle: '18', name: 'ISO', vars: { DIMTXSTY: '17', DIMSCALE: 2 } }],
      blockRecords: [
        blockRecord('1F', '*Model_Space'),
        blockRecord('1B', '*Paper_Space'),
        blockRecord('40', 'DOOR'),
        { ...blockRecord('41', 'GRAND'), flags: 4 },
        blockRecord('42', 'FRAME'),
      ],
    },
    blocks: [
      { handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: '1B', name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
      { handle: '40', name: 'DOOR', basePoint: { x: 1, y: 1 } },
      { handle: '41', name: 'GRAND', basePoint: { x: 0, y: 0 }, xrefPath: 'grand.dxf' },
      { handle: '42', name: 'FRAME', basePoint: { x: 0, y: 0 } },
    ],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    objects: [{ handle: 'C', type: 'DICTIONARY', owner: '0' }],
    entities: [
      entityInit('20', lineGeom(0, 0, 10, 0), { layer: '11', owner: '1F' }),
      entityInit('23', insert('40', 2, 2), { layer: '12', owner: '1F' }),
      entityInit('45', lineGeom(1, 1, 2, 3), { layer: '12', owner: '40' }),
      entityInit('46', circleGeom(1, 1, 0.5), { layer: '10', owner: '40' }),
      entityInit('47', insert('41'), { layer: '10', owner: '40' }),
      entityInit('48', insert('40', 5, 5), { layer: '10', owner: '42' }),
    ],
  };
}

function drawing() {
  const model = DocumentModel.create(hostInit());
  model.apply(xrefLoadChange(model, XREF, planInit()));
  const log: string[] = [];
  const bus = new PromptBus({ model, registry: builtinCommands() });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const request = () => {
    const p = bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('xbind');
    return p!.dialog as Extract<DialogRequest, { type: 'xbind' }>;
  };
  return { model, bus, log, request };
}

const named = (model: DocumentModel, table: 'layers' | 'linetypes' | 'textStyles', name: string) =>
  [...model.tables[table].values()].find((r) => r.name === name);
const blockNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
const dimStyleNamed = (model: DocumentModel, name: string) =>
  [...model.tables.dimStyles.values()].find((r) => r.name === name) as DimStyleRecord | undefined;
const handleOf = (model: DocumentModel, name: string): string =>
  xbindXrefs(model)
    .flatMap((x) => x.definitions)
    .find((d) => d.name === name)!.handle;

/** The host's ACAD_IMAGE_DICT and ACAD_PDFDEFINITIONS. */
const IMAGE_DICT = '3C';
const PDF_DICT = '3D';

const imageDef = (handle: string, name: string, fileName: string): ImageDefinition => ({
  handle,
  type: 'IMAGEDEF',
  owner: 'C',
  name,
  fileName,
  size: { x: 10, y: 10 },
  pixelSize: { x: 1, y: 1 },
  loaded: true,
  units: 0,
});

const pdfDef = (handle: string, name: string, fileName: string): PdfDefinition => ({
  handle,
  type: 'PDFDEFINITION',
  owner: 'C',
  name,
  fileName,
  page: '1',
});

/**
 * The host with PLAN loaded, PLAN's DOOR holding an image of stamp.png (its file stating no
 * boundary) and an underlay of sheet.pdf; the host has its image and PDF dictionaries (`dicts`)
 * and the definitions `own`.
 */
function withPictures(own: readonly NonGraphicalObject[] = [], dicts = true): DocumentModel {
  const host = hostInit();
  const model = DocumentModel.create({
    ...host,
    meta: {
      ...host.meta!,
      ...(dicts ? { imageDictionary: IMAGE_DICT, pdfDictionary: PDF_DICT } : {}),
    },
    objects: [
      ...(host.objects ?? []),
      ...(dicts
        ? [
            { handle: IMAGE_DICT, type: 'DICTIONARY', owner: 'C' },
            { handle: PDF_DICT, type: 'DICTIONARY', owner: 'C' },
          ]
        : []),
      ...own,
    ],
  });
  const plan = planInit();
  const image = {
    kind: 'IMAGE',
    definition: '50',
    position: { x: 0, y: 0 },
    u: { x: 1, y: 0 },
    v: { x: 0, y: 1 },
    size: { x: 10, y: 10 },
    displayFlags: 7,
    clipping: false,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: { type: 'rectangle', vertices: [], inverted: false },
  } as EntityGeometry;
  const underlay = {
    kind: 'PDFUNDERLAY',
    definition: '52',
    position: { x: 3, y: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    flags: 2,
    contrast: 100,
    fade: 0,
    clip: [],
  } as unknown as EntityGeometry;
  model.apply(
    xrefLoadChange(model, XREF, {
      ...plan,
      objects: [
        ...(plan.objects ?? []),
        imageDef('50', 'stamp', 'stamp.png'),
        pdfDef('52', 'sheet', 'sheet.pdf'),
      ],
      entities: [
        ...(plan.entities ?? []),
        entityInit('51', image, { layer: '10', owner: '40' }),
        entityInit('53', underlay, { layer: '10', owner: '40' }),
      ],
    }),
  );
  return model;
}

/** The one image or underlay of block `block`. */
function pictureIn(model: DocumentModel, block: string, kind: 'IMAGE' | 'PDFUNDERLAY') {
  const e = model
    .blockEntities(block)
    .map((id) => model.entity(id)!)
    .find((x) => x.geom.kind === kind)!;
  return e.geom as unknown as {
    readonly definition?: string;
    readonly clip: { readonly vertices: readonly { x: number; y: number }[] };
  };
}

/** The image and PDF definitions of `model`. */
const definitions = (model: DocumentModel): NonGraphicalObject[] =>
  [...model.objects.values()].filter((o) => o.type === 'IMAGEDEF' || o.type === 'PDFDEFINITION');

function busOn(model: DocumentModel) {
  const log: string[] = [];
  const bus = new PromptBus({ model, registry: builtinCommands() });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { bus, log };
}

describe('XBIND: the Xbind dialog', () => {
  it("lists each xref's dependent definitions by kind, the nested xref's own and none of anonymous ones", async () => {
    const t = drawing();
    await t.bus.script(['XBIND']);
    const xrefs = t.request().xrefs;
    expect(xrefs.map((x) => x.name)).toEqual(['GRAND', 'PLAN']);
    expect(xrefs[0]!.definitions).toEqual([]);
    expect(xrefs[1]!.definitions.map((d) => `${d.kind} ${d.name}`)).toEqual([
      'Linetype PLAN|DASHED',
      'Block PLAN|DOOR',
      'Layer PLAN|DOORS',
      'Block PLAN|FRAME',
      'Dimstyle PLAN|ISO',
      'Textstyle PLAN|NOTES',
      'Textstyle PLAN|Standard',
      'Layer PLAN|WALLS',
    ]);
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
  });

  it('binds a layer as xref$0$name with its linetype, leaving the xref its own; one undo step', async () => {
    const t = drawing();
    const walls = named(t.model, 'layers', 'PLAN|WALLS')!;
    await t.bus.script(['XB']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', xbind: [walls.handle] } as PromptAnswer);
    const bound = named(t.model, 'layers', 'PLAN$0$WALLS') as LayerRecord;
    expect(bound).toBeDefined();
    expect(bound.handle).not.toBe(walls.handle);
    expect(bound.flags ?? 0).toBe(0);
    expect(bound.color).toEqual({ kind: 'aci', index: 3 });
    const dashed = named(t.model, 'linetypes', 'PLAN$0$DASHED')!;
    expect(bound.linetype).toBe(dashed.handle);
    expect(dashed.flags ?? 0).toBe(0);
    // The xref keeps drawing with its own.
    expect(named(t.model, 'layers', 'PLAN|WALLS')).toBe(walls);
    expect(t.log).toContain('Layer "PLAN|WALLS" bound as "PLAN$0$WALLS".');
    expect(t.bus.undo.state.nextUndo).toBe('XBIND');
    await t.bus.script(['U']);
    expect(named(t.model, 'layers', 'PLAN$0$WALLS')).toBeUndefined();
    expect(named(t.model, 'linetypes', 'PLAN$0$DASHED')).toBeUndefined();
  });

  it('binds a block with what it holds, its layers and nested blocks bound; a nested xref reference stays out', async () => {
    const t = drawing();
    await t.bus.script(['XBIND']);
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      xbind: [handleOf(t.model, 'PLAN|FRAME')],
    } as PromptAnswer);
    const frame = blockNamed(t.model, 'PLAN$0$FRAME')!;
    const door = blockNamed(t.model, 'PLAN$0$DOOR')!;
    expect(frame.flags ?? 0).toBe(0);
    const [ref] = t.model.blockEntities(frame.handle).map((id) => t.model.entity(id)!);
    expect(ref!.geom).toMatchObject({ kind: 'INSERT', block: door.handle });
    const doorContent = t.model.blockEntities(door.handle).map((id) => t.model.entity(id)!);
    expect(doorContent.map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    expect(doorContent[0]!.layer).toBe(named(t.model, 'layers', 'PLAN$0$DOORS')!.handle);
    expect(doorContent[1]!.layer).toBe('10');
    expect(t.model.blocks.get(door.handle)?.basePoint).toEqual({ x: 1, y: 1 });
    expect(t.log).toContain('Block "PLAN|FRAME" bound as "PLAN$0$FRAME".');
    expect(t.log).toContain(
      "1 object(s) left out of the bound block(s): a nested xref's reference cannot be pasted.",
    );
  });

  it('binds a dimension style with its text style; Standard without a font is drawn in txt', () => {
    const t = drawing();
    const { change, report } = xbindChange(t.model, [
      handleOf(t.model, 'PLAN|ISO'),
      handleOf(t.model, 'PLAN|Standard'),
    ]);
    t.model.apply(change);
    expect(report.bound.map((d) => d.boundName)).toEqual(['PLAN$0$ISO', 'PLAN$0$Standard']);
    const iso = dimStyleNamed(t.model, 'PLAN$0$ISO')!;
    const notes = named(t.model, 'textStyles', 'PLAN$0$NOTES') as TextStyleRecord;
    expect(iso.vars.DIMTXSTY).toBe(notes.handle);
    expect(iso.vars.DIMSCALE).toBe(2);
    expect(notes.font).toBe('romans.shx');
    expect((named(t.model, 'textStyles', 'PLAN$0$Standard') as TextStyleRecord).font).toBe('txt');
  });

  it('numbers past bound names the drawing has; ignores what is no dependent definition', () => {
    const t = drawing();
    const walls = handleOf(t.model, 'PLAN|WALLS');
    t.model.apply(xbindChange(t.model, [walls]).change);
    const { change, report } = xbindChange(t.model, [walls, MODEL_SPACE, '10', 'FFFF']);
    t.model.apply(change);
    expect(report.bound.map((d) => d.boundName)).toEqual(['PLAN$1$WALLS']);
    // Its linetype is bound again under the next number.
    expect(named(t.model, 'linetypes', 'PLAN$1$DASHED')).toBeDefined();
    expect(xbindChange(t.model, []).report.bound).toEqual([]);
  });

  it('ends without binding at OK with no definitions, or an answer naming none', async () => {
    const t = drawing();
    const before = t.model.tables.layers.size;
    await t.bus.script(['XBIND']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', xbind: [] } as PromptAnswer);
    await t.bus.script(['XBIND']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', xbind: [7] } as never);
    await t.bus.script(['XBIND']);
    await t.bus.answer({ kind: 'dialog', action: 'ok' } as PromptAnswer);
    expect(t.model.tables.layers.size).toBe(before);
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('says so in a drawing without xrefs', async () => {
    const model = DocumentModel.create(sampleInit());
    const log: string[] = [];
    const bus = new PromptBus({ model, registry: builtinCommands() });
    bus.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['XBIND']);
    expect(log).toContain('The drawing has no external references.');
    expect(bus.command).toBeUndefined();
  });

  it("binds a block holding an image and an underlay: their definitions are filed as the drawing's", () => {
    const model = withPictures();
    // What the xref's load brought: its definitions, filed nowhere in the drawing.
    const xrefDefs = definitions(model);
    expect(xrefDefs.every((d) => loadedXrefHandles(model).has(d.handle))).toBe(true);
    const { change, report } = xbindChange(model, [handleOf(model, 'PLAN|FRAME')]);
    expect(report.bound.map((d) => d.boundName)).toEqual(['PLAN$0$FRAME']);
    model.apply(change);
    // The bound DOOR's image and underlay show new definitions of the same name and file, filed
    // in the drawing's dictionaries; the xref keeps drawing with its own.
    const door = blockNamed(model, 'PLAN$0$DOOR')!;
    const image = pictureIn(model, door.handle, 'IMAGE');
    const underlay = pictureIn(model, door.handle, 'PDFUNDERLAY');
    const def = model.objects.get(image.definition!) as ImageDefinition;
    const pdf = model.objects.get(underlay.definition!) as PdfDefinition;
    expect(def).toMatchObject({ name: 'stamp', fileName: 'stamp.png', owner: IMAGE_DICT });
    expect(pdf).toMatchObject({ name: 'sheet', fileName: 'sheet.pdf', owner: PDF_DICT });
    expect(loadedXrefHandles(model).has(def.handle)).toBe(false);
    expect(loadedXrefHandles(model).has(pdf.handle)).toBe(false);
    expect(pictureIn(model, handleOf(model, 'PLAN|DOOR'), 'IMAGE').definition).toBe(
      xrefDefs.find((d) => d.type === 'IMAGEDEF')!.handle,
    );
    for (const d of xrefDefs) expect(model.objects.get(d.handle)).toEqual(d);
    // An image whose file states no boundary has the whole image's, as a bind gives it.
    expect(image.clip.vertices).toEqual([
      { x: -0.5, y: -0.5 },
      { x: 9.5, y: 9.5 },
    ]);
  });

  it("shows the drawing's definition of the same name and file; another file's name is the bound one", () => {
    const model = withPictures([
      { ...imageDef('3E', 'stamp', 'stamp.png'), owner: IMAGE_DICT },
      { ...pdfDef('3F', 'sheet', 'other.pdf'), owner: PDF_DICT },
    ]);
    const { change } = xbindChange(model, [handleOf(model, 'PLAN|DOOR')]);
    model.apply(change);
    const door = blockNamed(model, 'PLAN$0$DOOR')!;
    expect(pictureIn(model, door.handle, 'IMAGE').definition).toBe('3E');
    const pdf = model.objects.get(
      pictureIn(model, door.handle, 'PDFUNDERLAY').definition!,
    ) as PdfDefinition;
    expect(pdf).toMatchObject({ name: 'PLAN$0$sheet', fileName: 'sheet.pdf', owner: PDF_DICT });
    // Bound again: the definitions the first bind filed are the drawing's now.
    const before = definitions(model).length;
    model.apply(xbindChange(model, [handleOf(model, 'PLAN|DOOR')]).change);
    const again = blockNamed(model, 'PLAN$1$DOOR')!;
    expect(pictureIn(model, again.handle, 'IMAGE').definition).toBe('3E');
    expect(pictureIn(model, again.handle, 'PDFUNDERLAY').definition).toBe(pdf.handle);
    expect(definitions(model)).toHaveLength(before);
  });

  it('files a definition in a new dictionary when the drawing has none; one undo step', async () => {
    const model = withPictures(undefined, false);
    const t = busOn(model);
    await t.bus.script(['-XBIND', 'B', 'PLAN|DOOR']);
    expect(t.log).toContain('Block "PLAN|DOOR" bound as "PLAN$0$DOOR".');
    const door = blockNamed(model, 'PLAN$0$DOOR')!;
    const def = model.objects.get(pictureIn(model, door.handle, 'IMAGE').definition!)!;
    // A handle of its own, which the save creates the ACAD_IMAGE_DICT under.
    expect(def.owner).not.toBe(IMAGE_DICT);
    expect(model.objects.has(def.owner)).toBe(false);
    const count = definitions(model).length;
    await t.bus.script(['U']);
    expect(blockNamed(model, 'PLAN$0$DOOR')).toBeUndefined();
    expect(definitions(model)).toHaveLength(count - 2);
  });
});

describe('-XBIND', () => {
  it('asks the symbol type, then dependent names with wildcards', async () => {
    const t = drawing();
    await t.bus.script(['-XBIND', 'LA', 'plan|w*,PLAN|DOORS']);
    expect(t.log).toContain('Layer "PLAN|DOORS" bound as "PLAN$0$DOORS".');
    expect(t.log).toContain('Layer "PLAN|WALLS" bound as "PLAN$0$WALLS".');
    expect(t.bus.undo.state.nextUndo).toBe('XBIND');
    expect(t.bus.command).toBeUndefined();
    await t.bus.script(['-XBIND', 'LT', 'PLAN|DASHED']);
    expect(t.log).toContain('Linetype "PLAN|DASHED" bound as "PLAN$1$DASHED".');
    await t.bus.script(['-XBIND', 'S', '*NOTES']);
    expect(t.log).toContain('Text style "PLAN|NOTES" bound as "PLAN$0$NOTES".');
    await t.bus.script(['-XBIND', 'D', 'PLAN|ISO']);
    // NOTES is bound already: the dimension style's copy of it is the next.
    expect(dimStyleNamed(t.model, 'PLAN$0$ISO')?.vars.DIMTXSTY).toBe(
      named(t.model, 'textStyles', 'PLAN$1$NOTES')!.handle,
    );
    await t.bus.script(['-XBIND', 'B', 'PLAN|DOOR']);
    expect(blockNamed(t.model, 'PLAN$0$DOOR')).toBeDefined();
  });

  it('says when no dependent definition matches, and ends at an empty name', async () => {
    const t = drawing();
    await t.bus.script(['-XBIND', 'LA', 'NOPE|*']);
    expect(t.log).toContain('No matching dependent Layer found.');
    await t.bus.script(['-XBIND', 'B', '']);
    expect(t.bus.command).toBeUndefined();
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
  });
});
