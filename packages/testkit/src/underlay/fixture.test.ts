// The PDF underlay test drawing (M1-20) stays as fixture.ts authors it: the committed PDF is the
// generator's bytes, and the committed DXF opens with both underlays and their definitions.
// `TRIYA_UPDATE_FIXTURES=1` rewrites both files (the DXF's header carries its save time, so
// it is compared by what it maps to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PdfDefinition, UnderlayGeometry } from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import {
  LAYERS_DXF_NAME,
  LAYERS_OFF_AT,
  LAYERS_PDF_NAME,
  PAGE2_CLIP,
  UNDERLAY_DXF_NAME,
  UNDERLAY_PDF_NAME,
  underlayDxf,
  underlayLayersDxf,
  underlayLayersPdf,
  underlayPdf,
} from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/underlay/', import.meta.url));

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DIR + UNDERLAY_PDF_NAME, underlayPdf());
  writeFileSync(DIR + UNDERLAY_DXF_NAME, underlayDxf());
  writeFileSync(DIR + LAYERS_PDF_NAME, underlayLayersPdf());
  writeFileSync(DIR + LAYERS_DXF_NAME, underlayLayersDxf());
}

describe('PDF underlay fixture', () => {
  it('commits the PDF the generator writes', () => {
    expect(existsSync(DIR + UNDERLAY_PDF_NAME)).toBe(true);
    expect(new Uint8Array(readFileSync(DIR + UNDERLAY_PDF_NAME))).toEqual(underlayPdf());
  });

  it('writes a PDF whose cross-reference table points at each object', () => {
    const text = new TextDecoder().decode(underlayPdf());
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(7);
    offsets.forEach((o, i) =>
      expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`),
    );
  });

  it('commits an AC1032 DXF attaching pages 1 and 2, the second scaled, turned and clipped', () => {
    const bytes = new Uint8Array(readFileSync(DIR + UNDERLAY_DXF_NAME));
    const doc = readCadDocument(bytes);
    expect(doc.header?.versionString).toBe('AC1032');
    const { init } = openDocument(doc);
    const defs = (init.objects ?? []).filter((o): o is PdfDefinition => o.type === 'PDFDEFINITION');
    expect(defs.map((d) => [d.fileName, d.page])).toEqual([
      [`.\\${UNDERLAY_PDF_NAME}`, '1'],
      [`.\\${UNDERLAY_PDF_NAME}`, '2'],
    ]);
    const underlays = (init.entities ?? [])
      .map((e) => e.geom)
      .filter((g): g is UnderlayGeometry => g.kind === 'PDFUNDERLAY');
    expect(underlays).toHaveLength(2);
    const [one, two] = underlays as [UnderlayGeometry, UnderlayGeometry];
    expect(one).toMatchObject({
      definition: defs[0]!.handle,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      flags: 10,
      clip: [],
    });
    expect(two).toMatchObject({
      definition: defs[1]!.handle,
      position: { x: 12, y: 0 },
      scale: { x: 0.5, y: 0.5 },
      flags: 11,
      clip: PAGE2_CLIP,
    });
    expect(two.rotation).toBeCloseTo(Math.PI / 6, 12);
  });
});

describe('PDF underlay layers fixture (M2-38 part 2)', () => {
  it('commits the layered PDF the generator writes', () => {
    expect(new Uint8Array(readFileSync(DIR + LAYERS_PDF_NAME))).toEqual(underlayLayersPdf());
  });

  it('commits a DXF attaching the page twice, the second turning Walls off', () => {
    const doc = readCadDocument(new Uint8Array(readFileSync(DIR + LAYERS_DXF_NAME)));
    expect(doc.header?.versionString).toBe('AC1032');
    const { init } = openDocument(doc);
    const underlays = (init.entities ?? [])
      .map((e) => e.geom)
      .filter((g): g is UnderlayGeometry => g.kind === 'PDFUNDERLAY');
    expect(underlays.map((u) => [u.position, u.layersOff])).toEqual([
      [{ x: 0, y: 0 }, undefined],
      [LAYERS_OFF_AT, ['Walls']],
    ]);
  });
});
