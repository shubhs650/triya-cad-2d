// M4-28: a table's AutoCAD 2008 data (the TABLECONTENT its ACAD_ROUNDTRIP_2008_TABLE_ENTITY
// XRECORD names) read into acad-ts's table content and written back. Every corpus TABLECONTENT
// (acadsharp sample_AC1015…AC1032 ASCII and binary, ezdxf acad_table_*) gives its codes back as
// read; one from a DXF before R2007 gives them back with its values framed as R2007 frames them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCadDocument, readTableContent, tableContentCodes, type RawCode } from '@triya/io';
import type { CadDocument, CadObject } from '@node-projects/acad-ts';
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
  for (const o of (doc as unknown as { _cadObjects: Map<number, CadObject> })._cadObjects.values()) {
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
