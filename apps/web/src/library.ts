// The library palette's state (M8-03): the items kept as favourites and those inserted lately,
// with the user's preferences, and what an item's block makes of the palette's preview and
// Insert. A kept item remembers the scale it was made at (what inches are multiplied by in its
// drawing), so a favourite from a drawing in millimetres is drawn the same size in one in inches.
import type { DesignCenterDrop, StylePreview } from '@triya/engine';
import {
  libraryEntry,
  rescaleLibraryItem,
  type LibraryBlock,
  type LibraryItem,
} from '@triya/library';

/** An item kept by the palette: a favourite, or one inserted lately. */
export interface KeptLibraryItem {
  /** Its catalogue entry's id. */
  readonly entry: string;
  readonly item: LibraryItem;
  /** The drawing's scale from inches when it was kept (`drawingScale`). */
  readonly scale: number;
  /** Its block's name then, which the palette shows it by. */
  readonly name: string;
}

export interface LibraryPreferences {
  readonly favorites: readonly KeptLibraryItem[];
  /** Newest first. */
  readonly recent: readonly KeptLibraryItem[];
}

export const DEFAULT_LIBRARY: LibraryPreferences = { favorites: [], recent: [] };

/** How many favourites are kept, and how many recent items (AutoCAD's Recent tab keeps a few). */
export const LIBRARY_LIMITS = { favorites: 100, recent: 10 } as const;

const KINDS = new Set(['flange', 'detail', 'weld', 'surface', 'notes']);

function keptItem(raw: unknown): KeptLibraryItem | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const item = r['item'] as { kind?: unknown; spec?: unknown } | undefined;
  if (
    typeof r['entry'] !== 'string' ||
    !libraryEntry(r['entry']) ||
    typeof r['name'] !== 'string' ||
    typeof r['scale'] !== 'number' ||
    !(Number.isFinite(r['scale']) && r['scale'] > 0) ||
    typeof item !== 'object' ||
    item === null ||
    !KINDS.has(item.kind as string) ||
    typeof item.spec !== 'object' ||
    item.spec === null
  )
    return undefined;
  // What the item says is checked by the drawing's engine when it is drawn.
  return { entry: r['entry'], item: item as LibraryItem, scale: r['scale'], name: r['name'] };
}

/** The stored library settings, or the defaults for what is not one. */
export function normalizeLibrary(raw: unknown): LibraryPreferences {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : [])
      .map(keptItem)
      .filter((k) => k !== undefined)
      .slice(0, max);
  return {
    favorites: list(r['favorites'], LIBRARY_LIMITS.favorites),
    recent: list(r['recent'], LIBRARY_LIMITS.recent),
  };
}

const same = (a: KeptLibraryItem, b: KeptLibraryItem) =>
  a.entry === b.entry && JSON.stringify(a.item) === JSON.stringify(b.item);

/** Whether `kept` is one of `list`: the same entry with the same item. */
export const isKept = (list: readonly KeptLibraryItem[], kept: KeptLibraryItem): boolean =>
  list.some((k) => same(k, kept));

/** Favourites with `kept` added at the end, or taken off when it is one. */
export function toggleFavorite(
  favorites: readonly KeptLibraryItem[],
  kept: KeptLibraryItem,
): KeptLibraryItem[] {
  if (isKept(favorites, kept)) return favorites.filter((k) => !same(k, kept));
  return [...favorites, kept].slice(-LIBRARY_LIMITS.favorites);
}

/** The recent items with `kept` first, once. */
export function rememberInserted(
  recent: readonly KeptLibraryItem[],
  kept: KeptLibraryItem,
): KeptLibraryItem[] {
  return [kept, ...recent.filter((k) => !same(k, kept))].slice(0, LIBRARY_LIMITS.recent);
}

/** A kept item as the drawing at `scale` draws it: its lengths in that drawing's units. */
export function keptFor(kept: KeptLibraryItem, scale: number): LibraryItem {
  return rescaleLibraryItem(kept.item, scale / kept.scale);
}

/** What the palette's preview draws for a block: the drawing's own, or the one copied out. */
export function libraryPreview(block: LibraryBlock | undefined): StylePreview | undefined {
  if (!block || block.error !== undefined) return undefined;
  if (block.existing !== undefined) return { kind: 'block', block: block.existing };
  return block.content && { kind: 'library', block: block.name, content: block.content };
}

/**
 * The INSUNITS code of a block copied out (its record's Block Unit), which INSERT converts into
 * the drawing's; undefined for the drawing's own block or none.
 */
export function libraryBlockUnits(block: LibraryBlock | undefined): number | undefined {
  if (!block?.content) return undefined;
  const upper = block.name.toUpperCase();
  const r = block.content.tables.blockRecords?.find((x) => x.name.toUpperCase() === upper);
  return r ? (r.units ?? 0) : undefined;
}

/**
 * What Insert asks of the drawing: the block copied out added (unless the drawing has its own)
 * and inserted at the point picked, one INSERT undo step.
 */
export function libraryDrop(block: LibraryBlock): DesignCenterDrop | undefined {
  if (block.error !== undefined || block.name === '') return undefined;
  return {
    items: block.content ? [{ category: 'blocks', name: block.name, content: block.content }] : [],
    insert: { block: block.name, onScreen: true },
    library: true,
  };
}
