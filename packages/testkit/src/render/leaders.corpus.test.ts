// M1-52 on the public corpus: every MULTILEADER draws its parts (lines, landing, arrowhead,
// text with the stand-in font), every LEADER its path and arrowhead and every TOLERANCE its
// compartment frames and text, and the spatial index
// bounds each by exactly what it draws, so culling never drops a leader and picking never keeps
// one whose drawing is elsewhere.
// The comparison against AutoCAD plots is the task's acceptance with M1-24 and M1-26.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import {
  defaultPaint,
  expandInsert,
  primitivesBox,
  textBounds,
  textMeasure,
  type BlockSource,
} from '@triya/render';
import { FontBook, GDT_FONT, GDT_SYMBOLS, loadStrokeFont, parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { bundledFontBook, bundledFontFiles } from './bundled-fonts.ts';
import { corpusDrawing } from './document.ts';
import { squareFont } from './square-font.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

describe('leaders on the public corpus (M1-52)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('draws every MULTILEADER, LEADER and TOLERANCE and bounds it by what it draws', () => {
    const fonts = new FontBook({ alternate: 'square' });
    fonts.addShx('square', parseShx(squareFont()));
    const wrong: string[] = [];
    const counts = { drawn: 0, arrows: 0, texts: 0, leaders: 0, leaderArrows: 0, frames: 0 };
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      const { model, index } = corpusDrawing(
        doc,
        (m) => textBounds({ fonts, style: (h) => m.tables.textStyles.get(h) }),
        (m) => textMeasure({ fonts, style: (h) => m.tables.textStyles.get(h) }),
      );
      const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
      const src: BlockSource = {
        model,
        paint: defaultPaint,
        insertContext: defaultPaint.insertContext,
        order: (block) => model.blockEntities(block),
        tessellate: { text },
      };
      for (const block of model.blocks.keys()) {
        for (const id of model.blockEntities(block)) {
          const e = model.entity(id);
          if (!e) continue;
          const kind = e.geom.kind;
          if (kind !== 'MULTILEADER' && kind !== 'LEADER' && kind !== 'TOLERANCE') continue;
          const { prims } = expandInsert(e, src, { dashes: false });
          // A TOLERANCE without text draws nothing and is bounded as empty.
          if (kind === 'TOLERANCE' && prims.length === 0) {
            if (index.bounds(id)?.kind !== 'empty') wrong.push(`${f.path} ${e.handle}: not empty`);
            continue;
          }
          if (prims.length === 0) {
            wrong.push(`${f.path} ${e.handle}: draws nothing`);
            continue;
          }
          const filled = prims.some((p) => p.kind === 'fill');
          if (kind === 'TOLERANCE') {
            counts.frames++;
          } else if (kind === 'LEADER') {
            counts.leaders++;
            if (filled) counts.leaderArrows++;
          } else {
            counts.drawn++;
            if (filled) counts.arrows++;
          }
          if (
            kind !== 'TOLERANCE' &&
            prims.some((p) => p.kind !== 'point' && p.kind !== 'infinite' && p.text)
          )
            counts.texts++;
          const drawn = primitivesBox(prims)!;
          const b = index.bounds(id);
          if (b?.kind !== 'box') {
            wrong.push(`${f.path} ${e.handle}: bounds ${b?.kind}`);
            continue;
          }
          const size = Math.max(1, b.box.maxX - b.box.minX, b.box.maxY - b.box.minY);
          const off = Math.max(
            Math.abs(drawn.minX - b.box.minX),
            Math.abs(drawn.minY - b.box.minY),
            Math.abs(drawn.maxX - b.box.maxX),
            Math.abs(drawn.maxY - b.box.maxY),
          );
          if (off > 1e-9 * size)
            wrong.push(
              `${f.path} ${e.handle}: drawn ${JSON.stringify(drawn)} vs ${JSON.stringify(b.box)}`,
            );
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // Counts at M1-52 part 1 (all corpus multileaders have MTEXT and closed filled arrows).
    // Raise them when corpus files are added.
    expect(counts.drawn).toBeGreaterThanOrEqual(302);
    expect(counts.arrows).toBe(counts.drawn);
    expect(counts.texts).toBe(counts.drawn);
    // M1-52 part 2: the 20 corpus LEADERs, all with an arrowhead since acad-ts patch 0074 reads
    // a DXF LEADER without group 71 as having one, as its DWG twin has.
    expect(counts.leaders).toBeGreaterThanOrEqual(20);
    expect(counts.leaderArrows).toBe(counts.leaders);
    // M1-52 part 4: the 3 TOLERANCEs of each of the 20 acadsharp samples (DXF and DWG).
    expect(counts.frames).toBeGreaterThanOrEqual(60);
  });

  // M1-54: with the bundled fonts, a TOLERANCE's `{\Fgdt;x}` letters draw with our GD&T font,
  // so the frames show symbols (position, diameter, profile, …), not the letters j, n, d.
  it('draws the GD&T symbols of every TOLERANCE with the bundled GD&T font', () => {
    // The same fonts without oet-gdt: `gdt` then falls back to oet-simplex's letters.
    const lettersOnly = new FontBook();
    for (const [name, text] of bundledFontFiles())
      if (name !== GDT_FONT) lettersOnly.addShx(name, loadStrokeFont(JSON.parse(text)));
    const wrong: string[] = [];
    const seen = new Set<string>();
    let frames = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      const draw = (fonts: FontBook) => {
        const style =
          (m: { tables: { textStyles: ReadonlyMap<string, unknown> } }) => (h: string) =>
            m.tables.textStyles.get(h) as never;
        const { model } = corpusDrawing(
          doc,
          (m) => textBounds({ fonts, style: style(m) }),
          (m) => textMeasure({ fonts, style: style(m) }),
        );
        const src: BlockSource = {
          model,
          paint: defaultPaint,
          insertContext: defaultPaint.insertContext,
          order: (block) => model.blockEntities(block),
          tessellate: { text: { fonts, style: style(model) } },
        };
        const out = new Map<string, { text: string; prims: unknown }>();
        for (const block of model.blocks.keys())
          for (const id of model.blockEntities(block)) {
            const e = model.entity(id);
            if (e?.geom.kind !== 'TOLERANCE') continue;
            out.set(e.handle, {
              text: e.geom.text,
              prims: expandInsert(e, src, { dashes: false }).prims,
            });
          }
        return out;
      };
      const book = bundledFontBook();
      const symbols = draw(book);
      const letters = draw(lettersOnly);
      for (const [handle, { text, prims }] of symbols) {
        const used = [...text.matchAll(/\\Fgdt;([^}]*)\}/g)].flatMap((m) => [...m[1]!]);
        if (used.length === 0) continue;
        frames++;
        for (const ch of used) {
          seen.add(ch);
          if (!Object.hasOwn(GDT_SYMBOLS, ch))
            wrong.push(`${f.path} ${handle}: ${ch} is no symbol`);
        }
        if (book.substitutions.get('gdt') !== GDT_FONT)
          wrong.push(`${f.path} ${handle}: gdt drew with ${book.substitutions.get('gdt')}`);
        // Drawn with symbols, the frame differs from the same frame drawn with the letters.
        if (JSON.stringify(prims) === JSON.stringify(letters.get(handle)?.prims))
          wrong.push(`${f.path} ${handle}: draws letters`);
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // The corpus frames use position, diameter, profile of a surface and projected zone
    // (2 frames with GD&T text in each of the 20 acadsharp samples).
    expect(frames).toBeGreaterThanOrEqual(40);
    expect([...seen].sort()).toEqual(['d', 'j', 'n', 'p']);
  });
});
