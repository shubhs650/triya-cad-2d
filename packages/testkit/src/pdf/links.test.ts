// M2-74: Save As PDF's "Include hyperlinks" as an independent reader sees it: pdf.js lists a
// link annotation over each hyperlinked object with its URL and rectangle, and a layout link
// (a named location alone) as a jump to the page plotting that layout.
import { PATH_L, PATH_M, PdfDocument, plotItems, type PlotItem, type PlotPaint } from '@triya/pdf';
import { describe, expect, it } from 'vitest';
import { pdfSummary } from './read';

const paint: PlotPaint = {
  color: [0, 0, 0],
  lineweight: 0,
  linetype: { kind: 'object' },
  endStyle: 'round',
  joinStyle: 'round',
};
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function pdf(hyperlinks: boolean): Uint8Array {
  const doc = new PdfDocument({ title: 'links' });
  const items: PlotItem[] = [
    {
      kind: 'stroke',
      path: [PATH_M, 100, 200, PATH_L, 300, 200],
      paint,
      link: { url: 'https://openengtools.com/triya', location: 'specs' },
    },
    {
      kind: 'stroke',
      path: [PATH_M, 100, 300, PATH_L, 100, 400],
      paint,
      link: { url: '', location: 'Layout1' },
    },
  ];
  plotItems(doc.addPage(595, 842, { label: 'Model' }), items, { toPaper: IDENTITY, hyperlinks });
  doc.addPage(595, 842, { label: 'Layout1' });
  return doc.bytes();
}

describe('hyperlinks in a saved PDF', () => {
  it('are link annotations pdf.js reads, with their URL or page and rectangle', async () => {
    const { links } = await pdfSummary(pdf(true));
    expect(links).toHaveLength(2);
    expect(links[0]!.url).toBe('https://openengtools.com/triya#specs');
    expect(links[0]!.rect.map((v) => Math.round(v))).toEqual([98, 198, 302, 202]);
    expect(links[1]).toMatchObject({ page: 2 });
    expect(links[1]!.rect.map((v) => Math.round(v))).toEqual([98, 298, 102, 402]);
  });

  it('are left out without the option', async () => {
    expect((await pdfSummary(pdf(false))).links).toEqual([]);
  });
});
