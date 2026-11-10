// M2-16: the plot sheet's PDF stays what sheet.ts writes (`TRIYA_UPDATE_FIXTURES=1` rewrites
// it, and the golden images in tests/e2e/fidelity/pdf.spec.ts are of the committed file), and an
// independent reader, pdf.js, finds its pages, labels, bookmarks and drawing operators. CI
// also runs `qpdf --check` on it (.github/workflows/ci.yml).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as pdf from '@triya/pdf';
import * as render from '@triya/render';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SHEET_DIR, SHEET_PAGES, SHEET_PDF, sheetPdf, sheetSvgs } from './sheet';

let bytes: Uint8Array;
let svgs: string[];
/** The same plot as SVG files (M2-18), one per page; tests/e2e/fidelity/svg.spec.ts draws them. */
const SVG_DIR = `${SHEET_DIR}svg/`;
beforeAll(() => {
  bytes = sheetPdf();
  svgs = sheetSvgs();
  if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
    mkdirSync(SVG_DIR, { recursive: true });
    writeFileSync(SHEET_DIR + SHEET_PDF, bytes);
    svgs.forEach((svg, i) => writeFileSync(`${SVG_DIR}page-${i + 1}.svg`, svg));
  }
});

/** Each page's content stream, inflated, in page order. */
function contents(file: Uint8Array): string[] {
  const latin = Buffer.from(file).toString('latin1');
  const out: string[] = [];
  for (const m of latin.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    out.push(
      inflateSync(Buffer.from(file.subarray(start, start + Number(m[1])))).toString('latin1'),
    );
  }
  return out;
}

describe('the plot sheet PDF (M2-16)', () => {
  it('commits the PDF the plot writes', () => {
    expect(existsSync(SHEET_DIR + SHEET_PDF)).toBe(true);
    expect(new Uint8Array(readFileSync(SHEET_DIR + SHEET_PDF))).toEqual(bytes);
  });

  it('commits the SVG pages the plot writes, each drawing layer an Inkscape layer', () => {
    expect(svgs).toHaveLength(SHEET_PAGES.length);
    svgs.forEach((svg, i) => {
      expect(readFileSync(`${SVG_DIR}page-${i + 1}.svg`, 'utf8')).toBe(svg);
      const labels = [...svg.matchAll(/inkscape:groupmode="layer" inkscape:label="([^"]*)"/g)].map(
        (m) => m[1],
      );
      expect(labels.length).toBeGreaterThan(0);
    });
    // The sheet's frame and title block are on SHEET, its geometry on GEOMETRY (plot-sheet.py).
    expect(svgs[0]).toContain('inkscape:label="SHEET"');
    expect(svgs[0]).toContain('inkscape:label="GEOMETRY"');
  });

  it('opens in pdf.js with eight A4 landscape pages, their labels and bookmarks', async () => {
    const task = getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    try {
      expect(doc.numPages).toBe(8);
      expect(await doc.getPageLabels()).toEqual(SHEET_PAGES.map((p) => p.label));
      const outline = await doc.getOutline();
      expect(outline.map((o) => o.title)).toEqual(SHEET_PAGES.map((p) => p.bookmark));
      for (let n = 1; n <= 8; n++) {
        const page = await doc.getPage(n);
        const [x0, y0, x1, y1] = page.view;
        expect([x0, y0]).toEqual([0, 0]);
        expect(x1).toBeCloseTo((297 * 72) / 25.4, 3);
        expect(y1).toBeCloseTo((210 * 72) / 25.4, 3);
        const ops = await page.getOperatorList();
        // Stroke-font text plots as paths; only pages 6 and 7's OpenType text is text.
        expect(ops.fnArray).toContain(OPS.constructPath);
        expect(ops.fnArray.includes(OPS.beginText)).toBe(n >= 6);
        // Pages 4 and 5 paint shadings, an image and (page 5) fill style patterns; page 8's
        // underlays show page 4 again.
        expect(ops.fnArray.includes(OPS.shadingFill)).toBe(n === 4 || n === 5 || n === 8);
        expect(ops.fnArray.includes(OPS.paintImageXObject)).toBe(n === 4 || n === 5 || n === 8);
        expect(ops.fnArray.includes(OPS.setFillColorN)).toBe(n === 5);
        // Only page 8 paints form XObjects: the underlays' pages.
        expect(ops.fnArray.includes(OPS.paintFormXObjectBegin)).toBe(n === 8);
      }
      const meta = await doc.getMetadata();
      expect((meta.info as { Producer?: string }).Producer).toBe('Triya CAD 2D');
    } finally {
      await task.destroy();
    }
  });

  it('plots page 1 in colour, page 2 in grey alone, page 3 with plot style linetypes', () => {
    const [colour, mono, linetypes] = contents(bytes);
    expect(colour).toMatch(/^1 0 0 RG$/m);
    // The 50 % transparent hatch (alpha 128 of 255), the thinnest and thickest lineweights.
    expect(colour).toMatch(/^\/GSa502 gs$/m);
    expect(colour).toMatch(/^0 w$/m);
    expect(colour).toMatch(new RegExp(`^${pdf.pdfNumber(2 * pdf.POINTS_PER_MM)} w$`, 'm'));
    expect(colour).toMatch(/^f\*$/m);
    expect(mono).not.toMatch(/ (RG|rg)$/m);
    expect(mono).toMatch(/^0 G$/m);
    // Thirty distinct dash patterns, one per plot style linetype.
    const dashes = new Set([...linetypes!.matchAll(/^\[([^\]]+)\] [\d.]+ d$/gm)].map((m) => m[1]));
    expect(dashes.size).toBeGreaterThanOrEqual(30);
    // Colour 150 screened to 40 %.
    const aci150 = render.aciRgb(150);
    const screened = aci150.map((v) => Math.round(255 - (255 - v) * 0.4) / 255);
    expect(linetypes).toContain(`${screened.map(pdf.pdfNumber).join(' ')} rg`);
  });

  it('plots gradients, a masked image, dots and clipped infinite lines on page 4 (part 2)', () => {
    const latin = Buffer.from(bytes).toString('latin1');
    const page4 = contents(bytes)[3]!;
    // LINEAR and the one-colour CYLINDER are axial, SPHERICAL radial.
    expect(latin.match(/\/ShadingType 2 /g)?.length).toBeGreaterThanOrEqual(2);
    expect(latin).toMatch(/\/ShadingType 3 /);
    expect(latin).toMatch(
      /\/Subtype \/Image \/Width 64 \/Height 32 \/ColorSpace \/DeviceRGB .*\/SMask/,
    );
    // Five points at (30 + 15i, 70) mm, each a filled disc whose top is the point raised by
    // its radius: half its lineweight, at least 0.25 mm.
    [0, 0.25, 0.5, 1, 2].forEach((lw, i) => {
      const r = Math.max(lw, 0.25) / 2;
      const x = pdf.pdfNumber((30 + 15 * i) * pdf.POINTS_PER_MM);
      const y = pdf.pdfNumber((70 + r) * pdf.POINTS_PER_MM);
      expect(page4.split('\n').some((l) => l.endsWith(` ${x} ${y} c`))).toBe(true);
    });
    // The dashed XLINE: many short subpaths in one stroke.
    expect(page4).toMatch(/(^[\d.-]+ [\d.-]+ m\n[\d.-]+ [\d.-]+ l\n){20}/m);
  });

  it('fills ACI 40–47 with the eight fill style patterns on page 5', () => {
    const page5 = contents(bytes)[4]!;
    const used = new Set([...page5.matchAll(/\/(P\w+) scn$/gm)].map((m) => m[1]));
    expect([...used].sort()).toEqual(
      Object.keys(pdf.FILL_STYLES)
        .map((s) => `P${s}`)
        .sort(),
    );
    // The XLINE and RAY dashed by their plot style linetypes, phased from the base point.
    expect(page5).toMatch(/^\[[\d. ]+\] [\d.]+ d$/m);
  });

  it('writes page 6’s TrueType text as searchable text in one embedded subset (part 3)', async () => {
    const latin = Buffer.from(bytes).toString('latin1');
    // One TrueType font embedded for page 6 (the restricted-licence twin is not), page 7's
    // collection face, and page 8's copy of the underlay PDF's own subset.
    expect(latin.match(/\/FontFile2 /g)).toHaveLength(3);
    expect(latin).toMatch(/\/BaseFont \/[A-Z]{6}\+TriyaPixel /);
    expect(latin).not.toContain('TriyaLocked');
    const task = getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(6);
      const items = (await page.getTextContent()).items;
      // pdf.js splits a run into items at wide spaces: read them back as one line of words.
      const text = items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ');
      for (const s of [
        'TRUETYPE TEXT 1:100',
        'HEIGHT 5 = 2.5 X 2',
        'ROTATED 30°',
        'WIDTH 1.5 OBLIQUE 15',
        'FIT TEXT',
        'BACKWARD',
        'UPSIDE DOWN',
        'ÅÄ COMPOSITE GLYPHS',
        'MTEXT LINE ONE',
        'MISSING: q',
        'RED',
      ])
        expect(text).toContain(s);
      // Tracked 1.5, its letters spaced half an advance apart, reads as spaced letters.
      expect(text.replace(/ /g, '')).toContain('TRACKED1.5');
      // The ROMANS run and the locked font are outlines, not text.
      expect(text).not.toMatch(/romans|LOCKED/);
    } finally {
      await task.destroy();
    }
  });

  it('shares the renderer’s path opcodes', () => {
    expect([
      pdf.PATH_M,
      pdf.PATH_L,
      pdf.PATH_A,
      pdf.PATH_E,
      pdf.PATH_Z,
      pdf.PATH_Q,
      pdf.PATH_C,
    ]).toEqual([
      render.PATH_M,
      render.PATH_L,
      render.PATH_A,
      render.PATH_E,
      render.PATH_Z,
      render.PATH_Q,
      render.PATH_C,
    ]);
  });

  it('writes page 7’s CFF and collection text as text in embedded subsets (part 4)', async () => {
    const latin = Buffer.from(bytes).toString('latin1');
    // Three CFF programs (plain, CID-keyed, the collection's CFF face); the locked one is outlined.
    expect(latin.match(/\/FontFile3 /g)).toHaveLength(3);
    expect(latin.match(/\/Subtype \/CIDFontType0C /g)).toHaveLength(3);
    for (const name of ['TriyaPixelCFF', 'TriyaPixelCID', 'TriyaPair', 'TriyaPairSans'])
      expect(latin).toMatch(new RegExp(`/BaseFont /[A-Z]{6}\\+${name} `));
    expect(latin).toContain('/Registry (Triya) /Ordering (Pixel) /Supplement 0');
    expect(latin).not.toContain('TriyaLockedCFF');
    const task = getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(7);
      const items = (await page.getTextContent()).items;
      const text = items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ');
      for (const s of [
        'CFF OPENTYPE 1:50',
        'CID-KEYED CFF',
        'ROTATED 20°',
        'WIDE ÅÄ',
        'CID: (1+2)/3 = 1',
        'TTC FACE 1',
        'FIRST FACE',
        'FACE 2 BY FAMILY',
        'CID AND',
      ])
        expect(text).toContain(s);
      expect(text).not.toMatch(/romans|LOCKED/);
    } finally {
      await task.destroy();
    }
  });

  it('copies page 8’s underlay pages in as forms, their text still text (part 5)', async () => {
    const latin = Buffer.from(bytes).toString('latin1');
    // Four underlays of two pages: each page's form once, page 1's shared by the monochrome,
    // contrast 50 copy (a form greying it, and one masking that to where the page paints).
    expect(latin.match(/\/Subtype \/Form /g)).toHaveLength(4);
    expect(latin.match(/\/SMask << \/S \/Alpha /g)).toHaveLength(1);
    expect(latin).toContain('/BM /Saturation');
    const task = getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(8);
      const text = (await page.getTextContent()).items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ');
      // Page 1 of the underlay PDF (the TrueType text page) is shown twice.
      expect(text.match(/TRUETYPE TEXT 1:100/g)).toHaveLength(2);
    } finally {
      await task.destroy();
    }
  });
});
