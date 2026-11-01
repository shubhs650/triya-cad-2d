// The stand-in font the corpus render tests draw text with. No real font is committed
// (CLAUDE.md "No Autodesk assets"), so every style falls back to it through FONTALT.

/** "AutoCAD-86 shapes 1.0": every printable ASCII code a square advancing 2 units; above 2. */
export function squareFont(): Uint8Array {
  const square = [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0];
  const shapes: { code: number; body: number[] }[] = [
    { code: 0, body: [...Buffer.from('Square'), 0, 2, 1, 0, 0] },
  ];
  for (let c = 32; c < 127; c++)
    shapes.push({ code: c, body: [0x41, 0, ...(c === 32 ? [2, 0x20, 0] : square)] });
  const out: number[] = [...Buffer.from('AutoCAD-86 shapes 1.0\r\n\x1a')];
  const u16 = (v: number) => out.push(v & 0xff, v >> 8);
  u16(0);
  u16(126);
  u16(shapes.length);
  for (const s of shapes) {
    u16(s.code);
    u16(s.body.length);
  }
  for (const s of shapes) out.push(...s.body);
  return Uint8Array.from(out);
}
