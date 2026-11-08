// The DXF validity gate (M1-105, DEC-047 item 7): every public corpus file is saved as AC1032 DXF,
// unedited and edited, and CI loads each save with ezdxf's `recover` and runs its `audit`
// (scripts/dxf-audit/audit.py). The saves are written by the corpus suites only when
// TRIYA_DXF_AUDIT_DIR names a directory, so a plain `pnpm test` writes nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { ACadVersion, type CadDocument } from '@node-projects/acad-ts';
import type { DocumentModel } from '@triya/engine';
import { triyaToAcad, writeCadDocument } from '@triya/io';

export type AuditSaveKind = 'unedited' | 'edited';

/**
 * Triya's save of `model` as an AC1032 ASCII DXF (DEC-047 item 2), whatever format and version
 * `original` was read from: the changes are applied by handle as for any save, then the writer
 * is told to write AC1032. Consumes `original`. M2-13 builds Save As on the same two steps.
 */
export function saveAc1032Dxf(original: CadDocument, model: DocumentModel): Uint8Array {
  triyaToAcad(original, model, 'dxf');
  // Set after triyaToAcad: it compares the header with the one it read, and $ACADVER is not a
  // change the user made.
  original.header!.version = ACadVersion.AC1032;
  return writeCadDocument(original, { format: 'dxf' });
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
