// TriyaToAcad for IMAGEDEF, RASTERVARIABLES and WIPEOUTVARIABLES objects (M1-75 part 13). The
// drawing is authored in memory with acad-ts and saved once, so "the file" is real bytes; the
// corpus-wide edits are in packages/testkit/src/export/export.corpus.test.ts.
import {
  ACadVersion,
  CadDictionary,
  CadDocument,
  ImageDefinition as AcadImageDefinition,
  ImageDisplayQuality,
  RasterImage,
  RasterVariables as AcadRasterVariables,
  WipeoutVariables as AcadWipeoutVariables,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type EntityGeometry,
  type ImageDefinition,
  type NonGraphicalObject,
  type RasterVariables,
  type WipeoutVariables,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { same } from '../src/export/entities';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

interface Options {
  /** Leave out the ACAD_IMAGE_DICT dictionary (and so every image). */
  readonly noImageDictionary?: boolean;
  /** Leave out ACAD_IMAGE_VARS and ACAD_WIPEOUT_VARS. */
  readonly noVariables?: boolean;
}

/**
 * Image definitions `photo` and `plan` in ACAD_IMAGE_DICT, an IMAGE showing `photo`, and the
 * drawing's IMAGEFRAME / IMAGEQUALITY (ACAD_IMAGE_VARS) and WIPEOUTFRAME (ACAD_WIPEOUT_VARS).
 */
function drawing(
  version = ACadVersion.AC1032,
  format: CadFormat = 'dxf',
  options: Options = {},
): Uint8Array {
  const doc = new CadDocument(version);
  const root = doc.rootDictionary!;
  if (options.noImageDictionary) {
    root.remove(CadDictionary.acadImageDict);
  } else {
    const images = root.getEntry<CadDictionary>(CadDictionary.acadImageDict)!;
    const defs = ['photo', 'plan'].map((name) => {
      const def = new AcadImageDefinition(name);
      def.fileName = `.\\${name}.png`;
      def.size = new XY(640, 480);
      def.defaultSize = new XY(0.5, 0.5);
      images.add(def);
      return def;
    });
    const im = new RasterImage();
    doc.entities!.add(im);
    im.definition = defs[0]!;
    im.insertPoint = new XYZ(0, 0, 0);
    im.uVector = new XYZ(0.01, 0, 0);
    im.vVector = new XYZ(0, 0.01, 0);
    im.size = new XY(640, 480);
    im.flags = 7 as never;
    im.clipBoundaryVertices = [new XY(-0.5, -0.5), new XY(639.5, 479.5)];
  }
  if (!options.noVariables) {
    const raster = new AcadRasterVariables('ACAD_IMAGE_VARS');
    raster.isDisplayFrameShown = true;
    raster.displayQuality = ImageDisplayQuality.High;
    raster.units = 1;
    root.add(raster);
    const wipeout = new AcadWipeoutVariables('ACAD_WIPEOUT_VARS');
    wipeout.displayImageFrame = true;
    root.add(wipeout);
  }
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const objects = <T extends NonGraphicalObject>(model: DocumentModel, type: T['type']): T[] =>
  [...model.objects.values()].filter((o): o is T => o.type === type);

const definition = (model: DocumentModel, name: string): ImageDefinition =>
  objects<ImageDefinition>(model, 'IMAGEDEF').find((d) => d.name === name)!;
const raster = (model: DocumentModel) => objects<RasterVariables>(model, 'RASTERVARIABLES')[0]!;
const wipeout = (model: DocumentModel) => objects<WipeoutVariables>(model, 'WIPEOUTVARIABLES')[0]!;

/** The handle of the drawing's root dictionary or one of its entries, as Triya writes handles. */
function dictionary(bytes: Uint8Array, entry?: string): string {
  const root = readCadDocument(bytes).rootDictionary!;
  const o = entry === undefined ? root : root.getEntry(entry)!;
  return o.handle.toString(16).toUpperCase();
}

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat) {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/**
 * An object as it maps back, without the reader's link and its reactors: the save links an
 * image definition to the images showing it, and a new object to the dictionary holding it.
 */
function comparable<T extends NonGraphicalObject>(o: T | undefined) {
  if (!o) return o;
  const { raw: _raw, reactors: _reactors, ...rest } = o;
  return rest;
}

/** An object patch with the fields of one object type. */
const patch = (fields: Record<string, unknown>) => fields as Partial<NonGraphicalObject>;

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

/** Every field the mapping carries, set to a value the drawing does not have. */
const FIELD_EDITS: Record<
  string,
  (m: DocumentModel) => readonly [string, Record<string, unknown>]
> = {
  // IMAGE "Found at" / External References "Saved path".
  fileName: (m) => [definition(m, 'photo').handle, { fileName: 'C:\\site\\photo-2.jpg' }],
  size: (m) => [definition(m, 'photo').handle, { size: { x: 1024, y: 768 } }],
  pixelSize: (m) => [definition(m, 'photo').handle, { pixelSize: { x: 0.25, y: 0.125 } }],
  // External References Unload / Reload.
  loaded: (m) => [definition(m, 'photo').handle, { loaded: false }],
  units: (m) => [definition(m, 'photo').handle, { units: 5 }],
  // IMAGEFRAME 0, IMAGEQUALITY Draft.
  'raster frame': (m) => [raster(m).handle, { frame: false }],
  'raster quality': (m) => [raster(m).handle, { quality: 'draft' }],
  'raster units': (m) => [raster(m).handle, { units: 6 }],
  // WIPEOUTFRAME 0.
  'wipeout frame': (m) => [wipeout(m).handle, { frame: false }],
};

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1027, 'dxf'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

/** A new image definition's fields, owned by `owner`. */
const newDefinition = (owner: string, name: string): Omit<ImageDefinition, 'handle'> => ({
  type: 'IMAGEDEF',
  owner,
  name,
  fileName: `.\\${name}.jpg`,
  size: { x: 800, y: 600 },
  pixelSize: { x: 1, y: 1 },
  loaded: true,
  units: 0,
});

describe('IMAGEDEF, RASTERVARIABLES and WIPEOUTVARIABLES objects', () => {
  it.each(formats)('writes edited objects and a new definition an image shows (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const photo = definition(model, 'photo');
    const image = [...model.entities()].find((e) => e.type === 'IMAGE')!;
    let added = '';
    let shown = '';
    edit(model, (b) => {
      b.updateObject(photo.handle, patch({ fileName: '..\\photos\\photo.png', loaded: false }));
      b.updateObject(raster(model).handle, patch({ frame: false, quality: 'draft' }));
      b.updateObject(wipeout(model).handle, patch({ frame: false }));
      // IMAGEATTACH of a new file: its definition, and an image showing it, in one save.
      added = b.addObject(newDefinition(photo.owner, 'survey')).handle;
      shown = b.addEntity({
        owner: image.owner,
        layer: image.layer,
        geom: { ...image.geom, definition: added } as EntityGeometry,
      }).handle;
    });

    const back = saved(bytes, model, format);
    const get = (h: string) => back.objects!.find((o) => o.handle === h);
    for (const o of [photo, raster(model), wipeout(model)])
      expect(comparable(get(o.handle))).toEqual(comparable(model.objects.get(o.handle)));
    expect(comparable(get(added))).toEqual(comparable(model.objects.get(added)));
    const shownBack = back.entities!.find((e) => e.handle === shown)!;
    expect(shownBack.geom.kind === 'IMAGE' && shownBack.geom.definition).toBe(added);
    // The new definition sits in ACAD_IMAGE_DICT under its name, linked to the image it shows.
    const reread = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
    const dict = reread.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadImageDict)!;
    const def = dict.getEntry('survey') as AcadImageDefinition;
    expect(def.handle.toString(16).toUpperCase()).toBe(added);
    const im = reread.getCadObject(Number.parseInt(shown, 16)) as RasterImage;
    expect(def.reactors).toContain(im.definitionReactor);
  });

  it('keeps everything else as it was', () => {
    const bytes = drawing();
    const model = open(bytes);
    const photo = definition(model, 'photo');
    edit(model, (b) => b.updateObject(photo.handle, patch({ loaded: false })));
    const was = documentInit(readCadDocument(bytes));
    const now = saved(bytes, model, 'dxf');
    const others = (i: typeof was) => i.objects!.filter((o) => o.handle !== photo.handle);
    expect(others(now)).toEqual(others(was));
    expect(now.entities).toEqual(was.entities);
  });

  it.each(SAVES)('writes every field %s %s', (version, format) => {
    const bytes = drawing(version, format);
    const problems: string[] = [];
    for (const [field, fieldEdit] of Object.entries(FIELD_EDITS)) {
      const model = open(bytes);
      const [handle, change] = fieldEdit(model);
      edit(model, (b) => b.updateObject(handle, patch(change)));
      const back = saved(bytes, model, format).objects?.find((o) => o.handle === handle);
      if (!same(comparable(back), comparable(model.objects.get(handle))))
        problems.push(`${field} is not kept: ${JSON.stringify(comparable(back))}`);
    }
    expect(problems).toEqual([]);
  });

  it.each(formats)(
    'adds ACAD_IMAGE_DICT, ACAD_IMAGE_VARS and ACAD_WIPEOUT_VARS to a drawing without them (%s)',
    (format) => {
      const bytes = drawing(ACadVersion.AC1032, format, {
        noImageDictionary: true,
        noVariables: true,
      });
      const model = open(bytes);
      expect(model.objects.size).toBe(0);
      const root = dictionary(bytes);
      const added: string[] = [];
      // The engine's handle for the dictionary the save creates: the definitions' owner.
      const images = model.handles.allocate();
      edit(model, (b) => {
        added.push(b.addObject(newDefinition(images, 'north')).handle);
        added.push(b.addObject(newDefinition(images, 'south')).handle);
        added.push(
          b.addObject({
            type: 'RASTERVARIABLES',
            owner: root,
            frame: false,
            quality: 'draft',
            units: 1,
          } as Omit<RasterVariables, 'handle'>).handle,
        );
        added.push(
          b.addObject({ type: 'WIPEOUTVARIABLES', owner: root, frame: false } as Omit<
            WipeoutVariables,
            'handle'
          >).handle,
        );
      });

      const back = saved(bytes, model, format);
      for (const h of added) {
        expect(comparable(back.objects!.find((o) => o.handle === h))).toEqual(
          comparable(model.objects.get(h)),
        );
      }
      const reread = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
      const entries = reread.rootDictionary!;
      expect(entries.getEntry(CadDictionary.acadImageDict)!.handle.toString(16).toUpperCase()).toBe(
        images,
      );
      expect(entries.getEntry('ACAD_IMAGE_VARS')).toBeInstanceOf(AcadRasterVariables);
      expect(entries.getEntry('ACAD_WIPEOUT_VARS')).toBeInstanceOf(AcadWipeoutVariables);
      // $HANDSEED covers the dictionary's handle too.
      expect(reread.header!.handleSeed).toBeGreaterThan(Number.parseInt(images, 16));
    },
  );

  it.each(SAVES)(
    'renames a definition in its ACAD_IMAGE_DICT entry, the image still showing it (%s %s, M1-95)',
    (version, format) => {
      const bytes = drawing(version, format);
      const model = open(bytes);
      const [photo, plan] = [definition(model, 'photo'), definition(model, 'plan')];
      // The External References palette's rename; a new definition takes the name it frees,
      // and the other definition takes the renamed one's old name.
      edit(model, (b) => {
        b.updateObject(photo.handle, patch({ name: 'Site photo', loaded: false }));
        b.updateObject(plan.handle, patch({ name: 'photo' }));
        b.addObject(newDefinition(photo.owner, 'plan') as never);
      });
      const entries = (doc: ReturnType<typeof readCadDocument>) => {
        const dict = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadImageDict)!;
        return { names: dict.entryNames, handles: dict.entryHandles };
      };
      const original = entries(readCadDocument(bytes));
      const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, { format }));
      const after = entries(reopened);
      expect(after.names).toEqual([
        ...original.names.map((n) => ({ photo: 'Site photo', plan: 'photo' })[n] ?? n),
        'plan',
      ]);
      expect(after.handles.slice(0, original.handles.length)).toEqual(original.handles);
      const back = documentInit(reopened);
      const get = (h: string) => back.objects!.find((o) => o.handle === h);
      for (const d of [photo, plan])
        expect(comparable(get(d.handle))).toEqual(comparable(model.objects.get(d.handle)));
      const image = back.entities!.find((e) => e.type === 'IMAGE')!;
      expect((image.geom as { definition?: string }).definition).toBe(photo.handle);
    },
  );

  it('refuses what it cannot write and leaves the original as it was', () => {
    const bytes = drawing();
    const root = dictionary(bytes);
    const imageDict = dictionary(bytes, CadDictionary.acadImageDict);
    const update =
      (pick: (m: DocumentModel) => NonGraphicalObject, change: Record<string, unknown>) =>
      (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateObject(pick(m).handle, change as Partial<NonGraphicalObject>);
    const photo = (m: DocumentModel) => definition(m, 'photo');
    const add = (change: Record<string, unknown>) => (b: ChangeSetBuilder) =>
      b.addObject({ ...newDefinition(imageDict, 'survey'), ...change } as never);
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [(b, m) => b.removeObject(definition(m, 'plan').handle), /removing an IMAGEDEF/],
      [(b, m) => b.removeObject(raster(m).handle), /removing a RASTERVARIABLES/],
      [update(photo, { name: 'PLAN' }), /another image is named PLAN/],
      [update(photo, { name: '' }), /an image needs a name/],
      [update(photo, { name: 'a|b' }), /"a\|b" is not a valid image name/],
      [update(photo, { owner: root }), /owner changes/],
      [update(photo, { type: 'PDFDEFINITION' }), /type changes/],
      [update(photo, { fileName: '' }), /fileName: an image needs its file/],
      [update(photo, { fileName: 3 }), /fileName: 3 is not text/],
      [update(photo, { size: { x: 0, y: 480 } }), /size: each value is a number more than 0/],
      [update(photo, { pixelSize: { x: 1, y: -1 } }), /pixelSize: each value/],
      [update(photo, { loaded: 1 }), /loaded: 1 is not true or false/],
      [update(photo, { units: 1 }), /units: 1 is not 0 \(none\), 2 \(centimetres\) or 5/],
      [update(raster, { frame: 'yes' }), /frame: "yes" is not true or false/],
      [update(raster, { quality: 'low' }), /quality: "low" is not draft or high/],
      [update(raster, { units: 9 }), /units: 9 is not a whole number from 0 to 8/],
      [update(wipeout, { frame: null }), /frame: null is not true or false/],
      [update(photo, { xdata: [{ appId: '12', values: [] }] }), /xdata changes/],
      [update(photo, { reactors: [] }), /reactors changes/],
      [update(raster, { extDict: 'FFFF' }), /extDict changes/],
      [add({ name: 'Photo' }), /another image is named Photo/],
      [add({ name: '' }), /an image needs a name/],
      [add({ name: 'a<b' }), /"a<b" is not a valid image name/],
      [add({ owner: root }), /a new image definition belongs in ACAD_IMAGE_DICT/],
      // The save links a new object to its dictionary; nothing else may be named.
      [add({ reactors: [root] }), /reactors changes/],
      [
        (b) =>
          b.addObject({
            type: 'RASTERVARIABLES',
            owner: root,
            frame: true,
            quality: 'high',
            units: 0,
          } as never),
        /the drawing already has its ACAD_IMAGE_VARS/,
      ],
      [
        (b) => b.addObject({ type: 'WIPEOUTVARIABLES', owner: imageDict, frame: true } as never),
        /the drawing already has its ACAD_WIPEOUT_VARS/,
      ],
      [(b) => b.addObject({ type: 'GROUP', owner: root } as never), /new object [0-9A-F]+/],
    ];
    for (const [change, message] of cases) {
      const model = open(bytes);
      edit(model, (b) => change(b, model));
      const original = readCadDocument(bytes);
      const before = documentInit(original);
      const problems = refusal(() => triyaToAcad(original, model, 'dxf'));
      expect(problems.join('\n'), String(message)).toMatch(message);
      expect(documentInit(original)).toEqual(before);
    }
  });

  it('refuses variables owned outside the root dictionary and new objects before R14', () => {
    const bare = drawing(ACadVersion.AC1032, 'dxf', { noVariables: true });
    const imageDict = dictionary(bare, CadDictionary.acadImageDict);
    const model = open(bare);
    edit(model, (b) =>
      b.addObject({ type: 'WIPEOUTVARIABLES', owner: imageDict, frame: true } as never),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(bare), model, 'dxf')).join()).toMatch(
      /WIPEOUTVARIABLES belongs in the root dictionary/,
    );

    // A drawing without the image dictionary: new definitions share the one the save makes.
    const none = drawing(ACadVersion.AC1032, 'dxf', { noImageDictionary: true });
    const m2 = open(none);
    edit(m2, (b) => {
      b.addObject(newDefinition('FFFF0', 'one'));
      b.addObject(newDefinition('FFFF1', 'two'));
    });
    expect(refusal(() => triyaToAcad(readCadDocument(none), m2, 'dxf')).join()).toMatch(
      /new image definitions name more than one new ACAD_IMAGE_DICT/,
    );

    const r13 = drawing(ACadVersion.AC1012, 'dxf', { noImageDictionary: true, noVariables: true });
    const m3 = open(r13);
    const root = dictionary(r13);
    edit(m3, (b) =>
      b.addObject({
        type: 'RASTERVARIABLES',
        owner: root,
        frame: true,
        quality: 'high',
        units: 0,
      } as never),
    );
    expect(refusal(() => triyaToAcad(readCadDocument(r13), m3, 'dxf')).join()).toMatch(
      /AC1012 has no raster images \(R14 introduced them\)/,
    );
  });
});
