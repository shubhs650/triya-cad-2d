// M4-28: a table's AutoCAD 2008 data (the TABLECONTENT its ACAD_ROUNDTRIP_2008_TABLE_ENTITY
// XRECORD names) read into acad-ts's table content and written back. Every corpus TABLECONTENT
// (acadsharp sample_AC1015…AC1032 ASCII and binary, ezdxf acad_table_*) gives its codes back as
// read; one from a DXF before R2007 gives them back with its values framed as R2007 frames them.
// A table -TABLE makes is saved as AC1032 DXF with a TABLECONTENT of its own, its rows on the
// table style's `_TITLE`, `_HEADER` and `_DATA` cell styles, read back by acad-ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cellStyleMapOf,
  documentInit,
  readCadDocument,
  readTableContent,
  tableContentCodes,
  type RawCode,
} from '@triya/io';
import {
  CadDictionary,
  TableEntity,
  XRecord,
  type CadDocument,
  type CadObject,
} from '@node-projects/acad-ts';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type TableGeometry,
} from '@triya/engine';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { describe, expect, it } from 'vitest';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/third-party/', import.meta.url));
const FILES = [
  ...['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].flatMap((v) => [
    `acadsharp/sample_${v}_ascii.dxf`,
    `acadsharp/sample_${v}_binary.dxf`,
  ]),
  'ezdxf/examples_dxf/acad_table_simple.dxf',
  'ezdxf/examples_dxf/acad_table_with_blk_ref.dxf',
];

type Raw = CadObject & { rawDxfCodes: RawCode[] | null };

/** The drawing's TABLECONTENT objects, by handle. */
export function tableContents(doc: CadDocument): Raw[] {
  const out: Raw[] = [];
  for (const o of (
    doc as unknown as { _cadObjects: Map<number, CadObject> }
  )._cadObjects.values()) {
    if (o.objectName === 'TABLECONTENT') out.push(o as Raw);
  }
  return out.sort((a, b) => a.handle - b.handle);
}

/** Numbers as numbers (binary DXF reads some as bigint-free numbers already), strings as read. */
const plain = (codes: readonly RawCode[]) => codes.map(({ code, value }) => [code, value]);

describe('TABLECONTENT read and written back (M4-28)', () => {
  for (const file of FILES) {
    it(file, () => {
      const doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${file}`)));
      const objects = tableContents(doc);
      expect(objects.length).toBeGreaterThan(0);
      for (const o of objects) {
        const codes = o.rawDxfCodes!;
        const { content, head } = readTableContent(codes, (h) => doc.getCadObject(h));
        const written = tableContentCodes(content, head);
        if (/AC10(15|18)/.test(file)) {
          // Values come back framed: what is read from the written codes is what was read.
          expect(plain(tableContentCodes(readTableContent(written).content, head))).toEqual(
            plain(written),
          );
          expect(written.length).toBeGreaterThan(codes.length);
        } else {
          expect(plain(written)).toEqual(plain(codes));
        }
        expect(content.rows.length).toBeGreaterThan(0);
        expect(content.style?.handle).toBeGreaterThan(0);
      }
    });
  }
});

describe('a new table saved with its TABLECONTENT (M4-28)', () => {
  const read = (bytes: Uint8Array) =>
    withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

  for (const file of [
    'acadsharp/sample_AC1032_ascii.dxf',
    'ezdxf/examples_dxf/acad_table_simple.dxf',
  ]) {
    it(file, async () => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${file}`));
      const model = read(bytes);
      const before = new Set([...model.entities()].map((e) => e.id));
      const bus = new PromptBus({ model, registry: builtinCommands() });
      // Two columns, two data rows: a title, a header and two data rows.
      for (const a of ['-TABLE', '2', '2', '0,-500']) await bus.submit(a);
      for (const [k, value] of ['Title', 'A', 'B', '1', '2'].entries()) {
        await bus.answer({
          kind: 'string',
          value,
          editor: true,
          ...(k < 4 && { cell: 'next' as const }),
        });
      }
      const table = [...model.entities()].find(
        (e): e is Entity & { geom: TableGeometry } =>
          !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
      )!;
      const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      expect(new TextDecoder().decode(saved)).toMatch(
        /\n\s*TABLECONTENT\r?\n\s*2\r?\n\s*AcDbTableContent/,
      );
      const doc = readCadDocument(saved);
      const t = doc.getCadObject(Number.parseInt(table.handle, 16)) as TableEntity;
      expect(t).toBeInstanceOf(TableEntity);
      const x = t.xDictionary!.getEntry('ACAD_XREC_ROUNDTRIP') as XRecord;
      expect(x).toBeInstanceOf(XRecord);
      expect(x.owner).toBeInstanceOf(CadDictionary);
      expect(x.entries.map((e) => e.code)).toEqual([102, 360, 70, 90, 10, 90, 90]);
      expect(x.entries[0]!.value).toBe('ACAD_ROUNDTRIP_2008_TABLE_ENTITY');
      expect(x.entries[6]!.value).toBe(3);
      const object = x.entries[1]!.value as Raw;
      expect(object.objectName).toBe('TABLECONTENT');
      expect(object.owner).toBe(x);
      const { content } = readTableContent(object.rawDxfCodes!, (h) => doc.getCadObject(h));
      expect(content.style).toBe(t.style);
      const names = new Map(cellStyleMapOf(t.style!)!.cellStyles.map((c) => [c.id, c.name]));
      expect(content.rows.map((r) => names.get(r.styleId) ?? r.styleId)).toEqual([
        '_TITLE',
        '_HEADER',
        '_DATA',
        '_DATA',
      ]);
      expect(content.columns.map((c) => c.width)).toEqual(t.columns.map((c) => c.width));
      expect(content.rows.map((r) => r.height)).toEqual(t.rows.map((r) => r.height));
      expect(
        content.rows.map((r) => r.cells.map((c) => c.contents[0]?.cadValue.value ?? '')),
      ).toEqual([
        ['Title', ''],
        ['A', 'B'],
        ['1', '2'],
        ['', ''],
      ]);
      // The title spans both columns.
      expect(
        content.mergedCellRanges.map((m) => [
          m.topRowIndex,
          m.leftColumnIndex,
          m.bottomRowIndex,
          m.rightColumnIndex,
        ]),
      ).toEqual([[0, 0, 0, 1]]);
    });
  }
});
