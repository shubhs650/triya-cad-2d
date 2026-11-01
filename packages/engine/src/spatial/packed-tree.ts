// A static packed R-tree (the flatbush layout ARCHITECTURE.md §4 names): items sorted along a
// Hilbert curve, grouped `nodeSize` at a time into parents, level by level, in flat typed
// arrays. It is built once and never edited; removals mark items dead, and the owning index
// keeps edits in a small overlay until it is cheaper to rebuild (see spatial-index.ts).

import type { Box } from '../geom/bounds';

export interface TreeItem {
  readonly id: number;
  readonly box: Box;
}

/** Hilbert curve order of 16 bits per axis is plenty to keep neighbours together. */
const HILBERT_SIDE = 1 << 16;

/** Distance of (x, y) along the Hilbert curve filling a HILBERT_SIDE square. */
function hilbert(px: number, py: number): number {
  let x = px;
  let y = py;
  let d = 0;
  for (let s = HILBERT_SIDE >>> 1; s > 0; s >>>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate the quadrant so the sub-curve keeps its orientation.
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

export class PackedRTree {
  readonly #nodeSize: number;
  /** Boxes per level, four numbers per node; level 0 holds the items, the last the root. */
  readonly #levels: Float64Array[];
  /** How many level-0 items one node of each level covers (nodeSize ** level). */
  readonly #span: number[];
  readonly #ids: Int32Array;
  readonly #position = new Map<number, number>();
  readonly #dead: Uint8Array;
  #deadCount = 0;

  private constructor(nodeSize: number, levels: Float64Array[], ids: Int32Array) {
    this.#nodeSize = nodeSize;
    this.#levels = levels;
    this.#ids = ids;
    this.#dead = new Uint8Array(ids.length);
    this.#span = levels.map((_, l) => nodeSize ** l);
    for (let i = 0; i < ids.length; i++) this.#position.set(ids[i]!, i);
  }

  static build(items: readonly TreeItem[], nodeSize = 16): PackedRTree {
    const n = items.length;
    if (n === 0) return new PackedRTree(nodeSize, [], new Int32Array(0));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { box } of items) {
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }
    const kx = (HILBERT_SIDE - 1) / (maxX - minX || 1);
    const ky = (HILBERT_SIDE - 1) / (maxY - minY || 1);
    const keys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const { box } = items[i]!;
      const hx = Math.floor(((box.minX + box.maxX) / 2 - minX) * kx);
      const hy = Math.floor(((box.minY + box.maxY) / 2 - minY) * ky);
      keys[i] = hilbert(hx, hy);
    }
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => keys[a]! - keys[b]!);

    const leaves = new Float64Array(4 * n);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const { id, box } = items[order[i]!]!;
      ids[i] = id;
      leaves.set([box.minX, box.minY, box.maxX, box.maxY], 4 * i);
    }
    const levels = [leaves];
    for (let below = leaves, count = n; count > 1;) {
      const parents = Math.ceil(count / nodeSize);
      const level = new Float64Array(4 * parents);
      for (let p = 0; p < parents; p++) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        const end = Math.min((p + 1) * nodeSize, count);
        for (let c = p * nodeSize; c < end; c++) {
          x0 = Math.min(x0, below[4 * c]!);
          y0 = Math.min(y0, below[4 * c + 1]!);
          x1 = Math.max(x1, below[4 * c + 2]!);
          y1 = Math.max(y1, below[4 * c + 3]!);
        }
        level.set([x0, y0, x1, y1], 4 * p);
      }
      levels.push(level);
      below = level;
      count = parents;
    }
    return new PackedRTree(nodeSize, levels, ids);
  }

  /** Items the tree was built with, dead ones included. */
  get size(): number {
    return this.#ids.length;
  }

  get deadCount(): number {
    return this.#deadCount;
  }

  /** Marks an item dead so searches skip it. False if it was not in the tree or already dead. */
  kill(id: number): boolean {
    const at = this.#position.get(id);
    if (at === undefined || this.#dead[at] === 1) return false;
    this.#dead[at] = 1;
    this.#deadCount++;
    return true;
  }

  /** Appends to `out` the id of every live item whose box overlaps `q` (edges touching count). */
  search(q: Box, out: number[]): void {
    const top = this.#levels.length - 1;
    if (top < 0) return;
    const stack: number[] = [];
    const roots = this.#levels[top]!.length / 4;
    for (let i = 0; i < roots; i++) stack.push(top, i);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const level = stack.pop()!;
      const boxes = this.#levels[level]!;
      const x0 = boxes[4 * i]!;
      const y0 = boxes[4 * i + 1]!;
      const x1 = boxes[4 * i + 2]!;
      const y1 = boxes[4 * i + 3]!;
      if (x0 > q.maxX || x1 < q.minX || y0 > q.maxY || y1 < q.minY) continue;
      if (level === 0) {
        if (this.#dead[i] === 0) out.push(this.#ids[i]!);
      } else if (x0 >= q.minX && x1 <= q.maxX && y0 >= q.minY && y1 <= q.maxY) {
        // Wholly inside the query: every item below is a hit, no more box tests.
        const span = this.#span[level]!;
        this.#emit(i * span, Math.min((i + 1) * span, this.#ids.length), out);
      } else {
        const below = this.#levels[level - 1]!.length / 4;
        const end = Math.min((i + 1) * this.#nodeSize, below);
        for (let c = i * this.#nodeSize; c < end; c++) stack.push(level - 1, c);
      }
    }
  }

  #emit(from: number, to: number, out: number[]): void {
    // Growing `out` once and writing by index is about 3x faster than pushing one by one,
    // which matters for zoom-extents queries that return every entity.
    const ids = this.#ids;
    const dead = this.#dead;
    let n = out.length;
    out.length = n + (to - from);
    if (this.#deadCount === 0) {
      for (let k = from; k < to; k++) out[n++] = ids[k]!;
    } else {
      for (let k = from; k < to; k++) if (dead[k] === 0) out[n++] = ids[k]!;
    }
    out.length = n;
  }
}
