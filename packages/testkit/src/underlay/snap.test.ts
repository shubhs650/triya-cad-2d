// M2-22 acceptance: on the M1-20 PDF underlay fixture, pdf.js reads page 2's paths (the same
// operator list the app's pdf.js worker returns), and running object snaps through the
// drawing's second underlay (at (12, 0), scale 0.5, turned 30°, clipped by a pentagon) find
// its grid corners (INT) and triangle vertices (END) within 1e-6 in, and nothing outside the
// clip. Page 1 checks the transform of an image's `cm` and the filled square's `re`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyPoint,
  DocumentModel,
  osnap,
  OSNAP,
  SpatialIndex,
  toleranceForSize,
  underlayMatrix,
  type Handle,
  type PdfDefinition,
  type UnderlayGeometry,
  type UnderlaySnapPage,
  type Vec2,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { underlaySnapFromOperatorList } from '@triya/render';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PAGE2_CLIP, UNDERLAY_DXF_NAME, UNDERLAY_PDF_NAME } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/underlay/', import.meta.url));

async function pages(): Promise<UnderlaySnapPage[]> {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(DIR + UNDERLAY_PDF_NAME)),
    useWasm: false,
    verbosity: 0,
  }).promise;
  const out: UnderlaySnapPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const list = await page.getOperatorList();
    out.push(underlaySnapFromOperatorList(list, OPS, page.getViewport({ scale: 1 })));
  }
  await doc.cleanup();
  return out;
}

/** Segments as rounded [x0, y0, x1, y1] tuples, sorted. */
const segments = (p: UnderlaySnapPage) => {
  const out: number[][] = [];
  for (let i = 0; i < p.lines.length; i += 4)
    out.push(Array.from(p.lines.subarray(i, i + 4)).map((v) => +v.toFixed(9)));
  return out.sort((a, b) => a.join().localeCompare(b.join()));
};

let snapPages: UnderlaySnapPage[];
beforeAll(async () => {
  snapPages = await pages();
});

describe('PDF underlay snap geometry from pdf.js', () => {
  it("reads page 1's square and line, and nothing of its text or image", () => {
    const one = segments(snapPages[0]!);
    expect(one).toEqual(
      [
        // The red square, 1–3 in, closed by its `re`.
        [1, 1, 3, 1],
        [3, 1, 3, 3],
        [3, 3, 1, 3],
        [1, 3, 1, 1],
        // The blue line from (72, 600) to (540, 700) pt.
        [1, 600 / 72, 7.5, 700 / 72],
      ]
        .map((s) => s.map((v) => +v.toFixed(9)))
        .sort((a, b) => a.join().localeCompare(b.join())),
    );
  });

  it("reads page 2's triangle and its 17 grid lines", () => {
    const two = segments(snapPages[1]!);
    expect(two).toHaveLength(3 + 10 + 7);
    expect(two).toContainEqual([2, 2, 9, 2]);
    expect(two).toContainEqual([9, 2, 5.5, 7]);
    expect(two).toContainEqual([5.5, 7, 2, 2]);
    expect(two).toContainEqual([3, 0, 3, 8.5]);
    expect(two).toContainEqual([0, 4, 11, 4]);
  });
});

describe('PDFOSNAP on the M1-20 fixture', () => {
  const tol = toleranceForSize(40);

  function source() {
    const { init } = openDocument(
      readCadDocument(new Uint8Array(readFileSync(DIR + UNDERLAY_DXF_NAME))),
    );
    const model = DocumentModel.create(init);
    const defs = (init.objects ?? []).filter((o): o is PdfDefinition => o.type === 'PDFDEFINITION');
    const byDef = new Map<Handle, UnderlaySnapPage>(
      defs.map((d) => [d.handle, snapPages[Number(d.page) - 1]!]),
    );
    const sizes = new Map<Handle, { width: number; height: number }>(
      defs.map((d) => [
        d.handle,
        d.page === '1' ? { width: 8.5, height: 11 } : { width: 11, height: 8.5 },
      ]),
    );
    const modelSpace = [...model.tables.blockRecords.values()].find(
      (r) => r.name.toLowerCase() === '*model_space',
    )!.handle;
    const underlays = (init.entities ?? [])
      .map((e) => e.geom)
      .filter((g): g is UnderlayGeometry => g.kind === 'PDFUNDERLAY');
    return {
      src: {
        model,
        index: SpatialIndex.build(model, { tol, underlayPage: (h) => sizes.get(h) }),
        block: modelSpace,
        tol,
        underlays: (h: Handle) => byDef.get(h),
      },
      two: underlays.find((u) => u.scale.x === 0.5)!,
    };
  }

  const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

  it('snaps INT to grid corners and END to triangle vertices within 1e-6 in', () => {
    const { src, two } = source();
    const m = underlayMatrix(two);
    // Grid corners inside the pentagon, its corners among them.
    const corners: [number, number][] = [];
    for (let x = 1; x <= 10; x++)
      for (let y = 1; y <= 7; y++) if (y <= 6 || (x >= 4 && x <= 7)) corners.push([x, y]);
    for (const [x, y] of corners) {
      const p = applyPoint(m, { x, y });
      const [hit] = osnap(src, {
        point: { x: p.x + 0.03, y: p.y - 0.02 },
        aperture: 0.1,
        modes: OSNAP.INT,
      });
      expect(hit?.mode, `INT at (${x}, ${y})`).toBe('INT');
      expect(near(hit!.point, p)).toBeLessThan(1e-6);
    }
    for (const [x, y] of [
      [2, 2],
      [9, 2],
      [5.5, 7],
    ] as const) {
      const p = applyPoint(m, { x, y });
      const [hit] = osnap(src, {
        point: { x: p.x - 0.02, y: p.y + 0.03 },
        aperture: 0.1,
        modes: OSNAP.END,
      });
      expect(hit?.mode).toBe('END');
      expect(near(hit!.point, p)).toBeLessThan(1e-6);
    }
  });

  it('snaps nothing outside the clip', () => {
    const { src, two } = source();
    const m = underlayMatrix(two);
    const all = OSNAP.END | OSNAP.MID | OSNAP.INT | OSNAP.NEA | OSNAP.PER | OSNAP.EXT | OSNAP.PAR;
    // Grid corners above the pentagon's roof and off its sides, and points on the triangle's
    // lines' page-edge ends.
    const outside: [number, number][] = [
      [1, 7],
      [2, 7],
      [3, 7],
      [8, 7],
      [9, 7],
      [10, 7],
      [3, 0],
      [0, 4],
      [11, 4],
    ];
    for (const [x, y] of outside) {
      expect(PAGE2_CLIP.length).toBe(5);
      const p = applyPoint(m, { x, y });
      const hits = osnap(src, {
        point: p,
        aperture: 0.1,
        modes: all,
        from: applyPoint(m, { x: 0, y: 0 }),
      });
      expect(hits, `at (${x}, ${y})`).toEqual([]);
    }
  });

  it('snaps to page 1 through its unclipped underlay at the origin', () => {
    const { src } = source();
    const [hit] = osnap(src, { point: { x: 3.02, y: 2.97 }, aperture: 0.1, modes: OSNAP.END });
    expect(hit?.mode).toBe('END');
    expect(near(hit!.point, { x: 3, y: 3 })).toBeLessThan(1e-9);
  });
});
