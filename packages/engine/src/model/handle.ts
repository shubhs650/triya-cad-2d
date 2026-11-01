// AutoCAD object handles (DXF group 5/105, DWG handle stream).
//
// A handle is a 1–16 digit hexadecimal number, unique within a drawing and never reused:
// AutoCAD stores the next free value in `$HANDSEED`. Triya keeps handles as canonical strings
// (upper case, no leading zeros) so they can be Map keys, and does arithmetic with BigInt
// because handles are 64-bit. Handles read from a file are never renumbered
// (ARCHITECTURE.md §4.1, "Handles are sacred"); new objects get handles from `HandleAllocator`.

/** Canonical AutoCAD handle: upper-case hex, no leading zeros, at most 16 digits. */
export type Handle = string;

/** Handle 0 means "no object" in DXF/DWG references (e.g. a root dictionary's owner). */
export const NULL_HANDLE: Handle = '0';

const MAX_HANDLE = (1n << 64n) - 1n;
const HEX = /^[0-9A-Fa-f]{1,16}$/;
const CANONICAL = /^(?:0|[1-9A-F][0-9A-F]{0,15})$/;

/** True when `h` is already in canonical form (what every `Handle` in the model must be). */
export function isHandle(h: string): boolean {
  return CANONICAL.test(h);
}

/** Turns a handle as found in a file (`'001f'`, `' 2A '`) into canonical form. */
export function normalizeHandle(input: string): Handle {
  const s = input.trim().replace(/^0+(?=.)/, '');
  if (!HEX.test(s)) throw new Error(`invalid handle ${JSON.stringify(input)}`);
  return s.toUpperCase();
}

export function handleToBigInt(h: Handle): bigint {
  return BigInt(`0x${h}`);
}

/** Numeric order (`F` < `10`), for sorting and for comparisons against `$HANDSEED`. */
export function compareHandles(a: Handle, b: Handle): number {
  // Canonical handles have no leading zeros, so length decides first, then lexical order.
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Throws unless `h` is canonical and not the null handle; used at model boundaries. */
export function assertObjectHandle(h: string, what = 'handle'): asserts h is Handle {
  if (!isHandle(h)) throw new Error(`${what} ${JSON.stringify(h)} is not a canonical handle`);
  if (h === NULL_HANDLE) throw new Error(`${what} cannot be the null handle`);
}

/**
 * Hands out new handles at and above `$HANDSEED` and tracks the value to write back.
 *
 * The seed only ever grows: undoing an addition does not give its handle back, matching
 * AutoCAD, which never reuses a handle within a drawing. If the file's `$HANDSEED` is not above
 * every handle actually present (seen in damaged files), the seed is raised past the largest one,
 * which is what AutoCAD's AUDIT does; `seedWasRaised` lets the health report say so.
 */
export class HandleAllocator {
  #next: bigint;
  readonly seedWasRaised: boolean;

  constructor(handSeed: Handle, existing: Iterable<Handle> = []) {
    const seed = handleToBigInt(normalizeHandle(handSeed));
    let floor = 1n;
    for (const h of existing) {
      const n = handleToBigInt(h) + 1n;
      if (n > floor) floor = n;
    }
    this.seedWasRaised = floor > seed && floor > 1n;
    this.#next = seed > floor ? seed : floor;
  }

  /** The next free handle: the value to store in `$HANDSEED` on export. */
  get handSeed(): Handle {
    return this.#next.toString(16).toUpperCase();
  }

  allocate(): Handle {
    if (this.#next > MAX_HANDLE) throw new Error('handle space exhausted ($HANDSEED past 2^64-1)');
    const h = this.#next.toString(16).toUpperCase();
    this.#next += 1n;
    return h;
  }

  /** Keeps the seed above a handle that entered the model without going through `allocate`. */
  observe(handle: Handle): void {
    const n = handleToBigInt(handle) + 1n;
    if (n > this.#next) this.#next = n;
  }
}
