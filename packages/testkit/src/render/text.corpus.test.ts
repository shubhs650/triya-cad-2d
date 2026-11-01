// M1-41 part 1 on the public corpus: every TEXT and MTEXT, in model space, layouts and block
// definitions (dimension text, table cells), draws through the text engine with finite
// coordinates, near its insertion point. No real font is committed (CLAUDE.md "No Autodesk
// assets"), so every style falls back to a stand-in font through FONTALT: a 1 × 1 square for
// each printable ASCII character, which checks placement and layout, not glyph shapes. The
// comparison against AutoCAD plots is M1-41's acceptance, with M1-24 and M1-26.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import { PATH_A, PATH_C, PATH_E, PATH_L, PATH_M, PATH_Q, tessellate } from '@triya/render';
import { FontBook, parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

/** "AutoCAD-86 shapes 1.0": every printable ASCII code a square advancing 2 units; above 2. */
function squareFont(): Uint8Array {
  const square = [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0];
  const shapes: { code: number; body: number[] }[] = [
    { code: 0, body: [...Buffer.from('Square'), 0, 2, 1, 0, 0] },
  ];
  for (let c = 32; c < 127; c++)
    shapes.push({ code: c, body: [0x41, 0, ...(c === 32 ? [2, 0x20, 0] : square)] });
  const out: number[] = [...Buffer.from('AutoCAD-86 shapes 1.0\r\n\x1a')];
  const u16 = (v: number) => out.push(v & 0xff, v >> 8);
  u16(0);
  u16(126);
  u16(shapes.length);
  for (const s of shapes) {
    u16(s.code);
    u16(s.body.length);
  }
  for (const s of shapes) out.push(...s.body);
  return Uint8Array.from(out);
}

/** The move/line targets and curve centres of a path. */
function* coordinates(path: readonly number[]): Generator<[number, number]> {
  const size = { [PATH_M]: 2, [PATH_L]: 2, [PATH_A]: 6, [PATH_E]: 8, [PATH_Q]: 4, [PATH_C]: 6 };
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    if (op !== 4) yield [path[i + 1]!, path[i + 2]!];
    i += 1 + (size[op as keyof typeof size] ?? 0);
  }
}

describe('text on the public corpus (M1-41 part 1)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

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
});
