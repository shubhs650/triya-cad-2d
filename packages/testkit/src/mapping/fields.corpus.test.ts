// M4-10 part 1: AcadToTriya maps the fields of TEXT, MTEXT, ATTDEF and ATTRIB: the FIELD tree
// in the `TEXT` entry of the text's ACAD_FIELD dictionary, onto the text as `field`. The text
// keeps its value as the file shows it, and every field in the public corpus agrees with it:
// the root's code with each child's value in place is the text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fieldCodeText,
  fieldText,
  type DrawingField,
  type EntityInit,
  type InsertGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest).filter((f) => f.format !== 'dwg');

interface Found {
  readonly handle: string;
  readonly kind: string;
  readonly text: string;
  readonly field: DrawingField;
}

/** Every text with fields: its handle, kind, shown text and field tree. */
function fieldsOf(entities: readonly EntityInit[]): Found[] {
  const out: Found[] = [];
  for (const e of entities) {
    const g = e.geom;
    if ((g.kind === 'TEXT' || g.kind === 'ATTDEF') && g.field) {
      out.push({ handle: e.handle, kind: g.kind, text: g.value, field: g.field });
    } else if (g.kind === 'MTEXT' && g.field) {
      out.push({ handle: e.handle, kind: g.kind, text: g.contents, field: g.field });
    } else if (g.kind === 'INSERT') {
      for (const a of (g as InsertGeometry).attributes) {
        if (a.field) out.push({ handle: a.handle, kind: 'ATTRIB', text: a.value, field: a.field });
      }
    }
  }
  return out;
}

const mapped = (path: string) =>
  fieldsOf(
    documentInit(readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${path}`)))).entities ??
      [],
  );

describe('FIELD mapping on the public corpus', () => {
  it("maps the Date fields of uncommon.dxf's attribute definition and attribute", () => {
    const found = mapped('public/third-party/ezdxf/examples_dxf/uncommon.dxf').sort((a, b) =>
      a.handle.localeCompare(b.handle),
    );
    expect(found.map((f) => [f.handle, f.kind, f.text, fieldCodeText(f.field)])).toEqual([
      ['5F5', 'ATTDEF', '21/04/2020', '%<\\AcVar Date \\f "dd/MM/yyyy">%'],
      ['5FC', 'ATTRIB', '21/04/2020', '%<\\AcVar Date \\f "dd/MM/yyyy">%'],
    ]);
    const date = found[0]!.field.children[0]!;
    expect(date).toMatchObject({ evaluator: 'AcVar', value: '21/04/2020', objects: [] });
    // The date's own value: 21 April 2020, 16:45:39 local time as the FIELD's SYSTEMTIME.
    const t = new Date(date.time!);
    expect([t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours()]).toEqual([
      2020, 4, 21, 16,
    ]);
    expect(found[0]!.field).toMatchObject({ evaluator: '_text', code: '%<\\_FldIdx 0>%' });
    expect(found[0]!.field.value).toBeUndefined();
  });

  it("maps the Filename fields of mtext_complex_inline_codes.dxf's MTEXTs", () => {
    const found = mapped('public/third-party/ezdxf/examples_dxf/mtext_complex_inline_codes.dxf');
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.kind).toBe('MTEXT');
      expect(f.field.children).toEqual([
        {
          evaluator: 'AcVar',
          code: '\\AcVar Filename \\f "%fn6"',
          children: [],
          objects: [],
          value: 'mtext_complex_inline_codes.dxf',
        },
      ]);
      expect(f.field.value).toBe(f.text);
    }
  });

  for (const file of readable) {
    const text = readFileSync(`${corpusDir}${file.path}`, 'latin1');
    if (!/AcDbField/.test(text)) continue;
    it(`agrees with the text it is on in ${file.path}`, () => {
      for (const f of mapped(file.path)) expect(fieldText(f.field), f.handle).toBe(f.text);
    });
  }
});
