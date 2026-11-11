// TriyaToAcad for the image objects (M1-75 part 13): IMAGEDEF, RASTERVARIABLES and
// WIPEOUTVARIABLES, the inverse of map/images.ts. IMAGEATTACH adds a definition (and the IMAGE
// showing it, which the same save may add); the External References palette changes a
// definition's path and unloads or reloads it; IMAGEFRAME, IMAGEQUALITY and WIPEOUTFRAME change
// the drawing's ACAD_IMAGE_VARS and ACAD_WIPEOUT_VARS, which the first image or wipeout of a
// drawing creates. A definition is an entry of the ACAD_IMAGE_DICT dictionary named by the image
// name; a drawing without that dictionary gains it under the handle its new definitions name as
// their owner, as AutoCAD creates it with the first image. A renamed definition (the External
// References palette's rename) keeps its entry where it stands under the new name (M1-95); the
// IMAGEs showing it point at it by handle.
//
// PDFDEFINITION (M2-32 part 2) is written the same way, an entry of ACAD_PDFDEFINITIONS: a
// pasted underlay brings its definition, and the palette's path, page and rename edits keep it.
//
// Refused, before anything changes: removing one (IMAGE Detach also erases the images showing
// it, which the IMAGEDEF_REACTORs tie to it; not written yet), a new one before R14, which
// introduced raster images, values AutoCAD does not store, and xdata, reactor and extension
// dictionary changes.

import {
  ACadVersion,
  CadDictionary,
  ImageDefinition as AcadImageDefinition,
  ImageDisplayQuality,
  INamedCadObjectExtensions,
  PdfUnderlayDefinition as AcadPdfDefinition,
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
  PdfDefinition,
  RasterVariables,
  WipeoutVariables,
} from '@triya/engine';
import { resolve, same, type Resolver } from './entities';
import { entryRenameProblems, renameEntries } from './dictionary-entries';
import { changes } from './records';

type ImageObject = ImageDefinition | PdfDefinition | RasterVariables | WipeoutVariables;
type Definition = ImageDefinition | PdfDefinition;
/** An image object's fields by name, as `changes` compares them. */
type Fields = Record<string, unknown>;
type AcadImageObject =
  AcadImageDefinition | AcadPdfDefinition | AcadRasterVariables | AcadWipeoutVariables;

/** The object types this writer handles. */
export const IMAGE_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'IMAGEDEF',
  'PDFDEFINITION',
  'RASTERVARIABLES',
  'WIPEOUTVARIABLES',
]);

const isImageObject = (o: NonGraphicalObject | undefined): o is ImageObject =>
  o !== undefined && IMAGE_OBJECT_TYPES.has(o.type);

const isDefinition = (o: ImageObject): o is Definition =>
  o.type === 'IMAGEDEF' || o.type === 'PDFDEFINITION';

/**
 * Per definition type: the root dictionary entry holding the definitions, what the messages
 * call one, and the release that introduced it (R14 raster images, AutoCAD 2010 PDF underlays).
 */
const DEFINITION = {
  IMAGEDEF: {
    dictionary: CadDictionary.acadImageDict,
    noun: 'image',
    since: ACadVersion.AC1014,
    introduced: 'R14 introduced them',
    kind: 'raster images',
  },
  PDFDEFINITION: {
    dictionary: CadDictionary.acadPdfDefinitions,
    noun: 'PDF underlay',
    since: ACadVersion.AC1024,
    introduced: 'AutoCAD 2010 introduced them',
    kind: 'PDF underlays',
  },
} as const;

const ACAD_TYPE = {
  IMAGEDEF: AcadImageDefinition,
  PDFDEFINITION: AcadPdfDefinition,
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
/** WIPEOUTFRAME: off, on, displayed but not plotted (M2-24 part 2). */
const WIPEOUT_FRAMES: readonly unknown[] = [0, 1, 2];

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
   * ACAD_IMAGE_DICT or ACAD_PDFDEFINITIONS, or the handle of the one the save creates.
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
  isDefinition(o) ? `${o.type} ${String(o.name)}` : o.type;

const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/** A definition's name as names compare: by type, without regard to case. */
const nameKey = (type: string, name: unknown): string => `${type}:${String(name).toUpperCase()}`;

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
  const baseObjects = new Map((base.objects ?? []).map((o) => [o.handle, o]));
  const before = new Map(
    [...baseObjects].filter((e): e is [Handle, ImageObject] => isImageObject(e[1])),
  );

  for (const [h, b] of before) {
    const a = model.objects.get(h);
    const article = b.type === 'IMAGEDEF' ? 'an' : 'a';
    // (a PDFDEFINITION's removal, as an IMAGEDEF's, would leave the underlays showing it.)
    if (!a) problems.push(`${label(b)} (${h}): removing ${article} ${b.type}`);
    else if (a.type !== b.type) problems.push(`${label(b)} (${h}): type changes`);
  }

  // Definition names are unique without regard to case, among the definitions of their type
  // the drawing ends with.
  const names = new Map<string, number>();
  for (const o of model.objects.values()) {
    if (o.type !== 'IMAGEDEF' && o.type !== 'PDFDEFINITION') continue;
    const key = nameKey(o.type, (o as Definition).name);
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const newDictionaries = { IMAGEDEF: new Set<Handle>(), PDFDEFINITION: new Set<Handle>() };
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
      if (acad && isDefinition(b) && isDefinition(a) && b.name !== a.name)
        out.push(...renameProblems(acad, a, names, model, version));
      for (const k of UNSUPPORTED) if (!same(b[k], a[k])) out.push(`${k} changes`);
    } else {
      if (doc.getCadObject(Number.parseInt(h, 16))) out.push('the handle is already used');
      const since = isDefinition(a) ? DEFINITION[a.type] : DEFINITION.IMAGEDEF;
      if (known(version) && version < since.since)
        out.push(`${ACadVersion[version]} has no ${since.kind} (${since.introduced})`);
      // The save links a new object to the dictionary holding it, and makes nothing else.
      if (a.xdata !== undefined) out.push('xdata changes');
      if (a.extDict !== undefined) out.push('extDict changes');
      if (a.reactors !== undefined && !same(a.reactors, [a.owner])) out.push('reactors changes');
      if (isDefinition(a)) {
        const { dictionary: entry, noun } = DEFINITION[a.type];
        const dict = root?.get(entry);
        const which = a.type === 'IMAGEDEF' ? 'image' : 'PDF';
        if (dict instanceof CadDictionary) {
          if (a.owner !== hex(dict.handle))
            out.push(`a new ${which} definition belongs in ${entry} (${hex(dict.handle)})`);
        } else if (
          doc.getCadObject(Number.parseInt(a.owner, 16)) ||
          model.objects.has(a.owner) ||
          model.entityByHandle(a.owner)
        ) {
          out.push(`a new ${which} definition belongs in ${entry} (a new one: an unused handle)`);
        } else {
          newDictionaries[a.type].add(a.owner);
        }
        out.push(...nameProblems(a, noun, names, version));
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
      const dict = isDefinition(a) ? root?.get(DEFINITION[a.type].dictionary) : undefined;
      const dictionary = !isDefinition(a)
        ? undefined
        : dict instanceof CadDictionary
          ? dict
          : Number.parseInt(a.owner, 16);
      plan.added.push({ acad, after: a, ...(dictionary !== undefined ? { dictionary } : {}) });
      r.created.set(h, acad);
    }
  }
  if (newDictionaries.IMAGEDEF.size > 1)
    problems.push('new image definitions name more than one new ACAD_IMAGE_DICT');
  if (newDictionaries.PDFDEFINITION.size > 1)
    problems.push('new PDF definitions name more than one new ACAD_PDFDEFINITIONS');
  return { plan, problems };
}

/** Why a definition cannot take its name. */
function nameProblems(
  a: Definition,
  noun: string,
  names: ReadonlyMap<string, number>,
  version: ACadVersion | undefined,
): string[] {
  const name = a.name;
  if (typeof name !== 'string' || name === '') return [`${article(noun)} ${noun} needs a name`];
  if ((names.get(nameKey(a.type, name)) ?? 0) > 1) return [`another ${noun} is named ${name}`];
  if (!INamedCadObjectExtensions.isValidDxfName({ name } as never, version))
    return [`${JSON.stringify(name)} is not a valid ${noun} name`];
  return [];
}

/** Why a definition cannot be renamed (the External References palette's rename). */
function renameProblems(
  acad: AcadImageObject,
  a: Definition,
  names: ReadonlyMap<string, number>,
  model: DocumentModel,
  version: ACadVersion | undefined,
): string[] {
  const problems = nameProblems(a, DEFINITION[a.type].noun, names, version);
  if (problems.length > 0) return problems;
  return entryRenameProblems(
    acad,
    a.name,
    (o) => model.objects.get(hex(o.handle))?.type === a.type,
  );
}

/** What AutoCAD does not store in the fields that change. */
function valueProblems(b: ImageObject | undefined, a: ImageObject): string[] {
  const out: string[] = [];
  const changed = changes(b as unknown as Fields | undefined, a as unknown as Fields);
  const bool = (k: string, v: unknown) => {
    if (changed(k) && typeof v !== 'boolean')
      out.push(`${k}: ${JSON.stringify(v)} is not true or false`);
  };
  if (isDefinition(a) && changed('fileName')) {
    if (typeof a.fileName !== 'string')
      out.push(`fileName: ${JSON.stringify(a.fileName)} is not text`);
    else if (a.fileName === '') {
      const noun = DEFINITION[a.type].noun;
      out.push(`fileName: ${article(noun)} ${noun} needs its file`);
    }
  }
  if (a.type === 'PDFDEFINITION') {
    if (changed('page') && typeof a.page !== 'string')
      out.push(`page: ${JSON.stringify(a.page)} is not text`);
  } else if (a.type === 'IMAGEDEF') {
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
  } else if (changed('frame') && !WIPEOUT_FRAMES.includes(a.frame)) {
    out.push(
      `frame: ${JSON.stringify(a.frame)} is not 0 (off), 1 (on) or 2 (displayed but not plotted)`,
    );
  }
  return out;
}

function make(a: ImageObject): AcadImageObject {
  if (a.type === 'IMAGEDEF') return new AcadImageDefinition(a.name);
  if (a.type === 'PDFDEFINITION') {
    const d = new AcadPdfDefinition();
    d.name = a.name;
    return d;
  }
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
  } else if (a.type === 'PDFDEFINITION' && o instanceof AcadPdfDefinition) {
    if (changed('fileName')) o.file = a.fileName;
    if (changed('page')) o.page = a.page;
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
  // Renamed definitions first, as a new one may take a name one gives up.
  renameEntries(
    plan.updated
      .filter(
        ({ before, after }) => isDefinition(before) && before.name !== (after as Definition).name,
      )
      .map(({ acad, after }) => ({ acad, name: (after as Definition).name })),
  );
  for (const { acad, after, dictionary } of plan.added) {
    let dict: CadDictionary = root;
    if (typeof dictionary === 'number') {
      const entry = DEFINITION[(after as Definition).type].dictionary;
      const made = root.get(entry);
      if (made instanceof CadDictionary) dict = made;
      else {
        dict = new CadDictionary(entry);
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
