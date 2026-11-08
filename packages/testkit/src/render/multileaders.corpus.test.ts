// M1-111 on the self-authored multileaders.dxf (scripts/corpus/multileaders.py): block content
// draws its attribute values, leader lines draw in the properties their DXF 93 flags, and the
// underline and overline attachments draw across the text, each bounded by what it draws (the
// bounds check for every corpus multileader is leaders.corpus.test.ts). The golden images are
// corpus/public/refs/golden/self-authored/multileaders.dxf/.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  annotationParts,
  type AnnotationPart,
  type DocumentModel,
  type Entity,
  type InsertGeometry,
  type LwPolylineGeometry,
  type MultiLeaderGeometry,
} from '@triya/engine';
import { readCadDocument } from '@triya/io';
import {
  defaultPaint,
  expandInsert,
  textBounds,
  textMeasure,
  type BlockSource,
} from '@triya/render';
import { FontBook, parseShx } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { corpusDrawing } from './document.ts';
import { squareFont } from './square-font.ts';

const FILE = fileURLToPath(
  new URL('../../../../corpus/public/self-authored/multileaders.dxf', import.meta.url),
);

function open() {
  const fonts = new FontBook({ alternate: 'square' });
  fonts.addShx('square', parseShx(squareFont()));
  const style = (m: DocumentModel) => (h: string) => m.tables.textStyles.get(h);
  const { model, index } = corpusDrawing(
    readCadDocument(new Uint8Array(readFileSync(FILE))),
    (m) => textBounds({ fonts, style: style(m) }),
    (m) => textMeasure({ fonts, style: style(m) }),
  );
  const measure = textMeasure({ fonts, style: style(model) });
  const leaders = [...model.entities()].filter((e) => e.geom.kind === 'MULTILEADER');
  const parts = (e: Entity): AnnotationPart[] =>
    annotationParts(e.geom, model, e.xdata, measure) ?? [];
  const src: BlockSource = {
    model,
    paint: defaultPaint,
    insertContext: defaultPaint.insertContext,
    order: (block) => model.blockEntities(block),
    tessellate: { text: { fonts, style: style(model) } },
  };
  return { model, index, leaders, parts, src };
}

const ml = (e: Entity) => e.geom as MultiLeaderGeometry;
const kinds = (parts: readonly AnnotationPart[]) => parts.map((p) => p.geom.kind);

describe('multileaders.dxf (M1-111)', () => {
  const { model, leaders, parts, src } = open();
  const blockContent = leaders.filter((e) => ml(e).contentType === 1);
  const text = leaders.filter((e) => ml(e).contentType === 2);

  it('holds two block multileaders and six text multileaders', () => {
    expect(blockContent).toHaveLength(2);
    expect(text).toHaveLength(6);
  });

  it('draws block content with the attribute values the multileader states', () => {
    const values = blockContent.map((e) => ml(e).block?.attributes?.map((a) => a.value));
    expect(values).toEqual([
      ['12', 'B'],
      ['7', 'C'],
    ]);
    for (const e of blockContent) {
      const insert = parts(e).at(-1)!.geom as InsertGeometry;
      expect(insert.kind).toBe('INSERT');
      expect(insert.attributes.map((a) => [a.tag, a.value])).toEqual(
        ml(e).block!.attributes!.map((a) => [a.index === 0 ? 'NO' : 'REV', a.value]),
      );
      // The values draw as text; without them the block content draws none (its ATTDEFs are
      // not constant).
      const drawn = expandInsert(e, src, { dashes: false }).prims.filter(
        (p) => p.kind !== 'point' && p.kind !== 'infinite' && p.text,
      );
      expect(drawn.length).toBeGreaterThan(0);
      const bare = { ...e, geom: { ...ml(e), block: { ...ml(e).block!, attributes: [] } } };
      const none = expandInsert(bare, src, { dashes: false }).prims.filter(
        (p) => p.kind !== 'point' && p.kind !== 'infinite' && p.text,
      );
      expect(none).toHaveLength(0);
    }
    // The turned, enlarged balloon puts its number turned 15° at 1.5 times 3.5.
    const big = (parts(blockContent[1]!).at(-1)!.geom as InsertGeometry).attributes[0]!;
    expect(big.height).toBeCloseTo(5.25);
    expect(big.rotation).toBeCloseTo((15 * Math.PI) / 180);
  });

  it('draws each leader line in the properties its flags override, and only those', () => {
    const over = text.find((e) => ml(e).branches[0]!.lines.length === 3)!;
    const lines = ml(over).branches[0]!.lines;
    expect(lines.map((l) => l.overrides?.flags)).toEqual([undefined, 62, 3]);
    const dashed = [...model.tables.linetypes.values()].find((l) => l.name === 'DASHED')!.handle;
    const dot = [...model.blocks.values()].find((b) => b.name === '_DOT')!.handle;
    const p = parts(over);
    // Line 1: closed filled arrow and line as the multileader. Line 2: _DOT arrowhead 2 big,
    // red, DASHED, 0.50 mm. Line 3: a green spline with the multileader's arrowhead and size,
    // its stored DASHED, 1.00 mm and _DOT not drawn. Then the landing and the text.
    expect(kinds(p)).toEqual([
      'SOLID',
      'LWPOLYLINE',
      'INSERT',
      'LWPOLYLINE',
      'SOLID',
      'SPLINE',
      'LWPOLYLINE',
      'MTEXT',
    ]);
    const own = { color: ml(over).lineColor, lineweight: ml(over).lineweight };
    expect(p[1]).toMatchObject(own);
    expect(p[2]).toMatchObject({ geom: { block: dot, scale: { x: 2, y: 2 } } });
    expect(p[3]).toMatchObject({
      color: { kind: 'aci', index: 1 },
      linetype: dashed,
      lineweight: 50,
    });
    expect(p[5]).toMatchObject({ color: { kind: 'aci', index: 3 }, lineweight: own.lineweight });
    expect(p[5]!.linetype).toBe(p[1]!.linetype);
    expect(p[6]).toMatchObject(own);
  });

  it('underlines or overlines the text for attachments 5, 6, 8 and 10', () => {
    const lined = text.filter((e) => ml(e).branches[0]!.lines.length === 1);
    expect(lined).toHaveLength(5);
    for (const e of lined) {
      const g = ml(e);
      const p = parts(e);
      const under = p.filter((x) => x.geom.kind === 'LWPOLYLINE').at(-1)!;
      const [a, b] = (under.geom as LwPolylineGeometry).vertices;
      const width = textMeasure({
        fonts: src.tessellate!.text!.fonts,
        style: (h) => model.tables.textStyles.get(h),
      })(p.at(-1)!.geom as never)!;
      const length = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      // Horizontal: the landing gap and the text's width; vertical: the text's width.
      expect(length).toBeCloseTo(g.textAttachmentDirection === 0 ? width + g.landingGap : width, 6);
      expect(a!.y).toBeCloseTo(b!.y, 9);
    }
  });
});
