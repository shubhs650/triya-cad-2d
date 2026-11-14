// M2-35 part 19: a layer's colour-book colour. AutoCAD writes it as the LAYER's 420 true colour
// and 430 colour name, `BOOK$COLOR`, with no DBCOLOR (DXF reference, LAYER; ACadSharp's samples,
// R2004 to R2018, have Layer_color_book in DIC COLOR GUIDE(R)$DIC 7; the R2000 save keeps its
// RGB only, as an R2000 LAYER has no 430). Every ASCII DXF of the
// public corpus maps each LAYER 430 to the layer's `bookName`/`colorName`, each binary DXF maps
// alike to its ASCII save, and the AC1032 DXF save (DEC-047) writes them back (acad-ts patch
// 0181: the reader dropped 430 and the writer never wrote it, so every save lost them).
// DWG files are not read for it (DEC-047: no new DWG work).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DocumentModel } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Each LAYER's 430 by layer name, read from an ASCII DXF's own groups. */
function rawNames(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const out = new Map<string, string>();
  let inLayer = false;
  let name: string | undefined;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (code === '0') {
      inLayer = value === 'LAYER';
      name = undefined;
    } else if (inLayer && code === '2') name = value;
    else if (inLayer && code === '430' && name !== undefined) out.set(name, value);
  }
  return out;
}

/** Each layer's colour-book colour as Triya maps it, `BOOK$COLOR` by layer name. */
function mapped(bytes: Uint8Array): Map<string, string> {
  const layers = documentInit(readCadDocument(bytes)).tables?.layers ?? [];
  return new Map(
    layers.flatMap((l) =>
      l.color.kind === 'rgb' && l.color.bookName !== undefined
        ? [[l.name, `${l.color.bookName}$${l.color.colorName ?? ''}`] as const]
        : [],
    ),
  );
}

const read = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe("layers' colour-book colours on the public corpus", () => {
  const ascii = readable.filter((f) => f.format === 'dxf-ascii');
  const booked = ascii.filter((f) => rawNames(text(read(f.path))).size > 0);

  it('finds the ACadSharp samples with a colour-book layer', () => {
    // R2004 to R2018: AC1018, AC1021, AC1024, AC1027, AC1032.
    expect(booked.length).toBeGreaterThanOrEqual(5);
  });

  it.each(ascii.map((f) => [f.path] as const))('maps every LAYER 430 of %s', (path) => {
    const bytes = read(path);
    expect(mapped(bytes)).toEqual(rawNames(text(bytes)));
  });

  it('maps each binary DXF alike to its ASCII save', () => {
    const pairs = readable
      .filter((f) => f.format === 'dxf-binary' && f.path.endsWith('_binary.dxf'))
      .map((f) => [f.path, f.path.replace(/_binary\.dxf$/, '_ascii.dxf')] as const)
      .filter(([, a]) => booked.some((f) => f.path === a));
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    for (const [binary, a] of pairs) expect(mapped(read(binary)), binary).toEqual(mapped(read(a)));
  });

  it.each(booked.map((f) => [f.path] as const))('saves them back as AC1032 DXF: %s', (path) => {
    const bytes = read(path);
    const original = readCadDocument(bytes);
    const model = DocumentModel.create(documentInit(original));
    const saved = saveAc1032Dxf(original, model);
    const want = rawNames(text(bytes));
    expect(rawNames(text(saved))).toEqual(want);
    expect(mapped(saved)).toEqual(want);
  });
});
