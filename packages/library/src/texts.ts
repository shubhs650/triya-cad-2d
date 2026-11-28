// What the library's annotation symbols share (M8-02 parts 2 and 3): a TEXT placed by its
// alignment point, the drawing's current text style and a digest for block names.
import type { DocumentModel, Handle, TextGeometry, Vec2 } from '@triya/engine';
import type { LibraryPart } from './parts';

/** DXF 72 and 73. */
export const LEFT = 0;
export const CENTRE = 1;
export const RIGHT = 2;
export const BOTTOM = 1;
export const MIDDLE = 2;
export const TOP = 3;

/**
 * A TEXT placed by its alignment point: the library cannot measure text (the engine has no
 * fonts), so no placement depends on a text's width (DEC-093).
 */
export function text(
  value: string,
  at: Vec2,
  h: number,
  halign: number,
  valign: number,
  style: Handle,
): LibraryPart {
  const geom: TextGeometry = {
    kind: 'TEXT',
    value,
    style,
    position: at,
    alignmentPoint: at,
    height: h,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign,
    valign,
    backward: false,
    upsideDown: false,
  };
  return { role: 'visible', geom };
}

/** The style TEXTSTYLE names, else Standard, else the first (as TEXT and MTEXT start with). */
export function currentTextStyle(model: DocumentModel): Handle | undefined {
  const name = model.header.get('$TEXTSTYLE');
  const styles = [...model.tables.textStyles.values()];
  const named = (n: string) => styles.find((s) => s.name.toUpperCase() === n.toUpperCase());
  return ((typeof name === 'string' ? named(name) : undefined) ?? named('Standard') ?? styles[0])
    ?.handle;
}

/** FNV-1a, 32 bits, of the string's UTF-16 code units, as eight hex digits. */
export function digest(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, '0');
}

/** A dimension in a description: at most four decimals, without trailing zeros. */
export function figure(v: number): string {
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/** True when `v` is absent or has no line break. */
export const oneLine = (v: string | undefined) => v === undefined || !/[\r\n]/.test(v);
