// Renaming the objects a file names only by their dictionary entry (M1-95): MLEADERSTYLE in
// ACAD_MLEADERSTYLE, TABLESTYLE in ACAD_TABLESTYLE, IMAGEDEF in ACAD_IMAGE_DICT. The entry name
// (DXF 3 in the DICTIONARY, the entry text in a DWG) is the object's only name, and everything
// else points at the object by handle (MULTILEADER 340, IMAGE 340, …), so a rename changes the
// entry and nothing else: it keeps its place, handle and owner (acad-ts patch 0147). Names the
// drawing keeps elsewhere, such as CMLEADERSTYLE's text, follow through the header's own change.

import { CadDictionary, type CadObject, type NonGraphicalObject } from '@node-projects/acad-ts';

/** The key `acad` is listed under in `dict`, or undefined when `dict` does not list it. */
function entryKey(dict: CadDictionary, acad: CadObject): string | undefined {
  const i = [...dict].indexOf(acad as NonGraphicalObject);
  return i < 0 ? undefined : dict.entryNames[i];
}

/**
 * Why `acad` cannot take the entry name `name`: it must be listed in the dictionary owning it,
 * and no entry Triya does not map (`mapped` false) may hold the name already. Entries Triya maps
 * are checked against the model's own names by the caller, which allows names to be swapped.
 */
export function entryRenameProblems(
  acad: CadObject,
  name: string,
  mapped: (o: CadObject) => boolean,
): string[] {
  const dict = acad.owner;
  if (!(dict instanceof CadDictionary) || entryKey(dict, acad) === undefined)
    return ['it is not an entry of a dictionary, which is where its name is kept'];
  const other = dict.get(name);
  if (other && other !== acad && !mapped(other))
    return [`the dictionary has another entry named ${name}`];
  return [];
}

/**
 * Renames each object's dictionary entry in place. Every entry first takes a name no drawing can
 * hold (`*` is not allowed in one), so that two objects may trade names; then each its new one.
 * Call it before adding new entries, which may take a name a rename frees.
 */
export function renameEntries(
  renames: readonly { readonly acad: NonGraphicalObject; readonly name: string }[],
): void {
  for (const { acad } of renames) {
    const dict = acad.owner as CadDictionary;
    dict.rename(entryKey(dict, acad)!, `*TRIYA-RENAME-${acad.handle.toString(16)}`);
  }
  for (const { acad, name } of renames) {
    const dict = acad.owner as CadDictionary;
    dict.rename(entryKey(dict, acad)!, name);
  }
}
