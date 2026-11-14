// M1-41 part 1 on the public corpus: every TEXT and MTEXT, in model space, layouts and block
// definitions (dimension text, table cells), draws through the text engine with finite
// coordinates, near its insertion point. No real font is committed (CLAUDE.md "No Autodesk
// assets"), so every style falls back to a stand-in font through FONTALT: a 1 × 1 square for
// each printable ASCII character, which checks placement and layout, not glyph shapes. The
// comparison against AutoCAD plots is M1-41's acceptance, with M1-24 and M1-26.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import { boxesOverlap, type Box, type EntityId } from '@triya/engine';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  attributeShown,
  attributeText,
  defaultPaint,
  expandInsert,
  primitivesBox,
  tessellate,
  textBounds,
  type BlockSource,
} from '@triya/render';
import { FontBook, parseShx, SHX_EQUIVALENTS, styleFont } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';
import { bundledFontBook } from './bundled-fonts.ts';
import { squareFont } from './square-font.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

/** The move/line targets and curve centres of a path. */
function* coordinates(path: readonly number[]): Generator<[number, number]> {
  const size = { [PATH_M]: 2, [PATH_L]: 2, [PATH_A]: 6, [PATH_E]: 8, [PATH_Q]: 4, [PATH_C]: 6 };
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    if (op !== 4) yield [path[i + 1]!, path[i + 2]!];
    i += 1 + (size[op as keyof typeof size] ?? 0);
  }
}

describe('text on the public corpus (M1-41, M1-35)', () => {
  const readable = readableFiles(manifest);

  it('draws every TEXT and MTEXT near its insertion point with the stand-in font', () => {
    const fonts = new FontBook({ alternate: 'square' });
    fonts.addShx('square', parseShx(squareFont()));
    const drawn = { TEXT: 0, MTEXT: 0, backgrounds: 0, frames: 0 };
    const blank: string[] = [];
    const wrong: string[] = [];
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      const { model } = corpusDrawing(doc);
      const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
      for (const block of model.blocks.keys()) {
        for (const id of model.blockEntities(block)) {
          const e = model.entity(id);
          const g = e?.geom;
          if (!e || (g?.kind !== 'TEXT' && g?.kind !== 'MTEXT')) continue;
          const prims = tessellate(g, { color: 'foreground' }, { text });
          if (prims.length > 0) drawn[g.kind]++;
          // M1-41 part 2: a background fill comes first; a frame is a stroke after the glyphs.
          if (g.kind === 'MTEXT' && g.background) {
            if (g.background.flags & 3 && prims[0]?.kind === 'fill') drawn.backgrounds++;
            if (g.background.flags & 16 && prims.length > 1 && prims.at(-1)?.kind === 'stroke')
              drawn.frames++;
          }
          // Something to show: a character besides spaces and bare break codes (`\\N` alone).
          const stored = g.kind === 'TEXT' ? g.value : g.contents;
          const visible = g.height > 0 && /\S/.test(stored.replace(/\\[PNX~]/g, ''));
          if (visible && prims.length === 0) blank.push(`${f.path} ${g.kind} ${e.handle}`);
          // Square glyphs one height tall and two wide: a generous reach from the anchor for
          // the longest corpus strings, so a misplaced frame (wrong axis, unit or origin)
          // shows while long text does not.
          const chars = g.kind === 'TEXT' ? g.value.length : g.contents.length;
          const anchor =
            g.kind === 'TEXT' && g.alignmentPoint ? [g.position, g.alignmentPoint] : [g.position];
          const reach =
            (chars + 2) * 2 * g.height * Math.max(1, g.kind === 'TEXT' ? g.widthFactor : 1) +
            (g.kind === 'MTEXT' ? g.width + (g.definedHeight ?? 0) : 0);
          for (const p of prims) {
            if (!('path' in p)) continue;
            for (const [x, y] of coordinates(p.path)) {
              const near = anchor.some((a) => Math.hypot(x - a.x, y - a.y) <= reach + 1e-9);
              if (!Number.isFinite(x) || !Number.isFinite(y) || !near) {
                wrong.push(
                  `${f.path} ${g.kind} ${e.handle}: (${x}, ${y}) from ${JSON.stringify(anchor)}`,
                );
                break;
              }
            }
          }
        }
      }
    }
    console.log(`text corpus: ${JSON.stringify(drawn)}`);
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(blank.slice(0, 20)).toEqual([]);
    // Counts at M1-41 part 1; raise them when corpus files are added.
    expect(drawn.TEXT).toBeGreaterThanOrEqual(2548);
    expect(drawn.MTEXT).toBeGreaterThanOrEqual(1093);
    // Every corpus MTEXT background that has text: 36 acadsharp fills and 2 framed ezdxf fills,
    // and 5 frames. The 2 empty MTEXTs in mtext_framed_columns.dxf (column continuations with
    // no contents) draw nothing.
    expect(drawn.backgrounds).toBeGreaterThanOrEqual(38);
    expect(drawn.frames).toBeGreaterThanOrEqual(5);
  });

  it('draws text whose font is missing with the bundled Hershey fonts and reports it (M1-09)', () => {
    // No drawing font is committed, so every corpus style is missing and falls back.
    const fonts = bundledFontBook();
    const drawn = { TEXT: 0, MTEXT: 0 };
    const blank: string[] = [];
    const styleFonts = new Set<string>();
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      const { model } = corpusDrawing(doc);
      const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
      for (const block of model.blocks.keys()) {
        for (const id of model.blockEntities(block)) {
          const e = model.entity(id);
          const g = e?.geom;
          if (!e || (g?.kind !== 'TEXT' && g?.kind !== 'MTEXT')) continue;
          const style = model.tables.textStyles.get(g.style);
          if (style?.font) styleFonts.add(styleFont(style).name);
          const prims = tessellate(g, { color: 'foreground' }, { text });
          const stored = g.kind === 'TEXT' ? g.value : g.contents;
          const visible = g.height > 0 && /\S/.test(stored.replace(/\\[PNX~]/g, ''));
          if (!visible) continue;
          if (prims.some((p) => p.kind === 'stroke')) drawn[g.kind]++;
          else blank.push(`${f.path} ${g.kind} ${e.handle}`);
        }
      }
    }
    const byFont = new Map<string, string[]>();
    for (const [name, oet] of fonts.substitutions)
      byFont.set(oet, [...(byFont.get(oet) ?? []), name]);
    console.log(
      `bundled fonts: ${JSON.stringify(drawn)}, ${JSON.stringify(Object.fromEntries(byFont))}`,
    );
    expect(blank.slice(0, 20)).toEqual([]);
    expect(drawn.TEXT).toBeGreaterThanOrEqual(2548);
    expect(drawn.MTEXT).toBeGreaterThanOrEqual(1093);
    // Every style font the corpus names is reported, with its Hershey equivalent when it has one.
    for (const name of styleFonts) {
      const key = name
        .split(/[\\/]/)
        .pop()!
        .toLowerCase()
        .replace(/\.(shx|ttf|otf|ttc)$/, '');
      expect(fonts.substitutions.get(name), name).toBe(SHX_EQUIVALENTS[key] ?? 'oet-simplex');
    }
    // The corpus's SHX styles name txt and simplex.shx; the rest are TrueType, drawn with
    // oet-simplex until the TrueType sources (M1-38) supply them.
    expect(fonts.substitutions.get('txt')).toBe('oet-simplex');
    expect(fonts.substitutions.get('simplex.shx')).toBe('oet-simplex');
  });

  it("draws every attribute inside its INSERT's spatial-index bounds (M1-14 part 2)", () => {
    const fonts = new FontBook({ alternate: 'square' });
    fonts.addShx('square', parseShx(squareFont()));
    const drawn = { attributes: 0, constants: 0 };
    const wrong: string[] = [];
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      const { model, index } = corpusDrawing(doc, (m) =>
        textBounds({ fonts, style: (h) => m.tables.textStyles.get(h) }),
      );
      const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
      const src: BlockSource = {
        model,
        paint: defaultPaint,
        insertContext: defaultPaint.insertContext,
        order: (block) => model.blockEntities(block),
      };
      for (const block of model.blocks.keys()) {
        for (const id of model.blockEntities(block)) {
          const e = model.entity(id)!;
          const g = e.geom;
          if (g.kind !== 'INSERT') continue;
          // What the INSERT shows besides its block's own drawing: its attributes, and the
          // constant ATTDEFs of its block.
          const shown = g.attributes.filter((a) => attributeShown(a.flags, undefined));
          const constants = model
            .blockEntities(g.block)
            .map((c) => model.entity(c)!.geom)
            .filter((c) => c.kind === 'ATTDEF' && c.flags & 2);
          if (shown.length === 0 && constants.length === 0) continue;
          const attributePrims = shown.flatMap((a) =>
            tessellate(attributeText(a), { color: 'foreground' }, { text }),
          );
          const own = primitivesBox(attributePrims);
          if (own) drawn.attributes += shown.length;
          drawn.constants += constants.length;
          // The reference draws exactly its attributes on top of what it draws under ATTMODE 0
          // (the corpus's constant ATTDEFs all have empty values, so they add nothing).
          const expand = (attributeMode: number) =>
            expandInsert(e, { ...src, tessellate: { text, attributeMode } }, { dashes: false })
              .prims.length;
          if (expand(1) - expand(0) !== attributePrims.length)
            wrong.push(`${f.path} INSERT ${e.handle}: attributes not drawn`);
          if (!own) continue;
          const b = index.bounds(id);
          if (b?.kind !== 'box') {
            wrong.push(`${f.path} INSERT ${e.handle}: bounds ${b?.kind}`);
            continue;
          }
          const slack = 1e-6 * Math.max(1, b.box.maxX - b.box.minX, b.box.maxY - b.box.minY);
          if (
            own.minX < b.box.minX - slack ||
            own.minY < b.box.minY - slack ||
            own.maxX > b.box.maxX + slack ||
            own.maxY > b.box.maxY + slack
          )
            wrong.push(`${f.path} INSERT ${e.handle}: ${JSON.stringify(own)} outside its bounds`);
        }
      }
    }
    console.log(`attributes: ${JSON.stringify(drawn)}`);
    expect(wrong.slice(0, 20)).toEqual([]);
    // Counts at M1-14 part 2: the corpus INSERTs' visible ATTRIBs with text, and the constant
    // ATTDEFs (all with empty values) of the acadsharp samples' blocks.
    expect(drawn.attributes).toBeGreaterThanOrEqual(100);
    expect(drawn.constants).toBeGreaterThanOrEqual(44);
  });

  it('bounds text exactly in the spatial index, so apertures find just the text they touch (M1-35)', () => {
    const fonts = new FontBook({ alternate: 'square' });
    fonts.addShx('square', parseShx(squareFont()));
    let boxed = 0;
    let apertures = 0;
    const wrong: string[] = [];
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      const { model, index } = corpusDrawing(doc, (m) =>
        textBounds({ fonts, style: (h) => m.tables.textStyles.get(h) }),
      );
      const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
      for (const block of model.blocks.keys()) {
        // The exact box of each text in the block, from what the renderer draws.
        const exact = new Map<EntityId, Box>();
        for (const id of model.blockEntities(block)) {
          const g = model.entity(id)!.geom;
          if (g.kind !== 'TEXT' && g.kind !== 'MTEXT') continue;
          const b = index.bounds(id);
          const drawn = primitivesBox(tessellate(g, { color: 'foreground' }, { text }));
          if (b?.kind !== 'box') {
            wrong.push(`${f.path} ${g.kind} ${model.entity(id)!.handle}: bounds ${b?.kind}`);
            continue;
          }
          boxed++;
          const at = drawn ?? {
            minX: g.position.x,
            minY: g.position.y,
            maxX: g.position.x,
            maxY: g.position.y,
          };
          exact.set(id, at);
        }
        // Apertures at each text's centre and just past each of its corners: the index returns
        // every text whose exact box the aperture touches, and no other text.
        for (const b of exact.values()) {
          const w = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6);
          const r = w / 20;
          const centres = [
            [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2],
            [b.maxX + 2 * r, b.maxY + 2 * r],
            [b.minX - 2 * r, b.minY - 2 * r],
          ];
          for (const [x, y] of centres) {
            const q = { minX: x! - r, minY: y! - r, maxX: x! + r, maxY: y! + r };
            apertures++;
            const found = new Set(index.query(block, q).filter((id) => exact.has(id)));
            for (const [id, e] of exact) {
              if (boxesOverlap(e, q, 0) !== found.has(id)) {
                wrong.push(`${f.path} ${model.entity(id)!.handle}: aperture ${JSON.stringify(q)}`);
              }
            }
          }
        }
      }
    }
    console.log(`text bounds: ${boxed} texts boxed, ${apertures} apertures`);
    expect(wrong.slice(0, 20)).toEqual([]);
    // Every corpus TEXT and MTEXT, the 11 empty ones bounded by their insertion point.
    expect(boxed).toBeGreaterThanOrEqual(3652);
  });
});
