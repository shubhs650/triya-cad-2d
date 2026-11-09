// The app's Save and Save As (M2-13, PRD FR-F2, DEC-047): every save writes an AC1032 ASCII DXF,
// whatever the drawing was read from. The app keeps the bytes it opened and the change log its
// engine applied since (`Engines.changesOf`); the I/O worker reads the bytes again, rebuilds the
// engine's document by replaying the log onto a replica, and writes it through TriyaToAcad from
// that fresh original (ARCHITECTURE.md §6.1). Export compares states, so a save always starts
// from the file as opened, and saving twice in a session writes the same as saving once.

import { ACadVersion, type CadDocument } from '@node-projects/acad-ts';
import { applyToReplica, DocumentModel, type ChangeSet } from '@triya/engine';
import { documentInit } from '../map/document';
import { readCadDocument, type CadFormat } from '../read';
import { writeCadDocument } from '../write';
import { triyaToAcad } from './export';

/** The version every save writes (DEC-047: AutoCAD 2018 DXF). */
export const SAVE_VERSION = ACadVersion.AC1032;

/**
 * `model` saved as an AC1032 ASCII DXF onto `original` (the document it was opened from, read
 * afresh: it is consumed). What the session added is checked against AC1032, not the version
 * read. Throws `UnsupportedChangeError` for a change no writer handles yet.
 */
export function saveDxf(original: CadDocument, model: DocumentModel): Uint8Array {
  triyaToAcad(original, model, 'dxf', { version: SAVE_VERSION });
  original.header!.version = SAVE_VERSION;
  return writeCadDocument(original, { format: 'dxf' });
}

/**
 * The drawing `bytes` held with the session's `changes` applied, in order, saved as an AC1032
 * DXF (`saveDxf`). `changes` are the engine's change sets as the app logged them (structured
 * clones are fine).
 */
export function saveSession(
  bytes: Uint8Array,
  changes: readonly ChangeSet[],
  format?: CadFormat,
): Uint8Array {
  const original = readCadDocument(bytes, format);
  const model = DocumentModel.create(documentInit(original));
  for (const cs of changes) applyToReplica(model, cs, 'saved document');
  return saveDxf(original, model);
}

