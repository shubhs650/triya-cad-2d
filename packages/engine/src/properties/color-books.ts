// The colour books a drawing uses (M2-35 part 4), as the Select Color dialog's Color Books tab
// offers them: the Properties palette's Color row and EATTEDIT's Properties tab (M2-35 part 23).
// Triya ships no colour books (AutoCAD's .acb files are Autodesk's), so a book holds the colours
// of it the drawing uses. Kept apart from the property sheet so commands can offer them too.
import { bookColors } from '../model/book-colors';
import type { DocumentModel } from '../model/document';
import type { Color } from '../model/types';

export interface ColorBook {
  /** The book's name, as the drawing spells it: "RAL CLASSIC". */
  readonly name: string;
  readonly colors: readonly ColorBookColor[];
}

export interface ColorBookColor {
  /** The colour's name in its book: "RAL 3020". */
  readonly name: string;
  /** The Color row's value that sets it (`colorValue`). */
  readonly value: string;
  readonly rgb: readonly [number, number, number];
}

/** An entity colour as a choice value: `ByLayer`, `ByBlock`, `aci:n`, `rgb:r,g,b`. */
export function colorValue(c: Color): string {
  switch (c.kind) {
    case 'byLayer':
      return 'ByLayer';
    case 'byBlock':
      return 'ByBlock';
    case 'aci':
      return `aci:${c.index}`;
    case 'rgb':
      // A colour-book colour keeps its book and name in the value, so it is one choice.
      return `rgb:${c.r},${c.g},${c.b}${c.bookName ? `;${c.bookName};${c.colorName ?? ''}` : ''}`;
  }
}

/** `colorBooks` by drawing, kept while its version stands: a sheet follows every pick. */
const booksSeen = new WeakMap<DocumentModel, { version: number; books: ColorBook[] }>();

/** The colour books the drawing uses, by name, each with its colours by name (`ColorBook`). */
export function colorBooks(model: DocumentModel): ColorBook[] {
  const seen = booksSeen.get(model);
  if (seen?.version === model.version) return seen.books;
  const books = readColorBooks(model);
  booksSeen.set(model, { version: model.version, books });
  return books;
}

function readColorBooks(model: DocumentModel): ColorBook[] {
  const books = new Map<string, { name: string; colors: ColorBookColor[] }>();
  for (const c of bookColors(model).values()) {
    if (c.kind !== 'rgb' || c.bookName === undefined || !c.colorName) continue;
    const key = c.bookName.toUpperCase();
    const book = books.get(key) ?? { name: c.bookName, colors: [] };
    books.set(key, book);
    book.colors.push({ name: c.colorName, value: colorValue(c), rgb: [c.r, c.g, c.b] });
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  return [...books.values()]
    .map((b) => ({ name: b.name, colors: b.colors.sort(byName) }))
    .sort(byName);
}
