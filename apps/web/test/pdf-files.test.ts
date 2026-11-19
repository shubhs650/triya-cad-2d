// M5-04 part 13: -PDFATTACH's file named at the command line (`pdfFile`), found by name among the
// places the app holds PDFs, in order, with every page's size; the one found is served to the
// drawing's underlays.
import { describe, expect, it } from 'vitest';
import { pdfFileReply } from '../src/pdf-files';
import type { FileSource } from '../src/xrefs';

const source = (name: string, text = name): FileSource => ({
  name,
  getFile: () => Promise.resolve(new Blob([text])),
});

/** A file's pages: one 8.5 × 11 page a character, as a stand-in for pdf.js reading it. */
const pagesOf = (bytes: Uint8Array) =>
  Promise.resolve(bytes.length ? [...bytes].map(() => ({ width: 8.5, height: 11 })) : undefined);

function lookup(file: string, places: FileSource[][]) {
  const found: [string, string][] = [];
  const read: number[] = [];
  const reply = pdfFileReply(
    file,
    places.map((p, i) => () => {
      read.push(i);
      return Promise.resolve(p);
    }),
    {
      pages: pagesOf,
      found: (name, bytes) => found.push([name, new TextDecoder().decode(bytes)]),
    },
  );
  return { reply, found, read };
}

describe('pdfFileReply', () => {
  it('finds a PDF by name, folders, case and the extension aside, in the first place holding it', async () => {
    const t = lookup('C:\\work\\PLAN', [[source('plan.dxf')], [source('Plan.pdf', 'ab')], []]);
    expect(await t.reply).toEqual({
      ok: true,
      pdfFile: {
        fileName: 'Plan.pdf',
        pages: [
          { page: '1', width: 8.5, height: 11 },
          { page: '2', width: 8.5, height: 11 },
        ],
      },
    });
    expect(t.found).toEqual([['Plan.pdf', 'ab']]);
    // Places after the one that held it are not read.
    expect(t.read).toEqual([0, 1]);
  });

  it('takes a name in quotes, with spaces, and the extension typed', async () => {
    const places = [[source('site plan.pdf', 'x')]];
    expect(await lookup('"site plan.pdf"', places).reply).toMatchObject({
      ok: true,
      pdfFile: { fileName: 'site plan.pdf' },
    });
    expect(await lookup('site plan.png', places).reply).toEqual({ ok: true });
  });

  it('answers no file when none is held, and why one cannot be attached', async () => {
    const none = lookup('elevation', [[source('plan.pdf')], [source('elevation.dxf')]]);
    expect(await none.reply).toEqual({ ok: true });
    expect(none.found).toEqual([]);
    const empty = lookup('blank', [[source('blank.pdf', '')]]);
    expect(await empty.reply).toEqual({
      ok: false,
      message: 'blank.pdf is not a PDF file Triya can attach.',
    });
    expect(empty.found).toEqual([]);
    const gone = pdfFileReply(
      'plan',
      [() => [{ name: 'plan.pdf', getFile: () => Promise.reject(new Error('moved')) }]],
      { pages: pagesOf, found: () => {} },
    );
    expect(await gone).toEqual({ ok: false, message: 'plan.pdf could not be read: moved' });
  });
});
