// PDF underlay pages (M1-20): files matched to definitions by name, a page drawn once and served
// from the cache after, the pixel budget, the latest request winning, and pages served when
// their file arrives after the request.
import type { PdfDefinition, UnderlaySnapPage } from '@triya/engine';
import type { UnderlayRaster, UnderlayRequest } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { PdfPages, fileKey, type PdfFile } from '../src/underlay/pages';

const def = (handle: string, fileName: string, page = '1'): PdfDefinition => ({
  handle,
  type: 'PDFDEFINITION',
  owner: 'D4',
  name: handle,
  fileName,
  page,
});

/** A fake two-page PDF: page 1 is 8.5 × 11 in, page 2 is 11 × 8.5 in. */
function fakePdf() {
  const opened: Uint8Array[] = [];
  const drawn: { page: number; width: number; height: number }[] = [];
  const open = (bytes: Uint8Array): Promise<PdfFile> => {
    opened.push(bytes);
    return Promise.resolve({
      pageCount: 2,
      pageSize: (n) =>
        Promise.resolve(n === 1 ? { width: 8.5, height: 11 } : { width: 11, height: 8.5 }),
      render: (page, _region, width, height) => {
        drawn.push({ page, width, height });
        return Promise.resolve({ width, height, data: new Uint8ClampedArray(width * height * 4) });
      },
      snapGeometry: (page) =>
        Promise.resolve({
          lines: new Float64Array([0, 0, page, page]),
          arcs: new Float64Array(),
          beziers: new Float64Array(),
        }),
    });
  };
  return { open, opened, drawn };
}

const req = (
  definition: string,
  scale: number,
  minX = 0,
  minY = 0,
  maxX = 2,
  maxY = 1,
): UnderlayRequest => ({
  definition,
  scale,
  region: { minX, minY, maxX, maxY },
});

/** Lets the render queue run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('PdfPages', () => {
  it('matches a file to its definition by name without folder or case', () => {
    expect(fileKey('..\\Plans\\Plan.PDF')).toBe('plan.pdf');
    expect(fileKey('/home/u/plan.pdf')).toBe('plan.pdf');
    const pages = new PdfPages(fakePdf().open);
    pages.add('PLAN.pdf', new Uint8Array([1]));
    expect(pages.has('..\\x\\plan.pdf')).toBe(true);
    expect(pages.has('other.pdf')).toBe(false);
  });

  it('draws the region asked for at its scale, the page clamped, and delivers it', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const got: [string, UnderlayRaster | undefined][] = [];
    const c = pages.client([def('9A', '..\\plan.pdf', '2')], (d, r) => got.push([d, r]));
    c.request(req('9A', 10, -1, -1, 4, 3));
    await settle();
    expect(pdf.drawn).toEqual([{ page: 2, width: 40, height: 30 }]);
    expect(got).toHaveLength(1);
    expect(got[0]![1]).toMatchObject({
      page: { width: 11, height: 8.5 },
      region: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
    });
  });

  it('opens a file once and serves a page it drew again, or a sharper one, from the cache', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const got: UnderlayRaster[] = [];
    const defs = [def('9A', 'plan.pdf'), def('9B', 'plan.pdf')];
    const a = pages.client(defs, (_d, r) => got.push(r!));
    const b = pages.client(defs, (_d, r) => got.push(r!));
    a.request(req('9A', 20));
    await settle();
    // The same page through another definition and canvas, coarser and inside: no new render.
    b.request(req('9B', 10, 0.5, 0.5, 1, 1));
    a.request(req('9A', 20));
    await settle();
    expect(pdf.opened).toHaveLength(1);
    expect(pages.renders).toBe(1);
    expect(got).toHaveLength(3);
    expect(got[1]).toBe(got[0]);
  });

  it('keeps a raster within the pixel budget by lowering its scale', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open, { maxPixels: 100 });
    pages.add('plan.pdf', new Uint8Array([1]));
    const c = pages.client([def('9A', 'plan.pdf')], () => {});
    c.request(req('9A', 100, 0, 0, 2, 1));
    await settle();
    expect(pdf.drawn[0]!.width * pdf.drawn[0]!.height).toBeLessThanOrEqual(100);
    expect(pdf.drawn[0]!.width).toBe(14);
  });

  it('draws only the latest request of a canvas for a page', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const got: UnderlayRaster[] = [];
    const c = pages.client([def('9A', 'plan.pdf')], (_d, r) => got.push(r!));
    c.request(req('9A', 10));
    c.request(req('9A', 40));
    await settle();
    expect(pdf.drawn).toEqual([{ page: 1, width: 80, height: 40 }]);
    expect(got).toHaveLength(1);
  });

  it('serves a waiting request when its file is added, and drops the old file’s pages', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open);
    const got: UnderlayRaster[] = [];
    const c = pages.client([def('9A', 'C:\\work\\plan.pdf')], (_d, r) => got.push(r!));
    c.request(req('9A', 10));
    await settle();
    expect(got).toEqual([]);
    pages.add('plan.pdf', new Uint8Array([1]));
    await settle();
    expect(got).toHaveLength(1);
    // A new version of the file: drawn again from it.
    pages.add('plan.pdf', new Uint8Array([2]));
    await settle();
    expect(pdf.opened).toHaveLength(2);
    expect(pages.renders).toBe(2);
    expect(got).toHaveLength(2);
  });

  it('serves nothing to a disposed canvas or for a definition it does not know', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const got: unknown[] = [];
    const c = pages.client([def('9A', 'plan.pdf')], (d) => got.push(d));
    c.request(req('77', 10));
    c.request(req('9A', 10));
    c.dispose();
    await settle();
    expect(got).toEqual([]);
  });

  it('evicts the least recently used pages past the cache size', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open, { cacheBytes: 2 * 20 * 10 * 4 });
    pages.add('plan.pdf', new Uint8Array([1]));
    const c = pages.client([def('9A', 'plan.pdf')], () => {});
    for (const x of [0, 3, 6, 0]) {
      c.request(req('9A', 10, x, 0, x + 2, 1));
      await settle();
    }
    // Three regions fit two at a time: the first was evicted and is drawn again.
    expect(pages.renders).toBe(4);
  });

  it('shows the first page for a page it cannot read as a number', async () => {
    const pdf = fakePdf();
    const pages = new PdfPages(pdf.open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const c = pages.client([def('9A', 'plan.pdf', 'A-101'), def('9B', 'plan.pdf', '7')], () => {});
    c.request(req('9A', 10));
    c.request(req('9B', 12));
    await settle();
    expect(pdf.drawn.map((d) => d.page)).toEqual([1, 1]);
  });

  it('delivers each definition its page geometry once, read once per page (M2-22)', async () => {
    const pages = new PdfPages(fakePdf().open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const snaps: [string, number[]][] = [];
    const c = pages.client(
      [def('9A', 'plan.pdf', '2'), def('9B', 'plan.pdf', '2'), def('9C', 'plan.pdf', '1')],
      () => {},
      (d, page) => snaps.push([d, Array.from(page!.lines)]),
    );
    c.request(req('9A', 10));
    c.request(req('9A', 20));
    c.request(req('9B', 10));
    c.request(req('9C', 10));
    await settle();
    await settle();
    expect(snaps.sort()).toEqual([
      ['9A', [0, 0, 2, 2]],
      ['9B', [0, 0, 2, 2]],
      ['9C', [0, 0, 1, 1]],
    ]);
    expect(pages.snapReads).toBe(2);
  });

  it('sends the geometry again when the file is replaced, and none for a file it cannot read', async () => {
    const pdf = fakePdf();
    let fail = false;
    const open = async (bytes: Uint8Array) => {
      const f = await pdf.open(bytes);
      return fail
        ? {
            ...f,
            snapGeometry: () => Promise.reject(new Error('bad')) as Promise<UnderlaySnapPage>,
          }
        : f;
    };
    const pages = new PdfPages(open);
    pages.add('plan.pdf', new Uint8Array([1]));
    const snaps: string[] = [];
    const c = pages.client(
      [def('9A', 'plan.pdf', '2')],
      () => {},
      (d) => snaps.push(d),
    );
    c.request(req('9A', 10));
    await settle();
    expect(snaps).toEqual(['9A']);
    pages.add('PLAN.PDF', new Uint8Array([2]));
    await settle();
    expect(snaps).toEqual(['9A', '9A']);
    fail = true;
    pages.add('plan.pdf', new Uint8Array([3]));
    await settle();
    expect(snaps).toEqual(['9A', '9A']);
  });
});
