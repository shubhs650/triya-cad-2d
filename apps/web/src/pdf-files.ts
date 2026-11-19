// -PDFATTACH (M5-04 part 13) names a PDF file at the command line; a browser opens no path by
// itself, so the app finds it by name among the PDFs it holds (`pdfFileReply`): those supplied
// this session (dropped, picked in PDFATTACH's dialog or found earlier), then its kept folders.
// pdf.js reads every page's size, which -PDFATTACH lists and places, and the file found is served
// to the drawing's underlays as a dropped one is, so the page draws once attached.
import type { ViewReply } from '@triya/engine';
import type { FileSource } from './xrefs';

/** Somewhere the app holds files: those it holds there, listed when asked. */
export type PdfFilePlace = () => readonly FileSource[] | Promise<readonly FileSource[]>;

export interface PdfFileEnv {
  /** Every page's size in inches, in page order; undefined when pdf.js cannot read the file. */
  pages(
    bytes: Uint8Array,
  ): Promise<readonly { readonly width: number; readonly height: number }[] | undefined>;
  /** The file found: the app serves it to the drawing's underlays. */
  found(name: string, bytes: Uint8Array): void;
}

const PDF = /\.pdf$/i;

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The reply to -PDFATTACH's `pdfFile`: the PDF file `file` names (folders and enclosing quotes
 * aside, any case; without an extension a .pdf of that name), the first held in `places` in
 * order, with its pages; no file when none is held.
 */
export async function pdfFileReply(
  file: string,
  places: readonly PdfFilePlace[],
  env: PdfFileEnv,
): Promise<ViewReply> {
  const typed = (
    file
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .split(/[\\/]/)
      .pop() ?? ''
  ).toUpperCase();
  const matches = (name: string) =>
    PDF.test(name) &&
    (name.toUpperCase() === typed || name.replace(PDF, '').toUpperCase() === typed);
  for (const place of places) {
    const source = (await place()).find((s) => matches(s.name));
    if (!source) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await (await source.getFile()).arrayBuffer());
    } catch (e) {
      return { ok: false, message: `${source.name} could not be read: ${reason(e)}` };
    }
    const sizes = await env.pages(bytes).catch(() => undefined);
    if (!sizes || sizes.length === 0)
      return { ok: false, message: `${source.name} is not a PDF file Triya can attach.` };
    env.found(source.name, bytes);
    return {
      ok: true,
      pdfFile: {
        fileName: source.name,
        pages: sizes.map((s, i) => ({ page: String(i + 1), width: s.width, height: s.height })),
      },
    };
  }
  return { ok: true };
}
