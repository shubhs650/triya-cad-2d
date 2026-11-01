// M1-13 on the public corpus and against acad-ts: every LTYPE record of every readable file
// becomes a pattern whose length is the record's own DXF 40 total and which fits a line with
// finite geometry; the bundled ISO 128 set parses; and the computed ACI palette equals acad-ts's
// table except where that table breaks the palette's own pattern. The render comparison against
// reference plots comes with the fidelity harness (M1-24).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Color } from '@node-projects/acad-ts';
import { mapEntities, mapSortEnts, mapTables, readCadDocument } from '@triya/io';
import { aciRgb, dashPath, drawOrder, parseLin, patternLength, patternOf } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';

const hex = (n: number) => n.toString(16).toUpperCase();

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const corpusDir = `${repo}corpus/`;
const manifest = loadManifest(`${corpusDir}corpus.json`);

describe('linetype patterns on the public corpus (M1-13)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('turns every LTYPE record into a pattern of its own length that fits a line', () => {
    const wrong: string[] = [];
    let records = 0;
    let dashed = 0;
    let complex = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      for (const r of mapTables(doc).linetypes) {
        records++;
        const where = `${f.path} LTYPE ${r.handle} ${r.name}`;
        const p = patternOf(r);
        const P = patternLength(p);
        if (Math.abs(P - r.patternLength) > 1e-9 * Math.max(1, P)) {
          wrong.push(`${where}: elements total ${P}, DXF 40 ${r.patternLength}`);
        }
        if (P === 0) continue;
        dashed++;
        const embedded = p.elements.filter((e) => e.embed).length;
        if (embedded) complex++;
        // Ten periods plus a bit, so every element is drawn at least nine times.
        const L = 10.3 * P;
        const d = dashPath(
          [
            { x: 0, y: 0 },
            { x: L, y: 0 },
          ],
          p,
          1,
        );
        const coords = [...d.dashes.flat(), ...d.dots, ...d.embeds.map((e) => e.at)];
        if (d.solid || !coords.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y))) {
          wrong.push(`${where}: did not dash (${JSON.stringify(p.elements)})`);
        }
        if (coords.some((c) => c.x < -1e-9 - Math.abs(P) || c.x > L + Math.abs(P))) {
          wrong.push(`${where}: geometry far outside the line`);
        }
        if (d.embeds.length !== 10 * embedded) {
          wrong.push(`${where}: ${d.embeds.length} embeds for ${embedded} per period`);
        }
      }
    }
    console.log(
      `LTYPE corpus: ${records} records, ${dashed} dashed, ${complex} with text or shapes`,
    );
    expect(dashed).toBeGreaterThan(0);
    expect(complex).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });
});

describe('draw order on the public corpus (M1-13 part 2)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('maps every SORTENTSTABLE onto entities of its own block', () => {
    const wrong: string[] = [];
    let tables = 0;
    let entries = 0;
    let moved = 0;
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue;
      }
      // Every entity of every block, mapped or not (a table may order types Triya does not map).
      const byBlock = new Map<string, string[]>();
      for (const br of doc.blockRecords ?? []) {
        byBlock.set(
          hex(br.handle),
          [...br.entities].map((e) => hex(e.handle)),
        );
      }
      for (const t of mapSortEnts(doc)) {
        tables++;
        entries += t.entries.length;
        const block = byBlock.get(t.block) ?? [];
        for (const e of t.entries) {
          if (!block.includes(e.entity)) {
            wrong.push(
              `${f.path} SORTENTSTABLE ${t.handle}: ${e.entity} is not in block ${t.block}`,
            );
          }
        }
        const ordered = drawOrder(block, t.entries);
        if ([...ordered].sort().join() !== [...block].sort().join()) {
          wrong.push(`${f.path} SORTENTSTABLE ${t.handle}: order is not a permutation`);
        }
        if (ordered.join() !== block.join()) moved++;
      }
    }
    console.log(
      `SORTENTS corpus: ${tables} tables, ${entries} entries, ${moved} reorder their block`,
    );
    expect(tables).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('draws the hatch AutoCAD sent to the back before its boundary (sample_AC1015)', () => {
    const doc = readCadDocument(
      new Uint8Array(
        readFileSync(`${corpusDir}public/third-party/acadsharp/sample_AC1015_ascii.dxf`),
      ),
    );
    const table = mapSortEnts(doc).find((t) => t.handle === '355')!;
    const block = mapEntities(doc)
      .entities.filter((e) => e.owner === table.block)
      .map((e) => e.handle);
    const ordered = drawOrder(block, table.entries);
    // Table 355 gives LWPOLYLINE 353 sort handle 35A and HATCH 35A sort handle 354.
    expect(block.indexOf('353')).toBeLessThan(block.indexOf('35A'));
    expect(ordered.indexOf('35A')).toBeLessThan(ordered.indexOf('353'));
  });
});

describe('bundled linetypes (assets/linetypes)', () => {
  it('reads triya-iso.lin with no errors: ISO 128-20 types 02–15 in units of the line width', () => {
    const f = parseLin(readFileSync(`${repo}assets/linetypes/triya-iso.lin`, 'latin1'));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([]);
    const names = f.linetypes.map((l) => l.name);
    expect(names).toEqual(
      Array.from({ length: 14 }, (_, i) => `TRIYA_ISO${String(i + 2).padStart(2, '0')}`),
    );
    // ISO 128-20: long dash 24d, dash 12d, short dash 6d, gap 3d (18d for type 03), dot.
    for (const l of f.linetypes) {
      for (const e of l.elements) expect([24, 12, 6, 0, -3, -18]).toContain(e.length);
    }
  });
});

describe('ACI palette against acad-ts', () => {
  /**
   * Entries of acad-ts's `Color._indexRgb` that break the palette's own pattern, so acad-ts
   * has them wrong: mistyped digits (38 as 28 or 88, 76 as 126, 127 as 125 or 217, 145 as
   * 142), ACI 192 with red and blue swapped, and the greys 250–254 (AutoCAD reports 253 as
   * 173,173,173). Patching acad-ts is M1-43.
   */
  const ACAD_TS_PALETTE_GAPS = new Set([
    29, 91, 109, 119, 129, 139, 145, 147, 149, 157, 159, 167, 169, 177, 179, 187, 189, 192, 197,
    199, 203, 209, 219, 229, 239, 249, 250, 251, 252, 253, 254,
  ]);

  it('equals acad-ts on every other index 1–255', () => {
    const differ: number[] = [];
    for (let i = 1; i <= 255; i++) {
      if (aciRgb(i).join() !== Color.getIndexRGB(i)!.join()) differ.push(i);
    }
    expect(differ).toEqual([...ACAD_TS_PALETTE_GAPS]);
  });

  it('keeps each hue row regular where acad-ts does not', () => {
    // Each odd index is its even neighbour at half saturation: the dimmest channel is half the
    // brightest, floored.
    for (let i = 10; i < 250; i += 2) {
      const full = aciRgb(i);
      const half = aciRgb(i + 1);
      const v = Math.max(...full);
      expect(Math.max(...half)).toBe(v);
      expect(Math.min(...half)).toBe(
        Math.floor((255 * [1, 0.65, 0.5, 0.3, 0.15][(i % 10) / 2]!) / 2),
      );
    }
  });
});
