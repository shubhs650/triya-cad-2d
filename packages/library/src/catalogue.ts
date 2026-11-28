// The library palette's catalogue (M8-03): one entry per generator the library has, each with
// the words it is found by and its defaults at a drawing's units, and one way to make any of
// them as a block. The palette lists, searches and previews entries; the drawing's engine makes
// the block (`libraryBlock`), copied out as DesignCenter copies a block (`designCenterItem`) so
// the drawing's own insert adds and inserts it, or names the drawing's own block when it has it.
import {
  ChangeSetBuilder,
  designCenterItem,
  previewDrawing,
  type Clipboard,
  type DocumentModel,
  type Handle,
} from '@triya/engine';
import { blockNamed, drawingScale } from './block';
import {
  addDetailBlock,
  checkDetail,
  detailBlockName,
  detailDefaults,
  detailDescription,
  type DetailGenerator,
} from './details/detail';
import { NOZZLE_SET_IN, NOZZLE_SET_ON } from './details/nozzle';
import { ANCHOR_CHAIR, BRACKET, LEG, SADDLE, SKIRT } from './details/supports';
import {
  FLANGE_TYPE_NAMES,
  b165Flange,
  b165Sizes,
  npsLabel,
  type B165Spec,
  type FlangeType,
} from './flanges/b16-5';
import { addFlangeBlock, flangeBlockName, flangeDescription } from './flanges/block';
import type { FlangeView } from './flanges/draw';
import {
  addStandardNotesBlock,
  checkStandardNotes,
  drawingUnits,
  standardNotesBlockName,
  standardNotesDefaults,
  type DrawingUnits,
  type StandardNotesSpec,
} from './notes/notes';
import {
  addSurfaceFinishBlock,
  checkSurfaceFinish,
  surfaceFinishDefaults,
  surfaceFinishDescription,
  surfaceFinishName,
  type SurfaceFinishSpec,
  type SurfaceStandard,
} from './surface/surface';
import { currentTextStyle } from './texts';
import {
  addWeldSymbolBlock,
  checkWeldSymbol,
  weldSymbolDefaults,
  weldSymbolDescription,
  weldSymbolName,
  type WeldStandard,
  type WeldSymbolSpec,
} from './welds/weld';

/** Something the library draws, with everything it is drawn from (lengths in drawing units). */
export type LibraryItem =
  | { readonly kind: 'flange'; readonly spec: B165Spec; readonly view: FlangeView }
  | {
      readonly kind: 'detail';
      /** The generator's id: `SADDLE`. */
      readonly generator: string;
      readonly spec: Readonly<Record<string, number>>;
    }
  | { readonly kind: 'weld'; readonly spec: WeldSymbolSpec }
  | { readonly kind: 'surface'; readonly spec: SurfaceFinishSpec }
  | { readonly kind: 'notes'; readonly spec: StandardNotesSpec };

/** The palette's groups, in its order. */
export const LIBRARY_GROUPS = [
  'Flanges',
  'Nozzles',
  'Supports',
  'Welding',
  'Surface texture',
  'Notes',
] as const;

export type LibraryGroup = (typeof LIBRARY_GROUPS)[number];

/** What an entry's defaults are made for: the drawing's scale from inches and its units. */
export interface LibraryContext {
  /** What inches are multiplied by to draw in the drawing's units (`drawingScale`). */
  readonly scale: number;
  readonly units: DrawingUnits;
}

export interface LibraryEntry {
  readonly id: string;
  readonly title: string;
  readonly group: LibraryGroup;
  /** The standard it follows, or '' for a part the drafter sizes. */
  readonly standard: string;
  /** More words it is found by. */
  readonly keywords: readonly string[];
  /** Its item with the library's defaults, in the drawing's units. */
  defaults(context: LibraryContext): LibraryItem;
}

/** A generator of its own keys as one of any: the palette reads its fields to know them. */
const anyDetail = (g: object) => g as DetailGenerator;

/** The library's detail generators, by id. */
export const DETAIL_GENERATORS: readonly DetailGenerator[] = [
  NOZZLE_SET_IN,
  NOZZLE_SET_ON,
  SADDLE,
  LEG,
  BRACKET,
  SKIRT,
  ANCHOR_CHAIR,
].map(anyDetail);

export function detailGenerator(id: string): DetailGenerator | undefined {
  return DETAIL_GENERATORS.find((g) => g.id === id);
}

/** Class 150 NPS 4, or the type's nearest size to it in Class 150 (socket welding: NPS 3). */
function flangeEntry(type: FlangeType, keywords: readonly string[]): LibraryEntry {
  const name = FLANGE_TYPE_NAMES[type];
  return {
    id: `flange-${type}`,
    title: `${name[0]!.toUpperCase()}${name.slice(1)} flange`,
    group: 'Flanges',
    standard: 'ASME B16.5',
    keywords: [type, 'flange', 'pipe', ...keywords],
    defaults: () => {
      const sizes = b165Sizes(150, type);
      const nps = sizes.includes(4) ? 4 : sizes.at(-1)!;
      return { kind: 'flange', spec: { flangeClass: 150, nps, type }, view: 'front' };
    },
  };
}

function detailEntry(
  id: string,
  generator: object,
  group: LibraryGroup,
  keywords: readonly string[],
): LibraryEntry {
  const g = anyDetail(generator);
  return {
    id,
    title: g.label,
    group,
    standard: '',
    keywords: [g.view, ...keywords],
    defaults: ({ scale }) => ({ kind: 'detail', generator: g.id, spec: detailDefaults(g, scale) }),
  };
}

function weldEntry(standard: WeldStandard): LibraryEntry {
  return {
    id: `weld-${standard.toLowerCase()}`,
    title: `Weld symbol (${standard === 'AWS' ? 'AWS A2.4' : 'ISO 2553'})`,
    group: 'Welding',
    standard: standard === 'AWS' ? 'AWS A2.4' : 'ISO 2553',
    keywords: ['welding symbol', 'fillet', 'groove', standard === 'AWS' ? 'american' : 'system a'],
    defaults: ({ scale }) => {
      const d = weldSymbolDefaults(scale);
      return {
        kind: 'weld',
        spec:
          standard === 'AWS' ? d : { ...d, standard, arrowSide: { type: 'fillet', size: 'a5' } },
      };
    },
  };
}

function surfaceEntry(standard: SurfaceStandard): LibraryEntry {
  const name = standard === 'ASME' ? 'ASME Y14.36' : 'ISO 1302';
  return {
    id: `surface-${standard.toLowerCase()}`,
    title: `Surface texture symbol (${name})`,
    group: 'Surface texture',
    standard: name,
    keywords: ['surface finish', 'roughness', 'Ra', 'machined', 'lay'],
    defaults: ({ scale }) => ({ kind: 'surface', spec: surfaceFinishDefaults(scale, standard) }),
  };
}

export const LIBRARY_ENTRIES: readonly LibraryEntry[] = [
  flangeEntry('WN', ['WN', 'welding neck', 'hub']),
  flangeEntry('SO', ['slip on']),
  flangeEntry('BL', ['blank', 'cover']),
  flangeEntry('LJ', ['lapped', 'stub end']),
  flangeEntry('SW', ['socket weld']),
  flangeEntry('TH', ['threaded', 'screwed']),
  detailEntry('nozzle-set-in', NOZZLE_SET_IN, 'Nozzles', [
    'nozzle',
    'set through',
    'reinforcing pad',
  ]),
  detailEntry('nozzle-set-on', NOZZLE_SET_ON, 'Nozzles', ['nozzle', 'reinforcing pad']),
  detailEntry('saddle', SADDLE, 'Supports', ['horizontal vessel', 'wear plate']),
  detailEntry('leg', LEG, 'Supports', ['vertical vessel']),
  detailEntry('bracket', BRACKET, 'Supports', ['lug', 'vertical vessel']),
  detailEntry('skirt', SKIRT, 'Supports', ['base ring', 'vertical vessel']),
  detailEntry('anchor-chair', ANCHOR_CHAIR, 'Supports', ['anchor bolt', 'support', 'skirt']),
  weldEntry('AWS'),
  weldEntry('ISO'),
  surfaceEntry('ASME'),
  surfaceEntry('ISO'),
  {
    id: 'notes',
    title: 'Standard notes',
    group: 'Notes',
    standard: '',
    keywords: ['general notes', 'block', 'mtext'],
    defaults: ({ scale }) => ({ kind: 'notes', spec: standardNotesDefaults(scale) }),
  },
];

export function libraryEntry(id: string): LibraryEntry | undefined {
  return LIBRARY_ENTRIES.find((e) => e.id === id);
}

/** The words an entry is found by, in lower case. */
const words = (e: LibraryEntry): string =>
  [e.id, e.title, e.group, e.standard, ...e.keywords].join(' ').toLowerCase();

/**
 * The entries the search finds, in the catalogue's order: those holding every word of `query`
 * (any order, any case) in their title, group, standard or keywords; all of them for none.
 */
export function searchLibrary(
  query: string,
  entries: readonly LibraryEntry[] = LIBRARY_ENTRIES,
): LibraryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    const said = words(e);
    return terms.every((t) => said.includes(t));
  });
}

/** The drawing's context for an entry's defaults. */
export function libraryContext(model: DocumentModel): LibraryContext {
  return { scale: drawingScale(model), units: drawingUnits(model) };
}

/**
 * `item` drawn `factor` times as large: its lengths (a detail's length fields, a symbol's text
 * height, reference line, leader and extension, the notes' height and width) multiplied, so an
 * item kept from a drawing in one unit is drawn the same size in another. A flange's sizes are
 * its standard's, in inches, and stay.
 */
export function rescaleLibraryItem(item: LibraryItem, factor: number): LibraryItem {
  if (factor === 1) return item;
  switch (item.kind) {
    case 'flange':
      return item;
    case 'detail': {
      const g = detailGenerator(item.generator);
      if (!g) return item;
      const spec: Record<string, number> = { ...item.spec };
      for (const f of g.fields) {
        if (f.kind === 'length' && typeof spec[f.key] === 'number')
          spec[f.key] = spec[f.key]! * factor;
      }
      return { ...item, spec };
    }
    case 'weld': {
      const { height, referenceLength, leaderLength } = item.spec;
      return {
        ...item,
        spec: {
          ...item.spec,
          height: height * factor,
          referenceLength: referenceLength * factor,
          leaderLength: leaderLength * factor,
        },
      };
    }
    case 'surface': {
      const { height, extensionLength } = item.spec;
      return {
        ...item,
        spec: { ...item.spec, height: height * factor, extensionLength: extensionLength * factor },
      };
    }
    case 'notes': {
      const { height, width } = item.spec;
      return { ...item, spec: { ...item.spec, height: height * factor, width: width * factor } };
    }
  }
}

/** Why `item` makes no block, or undefined when it does. */
export function checkLibraryItem(item: LibraryItem): string | undefined {
  switch (item.kind) {
    case 'flange': {
      const { flangeClass, nps, type } = item.spec;
      return b165Flange(item.spec)
        ? undefined
        : `ASME B16.5 has no Class ${flangeClass} NPS ${npsLabel(nps)} ${FLANGE_TYPE_NAMES[type]} flange`;
    }
    case 'detail': {
      const g = detailGenerator(item.generator);
      return g ? checkDetail(g, item.spec) : `${item.generator} is not a library detail`;
    }
    case 'weld':
      return checkWeldSymbol(item.spec);
    case 'surface':
      return checkSurfaceFinish(item.spec);
    case 'notes':
      return checkStandardNotes(item.spec);
  }
}

/** The block's name `item` makes in `model`, or '' when it makes none. */
export function libraryItemName(model: DocumentModel, item: LibraryItem): string {
  if (checkLibraryItem(item) !== undefined) return '';
  switch (item.kind) {
    case 'flange':
      return flangeBlockName(item.spec, item.view);
    case 'detail':
      return detailBlockName(detailGenerator(item.generator)!, item.spec);
    case 'weld':
      return weldSymbolName(item.spec);
    case 'surface':
      return surfaceFinishName(item.spec);
    case 'notes':
      return standardNotesBlockName(item.spec, drawingUnits(model));
  }
}

/** What `item` is, in words: its block's description. */
export function libraryItemDescription(model: DocumentModel, item: LibraryItem): string {
  if (checkLibraryItem(item) !== undefined) return '';
  switch (item.kind) {
    case 'flange':
      return flangeDescription(b165Flange(item.spec)!, item.view);
    case 'detail':
      return detailDescription(detailGenerator(item.generator)!, item.spec);
    case 'weld':
      return weldSymbolDescription(item.spec);
    case 'surface':
      return surfaceFinishDescription(item.spec);
    case 'notes':
      return `Standard notes: ${item.spec.notes.length} under "${item.spec.heading}" in ${drawingUnits(model).name.toLowerCase()}`;
  }
}

/**
 * The handle of the drawing's block for `item`, adding it when the drawing lacks it; undefined,
 * with nothing added, when the item makes no block (or needs a text style the drawing lacks).
 */
export function addLibraryBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  item: LibraryItem,
): Handle | undefined {
  if (checkLibraryItem(item) !== undefined) return undefined;
  switch (item.kind) {
    case 'flange':
      return addFlangeBlock(b, model, item.spec, item.view);
    case 'detail':
      return addDetailBlock(b, model, detailGenerator(item.generator)!, item.spec);
    case 'weld':
      return addWeldSymbolBlock(b, model, item.spec);
    case 'surface':
      return addSurfaceFinishBlock(b, model, item.spec);
    case 'notes':
      return addStandardNotesBlock(b, model, item.spec);
  }
}

/** What the palette previews and inserts for an item in a drawing. */
export interface LibraryBlock {
  /** The block's name; '' when the item makes none. */
  readonly name: string;
  /** The drawing's own block of that name, which is inserted as it is. */
  readonly existing?: Handle;
  /** The block copied out, with what it names, for a drawing without it. */
  readonly content?: Clipboard;
  /** Why the item makes no block. */
  readonly error?: string;
}

/**
 * `item` as a block for `model`: the drawing's own block when it has one of the name, else the
 * block drawn in its units (so it is inserted at scale 1) on a copy of its tables and copied out,
 * as DesignCenter copies a block, for the drawing's engine to add as it inserts it.
 */
export function libraryBlock(model: DocumentModel, item: LibraryItem): LibraryBlock {
  const error =
    checkLibraryItem(item) ??
    (item.kind !== 'flange' && item.kind !== 'detail' && currentTextStyle(model) === undefined
      ? 'The drawing has no text style'
      : undefined);
  if (error !== undefined) return { name: '', error };
  const name = libraryItemName(model, item);
  const own = blockNamed(model, name);
  if (own && model.hasBlock(own)) return { name, existing: own };
  // Only the tables: the drawing's blocks are not copied, and the new one names none of them.
  const pm = previewDrawing(model, new Set());
  if (!pm) return { name: '', error: 'The drawing has no model space' };
  const b = new ChangeSetBuilder(pm);
  const handle = addLibraryBlock(b, pm, item);
  if (handle === undefined) return { name: '', error: `${name} could not be drawn` };
  pm.apply(b.build());
  const copied = designCenterItem(pm, 'blocks', name);
  return copied
    ? { name, content: copied.content }
    : { name: '', error: `${name} could not be copied` };
}

/** What the library palette asks of a drawing's engine: its context, and an item's block. */
export interface LibraryAnswer {
  readonly context: LibraryContext;
  readonly block?: LibraryBlock;
}

export function libraryAnswer(model: DocumentModel, item?: LibraryItem): LibraryAnswer {
  const context = libraryContext(model);
  return item ? { context, block: libraryBlock(model, item) } : { context };
}
