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
  // XCLIP Invert clip on ezdxf's xclip.dxf: ACAD_XREC_ROUNDTRIP records (M5-04 part 11).
  | 'xclip-invert'
  // XCLIP carried by COPY, MIRROR and ARRAY on ezdxf's xclip.dxf (M5-16).
  | 'xclip-copy'
  // XCLIP carried by COPYCLIP, CUTCLIP and PASTECLIP: xclip.dxf pasted into itself and into
  // traces.dxf (M5-17).
  | 'xclip-paste'
  // LAYDEL and LAYMRG of every layer they can take on a corpus file (M5-06 part 2).
  | 'laydel'
  | 'laymrg'
  // Unreconciled new xref layers bound into the xref set's parent (M5-19).
  | 'layer-reconcile'
  // Layer filters (property, group, nested) added to a drawing's ACLYDICTIONARY or a new one
  // (M5-07 part 4).
  | 'layerfilters'
  // The filter menu's Convert to Group Filter and Isolate Group in a layout (M5-07 part 6).
  | 'layerfilters-menu'
  // Views' layer snapshots: Update Layers, a rename and New View's on the AC1032 sample, a new
  // view's on colors.dxf (M5-07 part 7).
  | 'view-layers'
  // Named page setups added, set current, modified, renamed and deleted on the AC1032 sample and
  // on images.dxf, which has one of its own (M6-01 part 3).
  | 'page-setups'
  // LAYOUT Copy of every layout of the AC1032 sample and of text_in_viewports.dxf (a clipped
  // viewport copied with its boundary; M6-01 part 2).
  | 'layout-copy'
  // MVIEW's viewports (4 by Fit, one from corners, one off, one locked) in the AC1032 sample's
  // current layout and in colors.dxf's, which has none (M6-02 part 1).
  | 'mview'
  // MVIEW Object and Polygonal, VPCLIP with a polygon and VPCLIP Delete: clipped viewports and
  // their boundaries in the AC1032 sample and text_in_viewports.dxf (M6-02 part 2).
  | 'vpclip'
  // ZOOM and PAN in each of the AC1032 sample's unlocked floating viewports: their own view centre
  // and height changed (M6-02 part 4).
  | 'viewport-view'
  // IMAGECLIP, IMAGEADJUST, IMAGEQUALITY and IMAGEFRAME on ezdxf's images.dxf (M5-04 part 4).
  | 'images'
  // IMAGEATTACH on ezdxf's colors.dxf (no images) and images.dxf (M5-04 part 5).
  | 'imageattach'
  // XATTACH of the xref set's files on ezdxf's colors.dxf (M5-04 part 6).
  | 'xattach'
  // XBIND of the xref set's block and layers (M5-04 part 7).
  | 'xbind'
  // XBIND of a block holding an image and a PDF underlay, their definitions filed as the
  // drawing's (M5-04 part 16).
  | 'xbind-pictures'
  // -XREF Path and Pathtype of the xref set's xrefs (M5-04 part 15).
  | 'xref-path'
  // PASTECLIP of the xref set's references into ezdxf's colors.dxf: the xrefs attached there
  // (M5-04 part 19).
  | 'xref-paste'
  // LINETYPE's loads, reloads and deletes on ezdxf's colors.dxf (M5-08 part 1).
  | 'linetype'
  // PURGE's Orphaned data on dgn-linestyles.dxf: the orphaned components, then every component
  // with the DGN linetypes, which takes the ACAD_DGNLINESTYLECOMP dictionary (M5-09 part 5).
  | 'orphaned-data'
  | 'orphaned-data-all'
  // WBLOCK's new drawing of each corpus file's model space (M5-01 part 4).
  | 'wblock'
  // A block edited in the Block Editor (BEDIT, ERASE, LINE, BSAVE, BCLOSE; M5-02 part 1).
  | 'bedit'
  // A new block made in the Block Editor, and ATTSYNC after a block's attribute definitions
  // changed (M5-02 part 2).
  | 'attsync'
  // A block reference edited in place (-REFEDIT, ERASE, LINE, REFCLOSE Save; M5-02 part 3).
  | 'refedit'
  // A reference scaled differently in X and Y edited in place and saved, a circle and a line
  // drawn into its block (M5-02 part 8).
  | 'refedit-scaled'
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
