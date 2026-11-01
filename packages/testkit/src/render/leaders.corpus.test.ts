// M1-52 part 1 on the public corpus: every MULTILEADER draws its parts (lines, landing,
// arrowhead, text with the stand-in font) and the spatial index bounds it by exactly what it
// draws, so culling never drops a leader and picking never keeps one whose drawing is elsewhere.
// The comparison against AutoCAD plots is the task's acceptance with M1-24 and M1-26.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import {
  defaultPaint,
  expandInsert,
  primitivesBox,
  textBounds,
  type BlockSource,
} from '@triya/render';
import { FontBook, parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';
import { squareFont } from './square-font.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

describe('multileaders on the public corpus (M1-52)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('draws every MULTILEADER and bounds it by what it draws', () => {
    const fonts = new FontBook({ alternate: 'square' });
    fonts.addShx('square', parseShx(squareFont()));
    const wrong: string[] = [];
    const counts = { drawn: 0, arrows: 0, texts: 0 };
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
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
        tessellate: { text },
      };
      for (const block of model.blocks.keys()) {
        for (const id of model.blockEntities(block)) {
          const e = model.entity(id);
          if (e?.geom.kind !== 'MULTILEADER') continue;
          const { prims } = expandInsert(e, src, { dashes: false });
          if (prims.length === 0) {
            wrong.push(`${f.path} ${e.handle}: draws nothing`);
            continue;
          }
          counts.drawn++;
          if (prims.some((p) => p.kind === 'fill')) counts.arrows++;
          if (prims.some((p) => p.kind !== 'point' && p.kind !== 'infinite' && p.text))
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
  });
});
