// Quick Properties (M2-35 part 16; AutoCAD 2024 Help, "Quick Properties Palette", "QPMODE",
// "Quick Properties Tab (Drafting Settings Dialog Box)"): when it shows and where. It shows for
// the objects picked at `Command:` while QPMODE is on, unless the Properties palette is open
// (which shows them already); QPMODE 2 only where a selected type has quick properties of its
// own. By the cursor (QPLOCATION 0) it goes above and to the right of where the pick was made,
// 50 pixels away: the Drafting Settings tab's Quadrant and Distance in Pixels, whose values
// Help does not state, so Triya takes the dialog's (top right, 50). Static (QPLOCATION 1) it
// stays where the drafter dragged it, top left of the drawing area at first. Either way it is
// kept inside the drawing area.
import { hasQuickProperties, type PropertySheet } from '@triya/engine';

/** Distance in Pixels: how far from the cursor. */
export const QP_DISTANCE = 50;
/** Collapse Palette Automatically's Minimum Number of Rows. */
export const QP_ROWS = 3;
/** The static place before it has been dragged, CSS pixels from the area's top left. */
const STATIC = { left: 8, top: 8 } as const;

export interface Placement {
  readonly left: number;
  readonly top: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

export function quickPlacement(o: {
  /** QPLOCATION. */
  location: 0 | 1;
  /** Where the pick was made, from the drawing area's top left; none for Ctrl+A. */
  pointer: { x: number; y: number } | undefined;
  /** The palette's size. */
  size: Size;
  /** The drawing area's size. */
  area: Size;
  /** Where the drafter dragged it (static). */
  dragged?: Placement | undefined;
}): Placement {
  const { size, area } = o;
  const at =
    o.location === 0 && o.pointer
      ? { left: o.pointer.x + QP_DISTANCE, top: o.pointer.y - QP_DISTANCE - size.height }
      : (o.dragged ?? STATIC);
  const clamp = (v: number, max: number) => Math.round(Math.max(0, Math.min(v, max)));
  return {
    left: clamp(at.left, area.width - size.width),
    top: clamp(at.top, area.height - size.height),
  };
}

/** Whether Quick Properties shows a sheet at QPMODE `qpmode`. */
export function quickShown(sheet: PropertySheet | undefined, qpmode: number): boolean {
  if (!sheet || sheet.count === 0 || sheet.current || qpmode <= 0) return false;
  return qpmode !== 2 || sheet.types.some((t) => hasQuickProperties(t.type));
}
