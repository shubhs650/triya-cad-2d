// Generated benchmark drawings (M1-42, DEC-045). The owner decided (2026-11-02) that the PRD
// §12 performance targets are measured on synthetic drawings instead of owner-provided
// bench-*.dwg files. These are built with acad-ts from a seeded generator, so every run gets
// the same bytes, and nobody has to supply a file.
//
// bench-100k: PRD T2's large drawing: 100k model-space entities, 50 block definitions,
// 5 layouts. bench-ga: a vessel-GA-sized drawing (PRD §6: typical GAs are 5–30k entities).
// The entity mix leans on what a drafted GA holds (lines and polylines first, then circles,
// arcs, block references and text); dimensions and hatches are left out until Triya
// generates their geometry itself (M2-10, M3).
import {
  ACadVersion,
  Arc,
  BlockRecord,
  CadDocument,
  Circle,
  Color,
  DwgWriter,
  Insert,
  Layer,
  Layout,
  Line,
  LwPolyline,
  MText,
  TextEntity,
  XY,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';

export interface BenchSpec {
  readonly name: string;
  /** Entities in model space (block contents and paper space not counted). */
  readonly entities: number;
  readonly blocks: number;
  /** Paper-space layouts, besides Model. */
  readonly layouts: number;
  readonly layers: number;
  readonly seed: number;
}

export const BENCH_100K: BenchSpec = {
  name: 'bench-100k',
  entities: 100_000,
  blocks: 50,
  layouts: 5,
  layers: 20,
  seed: 100_000,
};

/**
 * The app's canvas, in CSS pixels, in the 1366 × 768 window the app perf spec (M1-60) uses.
 * The drawings are saved zoomed to their extents in it.
 */
export const BENCH_WINDOW = { width: 1341, height: 682 } as const;

export const BENCH_GA: BenchSpec = {
  name: 'bench-ga',
  entities: 25_000,
  blocks: 30,
  layouts: 2,
  layers: 12,
  seed: 25_000,
};

/** Model-space entity mix, in percent; each kind takes a contiguous share of the indices. */
export const BENCH_MIX = [
  ['LINE', 40],
  ['LWPOLYLINE', 15],
  ['CIRCLE', 10],
  ['ARC', 10],
  ['INSERT', 10],
  ['TEXT', 10],
  ['MTEXT', 5],
] as const;

export type BenchKind = (typeof BENCH_MIX)[number][0];

/** Entities of each kind in a spec's model space. */
export function benchCounts(spec: BenchSpec): Record<BenchKind, number> {
  const out = {} as Record<BenchKind, number>;
  let left = spec.entities;
  BENCH_MIX.forEach(([kind, pct], i) => {
    const n = i === BENCH_MIX.length - 1 ? left : Math.round((spec.entities * pct) / 100);
    out[kind] = n;
    left -= n;
  });
  return out;
}

/** mulberry32: a small seeded PRNG, so the drawing is the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A block definition: a small equipment symbol of 12 lines, arcs and circles. */
function blockContents(rnd: () => number): Entity[] {
  const out: Entity[] = [];
  const r = 5 + rnd() * 5;
  out.push(new Circle(new XYZ(0, 0, 0), r));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    out.push(
      new Line(
        new XYZ(r * Math.cos(a), r * Math.sin(a), 0),
        new XYZ(1.5 * r * Math.cos(a), 1.5 * r * Math.sin(a), 0),
      ),
    );
  }
  out.push(new Arc(new XYZ(0, 0, 0), r * 0.6, 0, Math.PI));
  out.push(new Arc(new XYZ(0, 0, 0), r * 0.4, Math.PI, 2 * Math.PI));
  const box = new LwPolyline([
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ] as unknown as XY[]);
  box.isClosed = true;
  out.push(box);
  return out;
}

/** Builds the drawing: entities laid out on a 1000-column grid of 20-unit cells. */
export function benchDocument(spec: BenchSpec, version = ACadVersion.AC1032): CadDocument {
  const rnd = random(spec.seed);
  const doc = new CadDocument(version);
  doc.updateCollections(true, true);

  const layers: Layer[] = [];
  for (let i = 0; i < spec.layers; i++) {
    const layer = new Layer(`BENCH-${String(i).padStart(2, '0')}`);
    layer.color = new Color(1 + (i % 7));
    doc.layers!.add(layer);
    layers.push(doc.layers!.tryGetValue(layer.name) ?? layer);
  }

  const blocks: BlockRecord[] = [];
  for (let i = 0; i < spec.blocks; i++) {
    const block = new BlockRecord(`BENCH_SYMBOL_${String(i).padStart(2, '0')}`);
    for (const e of blockContents(rnd)) block.entities.add(e);
    doc.blockRecords!.add(block);
    blocks.push(block);
  }

  const counts = benchCounts(spec);
  let i = 0;
  for (const [kind] of BENCH_MIX) {
    for (let n = 0; n < counts[kind]; n++, i++) {
      const x = (i % 1000) * 20 + rnd() * 4;
      const y = Math.floor(i / 1000) * 20 + rnd() * 4;
      const e = entity(kind, x, y, rnd, blocks, i);
      doc.entities!.add(e);
      e.layer = layers[i % layers.length]!;
    }
  }

  saveZoomedToExtents(doc, i);

  // Layouts: the default one plus new ones, each with a sheet border and title block.
  doc.layouts!.add(doc.modelSpace!.layout!);
  doc.layouts!.add(doc.paperSpace!.layout!);
  const sheets: BlockRecord[] = [doc.paperSpace!];
  for (let k = 1; k < spec.layouts; k++) {
    const record = new BlockRecord(`*Paper_Space${k - 1}`);
    const layout = new Layout(`Sheet ${k + 1}`);
    layout.associatedBlock = record;
    layout.tabOrder = k + 1;
    doc.blockRecords!.add(record);
    doc.layouts!.add(layout);
    sheets.push(record);
  }
  for (const sheet of sheets) {
    const border = new LwPolyline([
      [0, 0],
      [841, 0],
      [841, 594],
      [0, 594],
    ] as unknown as XY[]);
    border.isClosed = true;
    sheet.entities.add(border);
    sheet.entities.add(new Line(new XYZ(661, 0, 0), new XYZ(661, 60, 0)));
    sheet.entities.add(new Line(new XYZ(661, 60, 0), new XYZ(841, 60, 0)));
    const title = new TextEntity(`${spec.name} ${sheet.name}`);
    title.insertPoint = new XYZ(671, 30, 0);
    title.height = 5;
    sheet.entities.add(title);
  }
  return doc;
}

/**
 * Saves the model-space view (the `*Active` VPORT) zoomed to the extents of the `n` entities'
 * 20-unit grid cells in BENCH_WINDOW, with Zoom Extents' 5 % margin, as a drafter saves a
 * finished drawing. The app opens a drawing in that view (M1-22 part 3), so the perf
 * gestures start with every entity in view, as they did when the app opened at the extents.
 */
function saveZoomedToExtents(doc: CadDocument, n: number): void {
  const w = Math.min(n, 1000) * 20 + 4;
  const h = Math.ceil(n / 1000) * 20 + 4;
  const aspect = BENCH_WINDOW.width / BENCH_WINDOW.height;
  const active = [...doc.vPorts!].find((v) => v.name.toUpperCase() === '*ACTIVE')!;
  active.center = new XY(w / 2, h / 2);
  active.viewHeight = Math.max(h, w / aspect) / 0.9;
  active.aspectRatio = aspect;
}

function entity(
  kind: BenchKind,
  x: number,
  y: number,
  rnd: () => number,
  blocks: readonly BlockRecord[],
  i: number,
): Entity {
  switch (kind) {
    case 'LINE':
      return new Line(new XYZ(x, y, 0), new XYZ(x + 4 + rnd() * 12, y + rnd() * 12, 0));
    case 'LWPOLYLINE': {
      const pts = Array.from({ length: 3 + Math.floor(rnd() * 6) }, (_, k) => [
        x + k * 2.5,
        y + rnd() * 10,
      ]);
      return new LwPolyline(pts as unknown as XY[]);
    }
    case 'CIRCLE':
      return new Circle(new XYZ(x + 8, y + 8, 0), 1 + rnd() * 7);
    case 'ARC': {
      const start = rnd() * 2 * Math.PI;
      return new Arc(new XYZ(x + 8, y + 8, 0), 1 + rnd() * 7, start, start + 0.5 + rnd() * 4);
    }
    case 'INSERT': {
      const ins = new Insert(blocks[i % blocks.length]!);
      ins.insertPoint = new XYZ(x + 8, y + 8, 0);
      ins.rotation = rnd() * 2 * Math.PI;
      const s = 0.3 + rnd() * 0.4;
      ins.xScale = s;
      ins.yScale = s;
      return ins;
    }
    case 'TEXT': {
      const t = new TextEntity(`N${i} DN${50 + (i % 20) * 25}`);
      t.insertPoint = new XYZ(x, y + 2, 0);
      t.height = 1.5 + rnd() * 2;
      return t;
    }
    case 'MTEXT': {
      const t = new MText(`NOTE ${i}\\PSEE DETAIL ${i % 40}`);
      t.insertPoint = new XYZ(x, y + 14, 0);
      t.height = 1.5;
      t.rectangleWidth = 16;
      return t;
    }
  }
}

/** The drawing as DWG bytes (AutoCAD 2018 format). */
export function benchDwg(spec: BenchSpec): Uint8Array {
  return DwgWriter.writeToBuffer(benchDocument(spec));
}
