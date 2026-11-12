// The files of a downloaded ZIP (M2-39 part 4: PUBLISH and All layouts to SVG or PNG), read from
// its central directory (APPNOTE.TXT §4.3.12) with Node's own inflate: names in order, contents
// stored or deflated, as `@triya/pdf` `zipFiles` writes them.
import { inflateRawSync } from 'node:zlib';

export function unzip(zip: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end of central directory record: its signature, searched from the end (no comment).
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP file');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = zip.subarray(data, data + size);
    const bytes = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));
    out.push({ name, bytes });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
