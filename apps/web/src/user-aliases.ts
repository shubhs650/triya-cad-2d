// The user alias file (M3-10, FR-C4): the drafter's own command aliases in acad.pgp syntax,
// edited in Settings' Edit Aliases dialog and kept with the settings on this device. Its aliases
// override the default acad.pgp table (the "User Defined Command Aliases" section AutoCAD's
// acad.pgp ends with). Every drawing's engine and the command line's completion follow it.
import { builtinCommands, parseAliasFile } from '@triya/engine';

/** The longest alias file kept, characters: acad.pgp itself is about 30 000. */
export const ALIAS_FILE_MAX = 65_536;

/** A new user file: acad.pgp's own explanation of the syntax, and nothing defined. */
export const NEW_ALIAS_FILE = `; Triya CAD 2D user command aliases (acad.pgp syntax)
;
; One alias a line:  <alias>,*<command>
; The alias is what you type at the Command prompt, the command is the
; command it runs; put - before it for its dash form (-AR,*-ARRAY).
; Aliases here override the default ones: C,*COPY makes C run COPY.
; A line that starts with ; is a comment. A later line for the same
; alias wins.
;
; -- User Defined Command Aliases --
`;

/** The commands for the command line's completion and the Ctrl+K palette, with user aliases. */
export const appRegistry = builtinCommands();

let current = '';
const listeners = new Set<() => void>();
let version = 0;

/** The aliases a file defines (lines it cannot read left out). */
export const aliasesOf = (file: string): Readonly<Record<string, string>> =>
  parseAliasFile(file).aliases;

/** Uses a user alias file: the app's registry takes its aliases; listeners hear of a change. */
export function applyAliasFile(file: string): boolean {
  if (file === current) return false;
  current = file;
  appRegistry.setUserAliases(aliasesOf(file));
  version++;
  for (const l of listeners) l();
  return true;
}

/** For `useSyncExternalStore`: the alias file's version, which moves with each change. */
export const aliasFileVersion = {
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: (): number => version,
};
