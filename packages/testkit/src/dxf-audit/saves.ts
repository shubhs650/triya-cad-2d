// The DXF validity gate (M1-105, DEC-047 item 7): every public corpus file is saved as AC1032 DXF,
// unedited and edited, and CI loads each save with ezdxf's `recover` and runs its `audit`
// (scripts/dxf-audit/audit.py). The saves are written by the corpus suites only when
// TRIYA_DXF_AUDIT_DIR names a directory, so a plain `pnpm test` writes nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { CadDocument } from '@node-projects/acad-ts';
import type { DocumentModel } from '@triya/engine';
import { saveDxf } from '@triya/io';

export type AuditSaveKind =
  | 'unedited'
  | 'resaved'
  | 'edited'
  | 'markup'
  | 'mleader'
  | 'session'
  | 'paste'
  | 'dimension'
  | 'properties'
  | 'views'
  | 'hatch'
  | 'categories'
  | 'table'
  | 'tablestyle'
  | 'block'
  // Saves of a thread-authored fixture, not a corpus file (audit.py `FIXTURE_SAVES`): XREF Bind
  // of the xref set's parent, both bind types (M5-04 part 2).
  | 'bind'
  | 'bind-insert'
  | 'bind-objects'
  // XCLIP's options on ezdxf's xclip.dxf, a corpus file saved by a testkit suite (M5-04 part 3).
  | 'xclip'
  // LAYDEL and LAYMRG of every layer they can take on a corpus file (M5-06 part 2).
  | 'laydel'
  | 'laymrg'
  // IMAGECLIP, IMAGEADJUST, IMAGEQUALITY and IMAGEFRAME on ezdxf's images.dxf (M5-04 part 4).
  | 'images'
  // IMAGEATTACH on ezdxf's colors.dxf (no images) and images.dxf (M5-04 part 5).
  | 'imageattach'
  // XATTACH of the xref set's files on ezdxf's colors.dxf (M5-04 part 6).
  | 'xattach'
  // XBIND of the xref set's block and layers (M5-04 part 7).
  | 'xbind'
  // LINETYPE's loads, reloads and deletes on ezdxf's colors.dxf (M5-08 part 1).
  | 'linetype'
  // WBLOCK's new drawing of each corpus file's model space (M5-01 part 4).
  | 'wblock'
  // A block edited in the Block Editor (BEDIT, ERASE, LINE, BSAVE, BCLOSE; M5-02 part 1).
  | 'bedit'
  // A new block made in the Block Editor, and ATTSYNC after a block's attribute definitions
  // changed (M5-02 part 2).
  | 'attsync'
  // A block reference edited in place (-REFEDIT, ERASE, LINE, REFCLOSE Save; M5-02 part 3).
  | 'refedit'
  // An xref edited in place and saved to its own file: the title block of the xref set as
  // REFCLOSE writes it (M5-02 part 6).
  | 'refedit-xref'
  // A block an xref brought in edited in place and saved to the xref's file: the title block's
  // LOGO as REFCLOSE writes it (M5-02 part 7).
  | 'refedit-xref-block'
  // PDFATTACH on ezdxf's colors.dxf (no underlays) and the underlay fixture (M5-04 part 8).
  | 'pdfattach'
  // PDFCLIP and PDFADJUST on the underlay fixture (M5-04 part 9).
  | 'pdfclip'
  // ATTDEF's definitions, a block of them and a reference on ezdxf's colors.dxf (M5-03 part 1).
  | 'attdef'
  // ATTREDEF of the title-block test drawing's block (M5-03 part 3).
  | 'attredef'
  // Insert Field in ATTDEF's dialog and EATTEDIT on the title-block test drawing (M5-03 part 4).
  | 'attfield'
  // A bundled template as it is, and a new drawing made from it, drawn in, its title block
  // filled in and saved (M5-10).
  | 'template'
  | 'new';

/**
 * Triya's save of `model` as an AC1032 ASCII DXF (DEC-047 item 2), whatever format and version
 * `original` was read from: the app's Save (`saveDxf`, M2-13), which checks what the session added
 * against AC1032. Consumes `original`.
 */
export function saveAc1032Dxf(original: CadDocument, model: DocumentModel): Uint8Array {
  return saveDxf(original, model);
}

/** The save's file name: the corpus path flattened, then the kind (audit.py reads it back). */
export function auditSaveName(corpusPath: string, kind: AuditSaveKind): string {
  return `${corpusPath.replaceAll('/', '__')}.${kind}.dxf`;
}

/** Where the gate's saves go, or undefined when the suites should not write them. */
export function auditDir(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const dir = env['TRIYA_DXF_AUDIT_DIR'];
  return dir === undefined || dir === '' ? undefined : dir;
}

/**
 * Write one save for the gate. A save that throws is written as `<name>.error.txt`, which the
 * audit reports as a failure, so the corpus suites keep their own assertions.
 */
export function writeAuditSave(
  corpusPath: string,
  kind: AuditSaveKind,
  save: () => Uint8Array,
  dir = auditDir(),
): void {
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  const name = auditSaveName(corpusPath, kind);
  try {
    writeFileSync(`${dir}/${name}`, save());
  } catch (err) {
    writeFileSync(`${dir}/${name}.error.txt`, `${String(err)}\n`);
  }
}

/**
 * Beside a save, what ezdxf must read back from it (`<save>.<what>.json`), for the audit's
 * read-back checks (audit.py `READ_BACK`): M2-70's view categories, by view name.
 */
export function writeAuditExpectation(
  corpusPath: string,
  kind: AuditSaveKind,
  what: string,
  expected: unknown,
  dir = auditDir(),
): void {
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${auditSaveName(corpusPath, kind)}.${what}.json`, JSON.stringify(expected));
}
