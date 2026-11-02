// M1-45 on the public corpus: every entity drawn with a complex linetype (text or shapes in
// its pattern, such as the acadsharp samples' GAS_LINE "--GAS--" and their ltypeshp.shx
// lines) draws its text, and its shapes once the shape file is loaded. The bundled fonts stand
// in for the text styles' fonts (M1-09). ltypeshp.shx is an Autodesk file and never committed,
// so a made-up shape file of that name holds a square under every shape number the corpus
// linetypes use; the check is that shapes are placed near their line, not what they look like.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument } from '@triya/io';
import { createPaint, PATH_A, PATH_L, PATH_M, tessellate } from '@triya/render';
import { parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { buildShapes } from '../../../text/test/shx/builder.ts';
import { loadManifest } from '../corpus/manifest.ts';
import { bundledFontBook } from './bundled-fonts.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

/** The move/line targets and arc centres of a stroke path (glyphs and shapes are no more). */
function* points(path: readonly number[]): Generator<[number, number]> {
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    if (op === PATH_M || op === PATH_L) {
      yield [path[i + 1]!, path[i + 2]!];
      i += 3;
    } else if (op === PATH_A) {
      yield [path[i + 1]!, path[i + 2]!];
      i += 7;
    } else i += 1;
  }
}

describe('complex linetypes on the public corpus (M1-45)', () => {
  it('draws the text and shapes of every complex linetype near its line', () => {
    const paint = createPaint();
    const counts = { text: 0, shapes: 0, entities: 0 };
    const far: string[] = [];
    const empty: string[] = [];
    for (const f of manifest.files) {
      if (!/\.dxf$/i.test(f.path)) continue;
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      const { model } = corpusDrawing(doc);
      const fonts = bundledFontBook();
      // A square under every shape number a linetype in this drawing uses.
      const numbers = new Set<number>();
      for (const lt of model.tables.linetypes.values())
        for (const e of lt.elements) if (e.shapeFlags & 4) numbers.add(e.shapeNumber);
      if (numbers.size > 0) {
        const square = [0x14, 0x10, 0x1c, 0x18, 0];
        const shapes = [...numbers].sort((a, b) => a - b);
        fonts.addShx(
          'ltypeshp.shx',
          parseShx(buildShapes(shapes.map((code) => ({ code, name: `S${code}`, bytes: square })))),
        );
      }
      const text = { fonts, style: (h: string) => model.tables.textStyles.get(h) };
      for (const id of [...model.blocks.keys()].flatMap((b) => model.blockEntities(b))) {
        const e = model.entity(id)!;
        const p = paint(e, model);
        const embeds = p?.linetype?.pattern.elements.filter((x) => x.embed) ?? [];
        if (!p?.linetype || embeds.length === 0 || e.geom.kind !== 'LINE') continue;
        counts.entities++;
        const prims = tessellate(e.geom, p, { text });
        const dashes = prims.filter((x) => x.kind === 'stroke' && x.continuous);
        // A line too short for one repetition draws continuous, with no embeds.
        if (dashes.length === 0) continue;
        const drawn = prims.filter((x) => 'path' in x && !('continuous' in x && x.continuous));
        if (drawn.length === 0) empty.push(`${f.path} ${e.handle}`);
        if (embeds.some((x) => x.embed!.kind === 'text') && drawn.length > 0) counts.text++;
        if (embeds.some((x) => x.embed!.kind === 'shape') && drawn.length > 0) counts.shapes++;
        // Near the line: within the largest embed's offset plus its size (with its style's
        // height), times the linetype scale, and a margin for the glyph's width.
        const { start, end } = e.geom;
        const len = Math.hypot(end.x - start.x, end.y - start.y);
        const reach =
          p.linetype.scale *
          Math.max(
            ...embeds.map((x) => {
              const s = x.embed!.style ? model.tables.textStyles.get(x.embed!.style) : undefined;
              const h = (s && s.height > 0 ? s.height : 1) * x.embed!.scale;
              return Math.hypot(x.embed!.offset.x, x.embed!.offset.y) + 4 * h;
            }),
          );
        for (const prim of drawn) {
          if (!('path' in prim)) continue;
          for (const [x, y] of points(prim.path)) {
            // Distance from the line segment.
            const t = Math.max(
              0,
              Math.min(
                1,
                ((x - start.x) * (end.x - start.x) + (y - start.y) * (end.y - start.y)) / len ** 2,
              ),
            );
            const d = Math.hypot(
              x - (start.x + t * (end.x - start.x)),
              y - (start.y + t * (end.y - start.y)),
            );
            if (!(d <= reach + 1e-9)) {
              far.push(`${f.path} ${e.handle} (${x}, ${y}) is ${d} from the line, reach ${reach}`);
              break;
            }
          }
        }
      }
    }
    expect(far).toEqual([]);
    expect(empty).toEqual([]);
    // The acadsharp samples (seven versions) each draw text and shape linetypes.
    expect(counts.text).toBeGreaterThanOrEqual(7);
    expect(counts.shapes).toBeGreaterThanOrEqual(7);
  });
});
