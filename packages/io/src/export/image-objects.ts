// TriyaToAcad for the image objects (M1-75 part 13): IMAGEDEF, RASTERVARIABLES and
// WIPEOUTVARIABLES, the inverse of map/images.ts. IMAGEATTACH adds a definition (and the IMAGE
// showing it, which the same save may add); the External References palette changes a
// definition's path and unloads or reloads it; IMAGEFRAME, IMAGEQUALITY and WIPEOUTFRAME change
// the drawing's ACAD_IMAGE_VARS and ACAD_WIPEOUT_VARS, which the first image or wipeout of a
// drawing creates. A definition is an entry of the ACAD_IMAGE_DICT dictionary named by the image
// name; a drawing without that dictionary gains it under the handle its new definitions name as
// their owner, as AutoCAD creates it with the first image.
//
// Refused, before anything changes: removing one (IMAGE Detach also erases the images showing
// it, which the IMAGEDEF_REACTORs tie to it; not written yet), renaming a definition (acad-ts's
// dictionary keys an entry by the name it was added under, M1-95), a new one before R14, which
// introduced raster images, values AutoCAD does not store, and xdata, reactor and extension
// dictionary changes.

import {
  ACadVersion,
  CadDictionary,
  ImageDefinition as AcadImageDefinition,
  ImageDisplayQuality,
  INamedCadObjectExtensions,
  RasterVariables as AcadRasterVariables,
  WipeoutVariables as AcadWipeoutVariables,
  XY,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import type {
  DocumentInit,
  DocumentModel,
  Handle,
  ImageDefinition,
  NonGraphicalObject,
  RasterVariables,
  WipeoutVariables,
} from '@triya/engine';
import { resolve, same, type Resolver } from './entities';
import { changes } from './records';

type ImageObject = ImageDefinition | RasterVariables | WipeoutVariables;
/** An image object's fields by name, as `changes` compares them. */
type Fields = Record<string, unknown>;
type AcadImageObject = AcadImageDefinition | AcadRasterVariables | AcadWipeoutVariables;

/** The object types this writer handles. */
export const IMAGE_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'IMAGEDEF',
  'RASTERVARIABLES',
  'WIPEOUTVARIABLES',
]);

const isImageObject = (o: NonGraphicalObject | undefined): o is ImageObject =>
  o !== undefined && IMAGE_OBJECT_TYPES.has(o.type);

const ACAD_TYPE = {
  IMAGEDEF: AcadImageDefinition,
  RASTERVARIABLES: AcadRasterVariables,
  WIPEOUTVARIABLES: AcadWipeoutVariables,
} as const;

/** The root dictionary entries holding the drawing's one RASTERVARIABLES / WIPEOUTVARIABLES. */
const ENTRY = {
  RASTERVARIABLES: 'ACAD_IMAGE_VARS',
  WIPEOUTVARIABLES: 'ACAD_WIPEOUT_VARS',
} as const;

/** DXF 281: resolution units 0 none, 2 centimetres, 5 inches (AutoCAD's only values). */
const RESOLUTION_UNITS: readonly number[] = [0, 2, 5];

/** DXF RASTERVARIABLES 72: insertion units 0 none, 1 millimetres … 8 miles. */
const INSERTION_UNITS: readonly [number, number] = [0, 8];

/** Fields no writer handles yet. */
const UNSUPPORTED = ['xdata', 'reactors', 'extDict'] as const;

export interface ImageObjectsPlan {
  readonly updated: {
    readonly acad: AcadImageObject;
    readonly before: ImageObject;
    readonly after: ImageObject;
  }[];
  /**
   * New objects, already holding their handle; a new definition's `dictionary` is the drawing's
   * ACAD_IMAGE_DICT, or the handle of the one the save creates.
   */
  readonly added: {
    readonly acad: AcadImageObject;
    readonly after: ImageObject;
    readonly dictionary?: CadDictionary | number;
  }[];
}

const known = (v: ACadVersion | undefined): v is ACadVersion =>
  v !== undefined && v !== ACadVersion.Unknown;

const hex = (n: number): Handle => n.toString(16).toUpperCase();

const label = (o: ImageObject): string =>
  o.type === 'IMAGEDEF' ? `IMAGEDEF ${String(o.name)}` : o.type;

/** The model's image object changes against the original's mapping, and why any cannot be written. */
export function planImageObjects(
  doc: CadDocument,
  base: DocumentInit,
  model: DocumentModel,
  r: Resolver & { readonly created: Map<Handle, CadObject> },
): { plan: ImageObjectsPlan; problems: string[] } {
  const plan: ImageObjectsPlan = { updated: [], added: [] };
  const problems: string[] = [];
  const version = doc.header?.version;
  const root = doc.rootDictionary;
  const imageDict = root?.get(CadDictionary.acadImageDict);
  const baseObjects = new Map((base.objects ?? []).map((o) => [o.handle, o]));
  const before = new Map(
    [...baseObjects].filter((e): e is [Handle, ImageObject] => isImageObject(e[1])),
  );

  for (const [h, b] of before) {
    const a = model.objects.get(h);
    const article = b.type === 'IMAGEDEF' ? 'an' : 'a';
    if (!a) problems.push(`${label(b)} (${h}): removing ${article} ${b.type}`);
    else if (a.type !== b.type) problems.push(`${label(b)} (${h}): type changes`);
  }

  // Image names are unique without regard to case, among the definitions the drawing ends with.
  const names = new Map<string, number>();
  for (const o of model.objects.values()) {
    if (o.type !== 'IMAGEDEF') continue;
    const key = String((o as ImageDefinition).name).toUpperCase();
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const newDictionaries = new Set<Handle>();
  // A drawing has one RASTERVARIABLES and one WIPEOUTVARIABLES.
  const added = new Map<string, number>();
  for (const o of model.objects.values())
    if (isImageObject(o) && !baseObjects.has(o.handle))
      added.set(o.type, (added.get(o.type) ?? 0) + 1);

  for (const a of model.objects.values()) {
    if (!isImageObject(a)) continue;
    const h = a.handle;
    const b = before.get(h);
    if (b && (b.type !== a.type || same(b, a))) continue;
    if (!b && baseObjects.has(h)) continue; // another object's type change, reported by its writer
    const out: string[] = [];
    let acad: AcadImageObject | undefined;
    if (b) {
      acad = resolve(r, h, ACAD_TYPE[a.type] as abstract new (...args: never[]) => AcadImageObject);
      if (!acad) out.push(`the original is not a ${a.type}`);
      if (b.owner !== a.owner) out.push('owner changes');
      if (b.type === 'IMAGEDEF' && b.name !== (a as ImageDefinition).name)
        out.push('acad-ts cannot rename a dictionary entry in place (M1-95)');
      for (const k of UNSUPPORTED) if (!same(b[k], a[k])) out.push(`${k} changes`);
    } else {
      if (doc.getCadObject(Number.parseInt(h, 16))) out.push('the handle is already used');
      if (known(version) && version < ACadVersion.AC1014)
        out.push(`${ACadVersion[version]} has no raster images (R14 introduced them)`);
      // The save links a new object to the dictionary holding it, and makes nothing else.
      if (a.xdata !== undefined) out.push('xdata changes');
      if (a.extDict !== undefined) out.push('extDict changes');
      if (a.reactors !== undefined && !same(a.reactors, [a.owner])) out.push('reactors changes');
      if (a.type === 'IMAGEDEF') {
        if (imageDict instanceof CadDictionary) {
          if (a.owner !== hex(imageDict.handle))
            out.push(
              `a new image definition belongs in ACAD_IMAGE_DICT (${hex(imageDict.handle)})`,
            );
        } else if (
          doc.getCadObject(Number.parseInt(a.owner, 16)) ||
          model.objects.has(a.owner) ||
          model.entityByHandle(a.owner)
        ) {
          out.push(
            'a new image definition belongs in ACAD_IMAGE_DICT (a new one: an unused handle)',
          );
        } else {
          newDictionaries.add(a.owner);
        }
        const name = (a as ImageDefinition).name;
        if (typeof name !== 'string' || name === '') out.push('an image needs a name');
        else if ((names.get(name.toUpperCase()) ?? 0) > 1)
          out.push(`another image is named ${name}`);
        else if (!INamedCadObjectExtensions.isValidDxfName({ name } as never, version))
          out.push(`${JSON.stringify(name)} is not a valid image name`);
      } else {
        const entry = ENTRY[a.type];
        if (!root || a.owner !== hex(root.handle))
          out.push(`a ${a.type} belongs in the root dictionary`);
        if (root?.get(entry) || (added.get(a.type) ?? 0) > 1)
          out.push(`the drawing already has its ${entry}`);
      }
    }
    out.push(...valueProblems(b, a));
    if (out.length > 0) {
      problems.push(...out.map((p) => `${label(a)} (${h}): ${p}`));
    } else if (b) {
      plan.updated.push({ acad: acad!, before: b, after: a });
    } else {
      acad = make(a);
      // acad-ts keeps a non-zero handle it has not seen, so the object keeps Triya's handle.
      acad.handle = Number.parseInt(h, 16);
      const dictionary =
        a.type !== 'IMAGEDEF'
          ? undefined
          : imageDict instanceof CadDictionary
            ? imageDict
            : Number.parseInt(a.owner, 16);
      plan.added.push({ acad, after: a, ...(dictionary !== undefined ? { dictionary } : {}) });
      r.created.set(h, acad);
    }
  }
  if (newDictionaries.size > 1)
    problems.push('new image definitions name more than one new ACAD_IMAGE_DICT');
  return { plan, problems };
}

/** What AutoCAD does not store in the fields that change. */
function valueProblems(b: ImageObject | undefined, a: ImageObject): string[] {
  const out: string[] = [];
  const changed = changes(b as unknown as Fields | undefined, a as unknown as Fields);
  const bool = (k: string, v: unknown) => {
    if (changed(k) && typeof v !== 'boolean')
      out.push(`${k}: ${JSON.stringify(v)} is not true or false`);
  };
  if (a.type === 'IMAGEDEF') {
    if (changed('fileName')) {
      if (typeof a.fileName !== 'string')
        out.push(`fileName: ${JSON.stringify(a.fileName)} is not text`);
      else if (a.fileName === '') out.push('fileName: an image needs its file');
    }
    for (const k of ['size', 'pixelSize'] as const) {
      const v = a[k];
      if (
        changed(k) &&
        ![v?.x, v?.y].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
      )
        out.push(`${k}: each value is a number more than 0`);
    }
    bool('loaded', a.loaded);
    if (changed('units') && !RESOLUTION_UNITS.includes(a.units))
      out.push(`units: ${JSON.stringify(a.units)} is not 0 (none), 2 (centimetres) or 5 (inches)`);
  } else if (a.type === 'RASTERVARIABLES') {
    bool('frame', a.frame);
    if (changed('quality') && a.quality !== 'draft' && a.quality !== 'high')
      out.push(`quality: ${JSON.stringify(a.quality)} is not draft or high`);
    const [min, max] = INSERTION_UNITS;
    if (changed('units') && !(Number.isInteger(a.units) && a.units >= min && a.units <= max))
      out.push(`units: ${JSON.stringify(a.units)} is not a whole number from ${min} to ${max}`);
  } else {
    bool('frame', a.frame);
  }
  return out;
}

function make(a: ImageObject): AcadImageObject {
  if (a.type === 'IMAGEDEF') return new AcadImageDefinition(a.name);
  if (a.type === 'RASTERVARIABLES') return new AcadRasterVariables(ENTRY.RASTERVARIABLES);
  return new AcadWipeoutVariables(ENTRY.WIPEOUTVARIABLES);
}

/** Writes the fields of `a` that differ from `b` (every one when `b` is undefined). */
function writeImageObject(o: AcadImageObject, b: ImageObject | undefined, a: ImageObject): void {
  const changed = changes(b as unknown as Fields | undefined, a as unknown as Fields);
  if (a.type === 'IMAGEDEF' && o instanceof AcadImageDefinition) {
    if (changed('fileName')) o.fileName = a.fileName;
    if (changed('size')) o.size = new XY(a.size.x, a.size.y);
    if (changed('pixelSize')) o.defaultSize = new XY(a.pixelSize.x, a.pixelSize.y);
    if (changed('loaded')) o.isLoaded = a.loaded;
    if (changed('units')) o.units = a.units;
  } else if (a.type === 'RASTERVARIABLES' && o instanceof AcadRasterVariables) {
    if (changed('frame')) o.isDisplayFrameShown = a.frame;
    if (changed('quality'))
      o.displayQuality =
        a.quality === 'draft' ? ImageDisplayQuality.Draft : ImageDisplayQuality.High;
    if (changed('units')) o.units = a.units;
  } else if (a.type === 'WIPEOUTVARIABLES' && o instanceof AcadWipeoutVariables) {
    if (changed('frame')) o.displayImageFrame = a.frame;
  }
}

/**
 * Writes the planned image object changes onto `doc`; new ones join their dictionary first
 * (ACAD_IMAGE_DICT, made under the engine's handle when the drawing has none, or the root).
 * Before the entities, so a new IMAGE can show a new definition.
 */
export function writeImageObjects(doc: CadDocument, plan: ImageObjectsPlan): void {
  const root = doc.rootDictionary!;
  for (const { acad, after, dictionary } of plan.added) {
    let dict: CadDictionary = root;
    if (typeof dictionary === 'number') {
      const made = root.get(CadDictionary.acadImageDict);
      if (made instanceof CadDictionary) dict = made;
      else {
        dict = new CadDictionary(CadDictionary.acadImageDict);
        dict.handle = dictionary;
        root.add(dict);
      }
    } else if (dictionary) {
      dict = dictionary;
    }
    dict.add(acad);
    writeImageObject(acad, undefined, after);
  }
  for (const { acad, before, after } of plan.updated) writeImageObject(acad, before, after);
}
