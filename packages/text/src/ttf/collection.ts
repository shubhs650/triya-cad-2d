// TrueType/OpenType collections (.ttc, M2-16 part 4): one file holding several faces that share
// tables (msgothic.ttc holds MS Gothic, MS UI Gothic and MS PGothic). opentype.js reads single
// fonts only, so each face is copied out into a font file of its own: its table directory, its
// tables at new offsets, checksums kept. The copy is what a face's `TtfFont.bytes` holds, so a
// PDF plot embeds that face alone. Format: OpenType spec, "Font Collections" ('ttcf' header,
// then one offset per face to its table directory; table offsets count from the file start).
// No DOM here.

/** The faces of a collection as single-font files, or undefined when `bytes` is no collection. */
export function collectionFaces(bytes: Uint8Array): Uint8Array[] | undefined {
  if (bytes.length < 12 || tag(bytes, 0) !== 'ttcf') return undefined;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint32(8);
  if (count === 0 || 12 + 4 * count > bytes.length) throw new Error('empty font collection');
  const faces: Uint8Array[] = [];
  for (let i = 0; i < count; i++) faces.push(face(bytes, v, v.getUint32(12 + 4 * i)));
  return faces;
}

function face(bytes: Uint8Array, v: DataView, dir: number): Uint8Array {
  if (dir + 12 > bytes.length) throw new Error('font collection face out of range');
  const n = v.getUint16(dir + 4);
  if (dir + 12 + 16 * n > bytes.length) throw new Error('font collection face out of range');
  const pad4 = (x: number) => (x + 3) & ~3;
  const tables: { entry: number; offset: number; length: number }[] = [];
  let size = 12 + 16 * n;
  for (let i = 0; i < n; i++) {
    const entry = dir + 12 + 16 * i;
    const offset = v.getUint32(entry + 8);
    const length = v.getUint32(entry + 12);
    if (offset + length > bytes.length) throw new Error('font collection table out of range');
    tables.push({ entry, offset, length });
    size += pad4(length);
  }
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  // The face's header (sfnt version, table count, search fields) as the collection has it.
  out.set(bytes.subarray(dir, dir + 12), 0);
  let at = 12 + 16 * n;
  tables.forEach((t, i) => {
    const e = 12 + 16 * i;
    out.set(bytes.subarray(t.entry, t.entry + 8), e); // tag and checksum
    o.setUint32(e + 8, at);
    o.setUint32(e + 12, t.length);
    out.set(bytes.subarray(t.offset, t.offset + t.length), at);
    at += pad4(t.length);
  });
  return out;
}

const tag = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
