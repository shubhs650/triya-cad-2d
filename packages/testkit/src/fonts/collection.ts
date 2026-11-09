// A TrueType/OpenType collection (.ttc) of test fonts (M2-16 part 4), written here so no
// third-party collection is committed or read: a 'ttcf' version 1.0 header, one table directory
// per face, and each distinct table stored once (identical tables are shared between faces, as
// real collections share them).
import { readSfnt } from '@triya/pdf';

const pad4 = (n: number) => (n + 3) & ~3;

/** The collection of `fonts` (single-font files), faces in the order given. */
export function testCollection(fonts: readonly Uint8Array[]): Uint8Array {
  const faces = fonts.map((f) => {
    const sfnt = readSfnt(f);
    if (!sfnt) throw new Error('not a font file');
    const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const tags = [...sfnt.tables.keys()].sort();
    const sums = new Map(tags.map((_, i) => [tags[i]!, v.getUint32(12 + 16 * i + 4)]));
    return { header: f.subarray(0, 12), tables: sfnt.tables, tags, sums };
  });
  const key = (b: Uint8Array) => Buffer.from(b).toString('base64');
  const stored = new Map<string, { at: number; data: Uint8Array }>();
  let at = 12 + 4 * faces.length;
  for (const f of faces) at += 12 + 16 * f.tags.length;
  for (const f of faces)
    for (const t of f.tags) {
      const data = f.tables.get(t)!;
      if (stored.has(key(data))) continue;
      stored.set(key(data), { at, data });
      at += pad4(data.length);
    }
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0); // 'ttcf'
  v.setUint32(4, 0x00010000);
  v.setUint32(8, faces.length);
  let dir = 12 + 4 * faces.length;
  faces.forEach((f, i) => {
    v.setUint32(12 + 4 * i, dir);
    out.set(f.header, dir);
    f.tags.forEach((t, k) => {
      const e = dir + 12 + 16 * k;
      const s = stored.get(key(f.tables.get(t)!))!;
      for (let c = 0; c < 4; c++) out[e + c] = t.charCodeAt(c);
      v.setUint32(e + 4, f.sums.get(t)!);
      v.setUint32(e + 8, s.at);
      v.setUint32(e + 12, s.data.length);
    });
    dir += 12 + 16 * f.tags.length;
  });
  for (const s of stored.values()) out.set(s.data, s.at);
  return out;
}
