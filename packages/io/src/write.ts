import { DwgWriter, DxfWriter, type CadDocument } from '@node-projects/acad-ts';
import type { CadFormat } from './read';

export interface WriteOptions {
  format: CadFormat;
  /** DXF only: binary instead of ASCII. */
  binary?: boolean;
  /** DXF ASCII only: starting size of the output buffer; it doubles until the file fits. */
  initialBufferBytes?: number;
}

/**
 * Serialise an acad-ts `CadDocument` in the version its header names.
 * This is the raw writer call; the passthrough-preserving export (ARCHITECTURE.md §6.1,
 * M1-05) is built on top of it.
 */
export function writeCadDocument(doc: CadDocument, options: WriteOptions): Uint8Array {
  if (options.format === 'dwg') return DwgWriter.writeToBuffer(doc);
  if (options.binary === true) {
    const chunks: Uint8Array[] = [];
    DxfWriter.writeToStream(
      { write: (bytes: Uint8Array) => void chunks.push(bytes.slice()) },
      doc,
      true,
    );
    return concat(chunks);
  }
  // ASCII DXF: let acad-ts encode text in the document's code page by writing into a
  // byte buffer. DXF text never contains NUL, so the file ends at the last non-zero byte.
  let size = options.initialBufferBytes ?? 1 << 20;
  for (;;) {
    const buffer = new Uint8Array(size);
    try {
      DxfWriter.writeToStream(buffer, doc, false);
    } catch (err) {
      if (err instanceof Error && err.message === 'DXF output buffer is too small.') {
        size *= 2;
        continue;
      }
      throw err;
    }
    let end = buffer.length;
    while (end > 0 && buffer[end - 1] === 0) end--;
    return buffer.slice(0, end);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
