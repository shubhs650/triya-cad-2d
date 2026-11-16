// The table engine against the corpus (M4-05): every ACAD_TABLE whose `*T` block is stored is
// drawn again from its rows, columns, cells and table style (`tableParts`), and what the engine
// draws is compared with the stored block, entity by entity: kind, place, size, text, colour,
// lineweight and linetype. AutoCAD's own tables (acadsharp's samples) are compared in order;
// ezdxf's two example tables, written by another program (no zero-length Defpoints line, the
// outer column lines first, block cells among the text), as sets. `TRIYA_TABLES_REPORT=1`
// prints the differences.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  blockExtentsOf,
  tableParts,
  type Entity,
  type TableGeometry,
  type TablePart,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const r = (v: number) => (Math.round(v * 1e4) / 1e4 + 0).toFixed(4);
const pt = (p: { x: number; y: number }) => `${r(p.x)},${r(p.y)}`;

/** What is compared of a block entity or a part. */
function describePart(p: Pick<TablePart, 'geom' | 'color' | 'lineweight' | 'linetype'>): string {
  const g = p.geom;
  const props = `${JSON.stringify(p.color ?? { kind: 'byBlock' })} lw ${p.lineweight ?? 'ByBlock'} lt ${p.linetype ?? 'ByBlock'}`;
  switch (g.kind) {
    case 'LINE':
      return `LINE ${pt(g.start)} ${pt(g.end)} ${props}`;
    case 'SOLID':
      return `SOLID ${g.corners.map(pt).join(' ')} ${JSON.stringify(p.color)}`;
    case 'MTEXT':
      return `MTEXT ${pt(g.position)} h ${r(g.height)} w ${r(g.width)} a ${g.attachment} rot ${r(g.rotation)} ${JSON.stringify(g.contents)} style ${g.style} ${JSON.stringify(p.color)}`;
    case 'INSERT':
      return `INSERT ${g.block} ${pt(g.position)} s ${r(g.scale.x)} rot ${r(g.rotation)}`;
    default:
      return g.kind;
  }
}

/** The stored entity as a part: ByBlock where the entity is. */
const stored = (e: Entity): TablePart => ({
  geom: e.geom,
  color: e.color,
  lineweight: e.lineweight,
  linetype: e.linetype === 'ByBlock' || e.linetype === 'ByLayer' ? e.linetype : 'ByBlock',
});

/** Tables whose stored block the table's data cannot give, and why. */
const KNOWN: Readonly<Record<string, string>> = {
  // R14 has no lineweights: acad-ts reads the block's lines as ByLayer (DEC-047, no DWG work).
  'public/third-party/acadsharp/sample_AC1014.dwg 528': 'R14: no lineweights',
  'public/third-party/acadsharp/sample_AC1014.dwg A35': 'R14: no lineweights',
  // The program that wrote ezdxf's example split one column line in two where it runs on alike;
  // the engine draws it as one line, the same drawing.
  'public/third-party/ezdxf/examples_dxf/acad_table_with_blk_ref.dxf CF': 'a line split in two',
  // A cell value's format string (DXF 300 "%tc1", upper case) shows "CELL FORMAT 1"; Triya maps
  // the value as typed. Formatted cell values are a later part of M4-05.
  ...Object.fromEntries(
    ['AC1021', 'AC1024', 'AC1027', 'AC1032'].flatMap((v) =>
      ['ascii', 'binary'].map((k) => [
        `public/third-party/acadsharp/sample_${v}_${k}.dxf A35`,
        'cell value format %tc1',
      ]),
    ),
  ),
};

/** Written by AutoCAD: its block's order is compared too. */
const ordered = (path: string) => path.includes('/acadsharp/');

describe('table engine over the public corpus (M4-05)', () => {
  it('draws the corpus tables as AutoCAD stored them', () => {
    const results: { key: string; problems: string[] }[] = [];
    for (const f of readable) {
      if (!/ACAD_TABLE/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1'))) continue;
      let model: DocumentModel;
      try {
        model = DocumentModel.create(
          documentInit(readCadDocument(readFileSync(`${corpusDir}${f.path}`))),
        );
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      const standard = [...model.tables.textStyles.values()].find(
        (s) => s.name.toUpperCase() === 'STANDARD',
      );
      for (const e of model.entities()) {
        const g = e.geom as TableGeometry;
        if (g.kind !== 'ACAD_TABLE' || g.block === undefined || !model.hasBlock(g.block)) continue;
        const style = g.style !== undefined ? model.tables.tableStyles.get(g.style) : undefined;
        const want = model
          .blockEntities(g.block)
          .map((id) => describePart(stored(model.entity(id)!)));
        const got = tableParts(g, style, {
          textStyle: standard?.handle ?? '',
          blockExtents: (h) => blockExtentsOf(model, h),
        }).map(describePart);
        const problems: string[] = [];
        if (ordered(f.path)) {
          for (let k = 0; k < Math.max(want.length, got.length); k++) {
            if (want[k] !== got[k]) problems.push(`#${k}\n  want ${want[k]}\n  got  ${got[k]}`);
          }
        } else {
          // The Defpoints line is AutoCAD's; other programs leave it out.
          const left = got.filter((x) => !x.startsWith('LINE 0.0000,0.0000 0.0000,0.0000'));
          for (const w of want) {
            const k = left.indexOf(w);
            if (k >= 0) left.splice(k, 1);
            else problems.push(`missing ${w}`);
          }
          problems.push(...left.map((x) => `extra ${x}`));
        }
        results.push({ key: `${f.path} ${e.handle}`, problems });
      }
    }
    const failing = results.filter((x) => x.problems.length > 0);
    if (process.env.TRIYA_TABLES_REPORT) {
      console.log(
        `${results.length - failing.length}/${results.length} match\n` +
          failing.map((x) => `${x.key}:\n${x.problems.slice(0, 12).join('\n')}`).join('\n'),
      );
    }
    // 36 tables in the readable files (blocks.corpus.test.ts), 28 with a stored block here.
    expect(results.length).toBe(28);
    expect(failing.map((x) => x.key).sort()).toEqual(Object.keys(KNOWN).sort());
  });
});
